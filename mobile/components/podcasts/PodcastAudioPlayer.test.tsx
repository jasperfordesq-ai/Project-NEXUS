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

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args),
    Sound: { createAsync: (...args: unknown[]) => mockCreate(...args) },
  },
}));
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
      sound: { playAsync: mockPlay, pauseAsync: mockPause, unloadAsync: mockUnload, setPositionAsync: mockSetPosition },
    });
  });

  it('loads and starts the episode only after the member presses Play', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={60} primaryColor="#06f" />);
    expect(mockCreate).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ uri: 'https://audio.example/one.mp3' }, { shouldPlay: true, positionMillis: 0 }, expect.any(Function)));
  });

  it('shows visible feedback and a way to try again if audio loading fails', async () => {
    mockCreate.mockRejectedValue(new Error('offline'));
    const { getByLabelText, findByText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    expect(await findByText('Audio unavailable')).toBeTruthy();
    expect(await findByText('Retry')).toBeTruthy();
  });

  /**
   * 🔴 The behaviour the owner reported: the phone locks and a 45-minute episode stops.
   * With `staysActiveInBackground` false — expo-av's default, and what shipped — expo-av
   * PAUSES every sound on host pause, so this is the whole of the fix on the JS side.
   * The iOS half is asserted separately below; without both, one platform stays broken.
   */
  it('asks for an audio session that survives the phone locking', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockSetAudioMode).toHaveBeenCalled());
    expect(mockSetAudioMode).toHaveBeenCalledWith(expect.objectContaining({
      staysActiveInBackground: true,
      // iOS refuses staysActiveInBackground with playsInSilentModeIOS false, so the two
      // are one setting in practice.
      playsInSilentModeIOS: true,
      // The message thread turns recording on to capture a voice note and never turns it
      // off; on iOS that leaves later playback quiet and on the earpiece.
      allowsRecordingIOS: false,
    }));
  });

  /**
   * The Info.plist half. expo-av's own audio session cannot keep playing in the background
   * unless the app declares the background mode, and nothing else in the repository
   * notices if it is dropped from app.json.
   */
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
      { shouldPlay: true, positionMillis: 754_000 },
      expect.any(Function),
    ));
  });

  it('start over forgets the saved place and plays from the beginning', async () => {
    mockLoadPosition.mockResolvedValue(754);
    const { findByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(await findByLabelText('Start over'));
    await waitFor(() => expect(mockClearPosition).toHaveBeenCalledWith(8));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(
      { uri: 'https://audio.example/one.mp3' },
      { shouldPlay: true, positionMillis: 0 },
      expect.any(Function),
    ));
  });

  it('skips forward and back within a loaded episode', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());

    // Drive the status callback the way expo-av does, so the component knows where it is.
    const onStatus = mockCreate.mock.calls[0][2] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, positionMillis: 100_000, durationMillis: 2_700_000, isPlaying: true, didJustFinish: false }));

    fireEvent.press(getByLabelText('Forward 30s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(130_000));

    // Skips compound from where the last one landed, not from the last status report —
    // otherwise two quick taps on Forward move the episode only once.
    fireEvent.press(getByLabelText('Back 15s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(115_000));
  });

  it('never seeks past the end or before the start', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={60} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][2] as (status: unknown) => void;

    act(() => onStatus({ isLoaded: true, positionMillis: 55_000, durationMillis: 60_000, isPlaying: true, didJustFinish: false }));
    fireEvent.press(getByLabelText('Forward 30s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(60_000));

    act(() => onStatus({ isLoaded: true, positionMillis: 5_000, durationMillis: 60_000, isPlaying: true, didJustFinish: false }));
    fireEvent.press(getByLabelText('Back 15s'));
    await waitFor(() => expect(mockSetPosition).toHaveBeenLastCalledWith(0));
  });

  it('remembers the place when the member leaves the screen', async () => {
    const { getByLabelText, unmount } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][2] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, positionMillis: 421_000, durationMillis: 2_700_000, isPlaying: true, didJustFinish: false }));

    unmount();
    expect(mockSavePosition).toHaveBeenCalledWith(8, 421, 2700);
  });

  it('forgets the place once the episode finishes', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={2700} primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalled());
    const onStatus = mockCreate.mock.calls[0][2] as (status: unknown) => void;
    act(() => onStatus({ isLoaded: true, positionMillis: 2_700_000, durationMillis: 2_700_000, isPlaying: false, didJustFinish: true }));

    await waitFor(() => expect(mockClearPosition).toHaveBeenCalledWith(8));
  });
});
