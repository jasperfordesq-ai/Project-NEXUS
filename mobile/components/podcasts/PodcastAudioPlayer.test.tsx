// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import appConfig from '../../app.json';

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockUnload = jest.fn();
const mockSetPosition = jest.fn();
const mockCreate = jest.fn();
const mockSetAudioMode = jest.fn();
const mockLoadPosition = jest.fn();
const mockSavePosition = jest.fn();
const mockClearPosition = jest.fn();

const mockLockScreen = jest.fn();
jest.mock('expo-audio', () => ({ setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args) }));
jest.mock('@/lib/media/loadAudioPlayer', () => ({ loadAudioPlayer: (...args: unknown[]) => mockCreate(...args) }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const strings: Record<string, string> = {
        'player.play': 'Play',
        'player.pause': 'Pause',
        'player.load_error': 'Audio unavailable',
        'player.progress': 'Playback progress',
        'player.skip_back': 'Back 15s',
        'player.skip_forward': 'Forward 30s',
        'player.start_over': 'Start over',
        'player.retry': 'Retry',
        'player.resume_from': `Resume from ${vars?.time ?? ''}`,
      };
      return strings[key] ?? key;
    },
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', error: '#c00', border: '#ddd' }) }));
jest.mock('@/lib/theme/accentForeground', () => ({ useAccentForeground: () => '#fff' }));
jest.mock('@/lib/api/podcasts', () => ({ recordPodcastListen: jest.fn().mockResolvedValue({ recorded: true }) }));
jest.mock('@/lib/podcasts/playbackPositions', () => ({
  loadPodcastPosition: (...args: unknown[]) => mockLoadPosition(...args),
  savePodcastPosition: (...args: unknown[]) => mockSavePosition(...args),
  clearPodcastPosition: (...args: unknown[]) => mockClearPosition(...args),
}));

import PodcastAudioPlayer from './PodcastAudioPlayer';

describe('PodcastAudioPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnload.mockResolvedValue(undefined);
    mockSetAudioMode.mockResolvedValue(undefined);
    mockLoadPosition.mockResolvedValue(null);
    mockSavePosition.mockResolvedValue(undefined);
    mockClearPosition.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({
      player: { play: mockPlay, pause: mockPause, seekTo: mockSetPosition, setActiveForLockScreen: mockLockScreen }, release: mockUnload,
    });
  });

  it('loads and starts the episode only after the member presses Play', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} episodeTitle="Local voices" showTitle="Community show" audioUrl="https://audio.example/one.mp3" durationSeconds={60} primaryColor="#06f" />);
    expect(mockCreate).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ uri: 'https://audio.example/one.mp3' }, expect.any(Function), expect.any(AbortSignal)));
    await waitFor(() => expect(mockPlay).toHaveBeenCalled());
    expect(mockLockScreen).toHaveBeenCalledWith(true, { title: 'Local voices', artist: 'Community show' });
  });

  it('shows visible feedback and a way to try again if audio loading fails', async () => {
    mockCreate.mockRejectedValue(new Error('offline'));
    const { getByLabelText, findByText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    expect(await findByText('Audio unavailable')).toBeTruthy();
    expect(await findByText('Retry')).toBeTruthy();
  });

  it('offers a fresh load after the native player fails during playback', async () => {
    const screen = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(screen.getByLabelText('Play'));
    await waitFor(() => expect(mockPlay).toHaveBeenCalled());
    act(() => mockCreate.mock.calls[0][1]({ isLoaded: false, playbackState: 'failed' }));
    expect(screen.getByText('Audio unavailable')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(2));
  });

  it('does not create a player after leaving during audio session setup', async () => {
    let finish!: () => void;
    mockSetAudioMode.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    const screen = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(screen.getByLabelText('Play'));
    screen.unmount();
    await act(async () => { finish(); });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('releases a late player instead of starting audio after leaving', async () => {
    let finish!: (value: unknown) => void;
    mockCreate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const screen = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(screen.getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const signal = mockCreate.mock.calls[0][2] as AbortSignal;
    screen.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish({ player: { play: mockPlay }, release: mockUnload }); });
    expect(mockUnload).toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('asks for an audio session that survives the phone locking', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockSetAudioMode).toHaveBeenCalled());
    expect(mockSetAudioMode).toHaveBeenCalledWith(expect.objectContaining({
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      // The message thread turns recording on to capture a voice note and never turns it
      // off; on iOS that leaves later playback quiet and on the earpiece.
      allowsRecording: false,
    }));
  });

  it('the app declares the iOS background audio mode a locked phone needs', () => {
    expect(appConfig.expo.ios.infoPlist.UIBackgroundModes).toContain('audio');
  });

  it('resumes where the member left off instead of restarting the episode', async () => {
    mockLoadPosition.mockResolvedValue(754);
    const { findByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    const play = await findByLabelText('Resume from 12:34');
    fireEvent.press(play);
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      { uri: 'https://audio.example/one.mp3' },
      expect.any(Function), expect.any(AbortSignal),
    ));
    await waitFor(() => expect(mockSetPosition).toHaveBeenCalledWith(754));
    expect(mockSetPosition.mock.invocationCallOrder[0]).toBeLessThan(mockPlay.mock.invocationCallOrder[0]);
  });

  it('start over forgets the saved place and plays from the beginning', async () => {
    mockLoadPosition.mockResolvedValue(754);
    const { findByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(await findByLabelText('Start over'));
    await waitFor(() => expect(mockClearPosition).toHaveBeenCalledWith(8));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      { uri: 'https://audio.example/one.mp3' },
      expect.any(Function), expect.any(AbortSignal),
    ));
  });

  it('skips forward and back within a loaded episode', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());

    // Drive the status callback the way expo-audio does, so the component knows where it is.
    const onStatus = mockCreate.mock.calls[0][1] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, currentTime: 100, duration: 2700, playing: true, didJustFinish: false }));

    fireEvent.press(getByLabelText('Forward 30s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(130));

    // Skips compound from where the last one landed, not from the last status report —
    // otherwise two quick taps on Forward move the episode only once.
    fireEvent.press(getByLabelText('Back 15s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(115));
  });

  it('never seeks past the end or before the start', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={60} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][1] as (status: unknown) => void;

    act(() => onStatus({ isLoaded: true, currentTime: 55, duration: 60, playing: true, didJustFinish: false }));
    fireEvent.press(getByLabelText('Forward 30s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(60));

    act(() => onStatus({ isLoaded: true, currentTime: 5, duration: 60, playing: true, didJustFinish: false }));
    fireEvent.press(getByLabelText('Back 15s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(0));
  });

  it('remembers the place when the member leaves the screen', async () => {
    const { getByLabelText, unmount } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][1] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, currentTime: 421, duration: 2700, playing: true, didJustFinish: false }));

    unmount();
    expect(mockSavePosition).toHaveBeenCalledWith(8, 421, 2700);
  });

  it('forgets the place once the episode finishes', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][1] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, currentTime: 2700, duration: 2700, playing: false, didJustFinish: true }));

    await waitFor(() => expect(mockClearPosition).toHaveBeenCalledWith(8));
  });
});
