// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockUnload = jest.fn();
const mockCreate = jest.fn();
jest.mock('expo-av', () => ({ Audio: { setAudioModeAsync: jest.fn(), Sound: { createAsync: (...args: unknown[]) => mockCreate(...args) } } }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'player.play': 'Play', 'player.pause': 'Pause', 'player.load_error': 'Audio unavailable', 'player.progress': 'Playback progress' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', error: '#c00', border: '#ddd' }) }));
jest.mock('@/lib/theme/accentForeground', () => ({ useAccentForeground: () => '#fff' }));
jest.mock('@/lib/api/podcasts', () => ({ recordPodcastListen: jest.fn().mockResolvedValue({ recorded: true }) }));

import PodcastAudioPlayer from './PodcastAudioPlayer';

describe('PodcastAudioPlayer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnload.mockResolvedValue(undefined);
    mockCreate.mockResolvedValue({ sound: { playAsync: mockPlay, pauseAsync: mockPause, unloadAsync: mockUnload, setPositionAsync: jest.fn() } });
  });

  it('loads and starts the episode only after the member presses Play', async () => {
    const { getByLabelText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" durationSeconds={60} primaryColor="#06f" />);
    expect(mockCreate).not.toHaveBeenCalled();
    fireEvent.press(getByLabelText('Play'));
    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith({ uri: 'https://audio.example/one.mp3' }, { shouldPlay: true }, expect.any(Function)));
  });

  it('shows visible feedback if audio loading fails', async () => {
    mockCreate.mockRejectedValue(new Error('offline'));
    const { getByLabelText, findByText } = render(<PodcastAudioPlayer episodeId={8} audioUrl="https://audio.example/one.mp3" primaryColor="#06f" />);
    fireEvent.press(getByLabelText('Play'));
    expect(await findByText('Audio unavailable')).toBeTruthy();
  });
});
