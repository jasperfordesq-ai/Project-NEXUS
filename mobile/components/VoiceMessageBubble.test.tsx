// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockCreateAsync = jest.fn();
const mockSetAudioMode = jest.fn();
const mockAuthenticatedMediaRequest = jest.fn();
const mockPause = jest.fn();
const mockPlay = jest.fn();
const mockUnload = jest.fn();
const mockSeek = jest.fn();
let mockPlaybackUpdate: ((status: Record<string, unknown>) => void) | undefined;

jest.mock('expo-audio', () => ({
  setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args),
  createAudioPlayer: (...args: unknown[]) => mockCreateAsync(...args),
}));

jest.mock('@/lib/api/client', () => ({
  authenticatedMediaRequest: (...args: unknown[]) => mockAuthenticatedMediaRequest(...args),
}));

jest.mock('@/components/ui/Icon', () => ({ Ionicons: () => null }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ border: '#d4d4d8', error: '#b91c1c' }),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'voice.play': 'Play voice message',
      'voice.pause': 'Pause voice message',
      'voice.failed': 'Voice message failed',
      'voice.label': 'Voice message',
    } as Record<string, string>)[key] ?? key,
  }),
}));

import VoiceMessageBubble from './VoiceMessageBubble';

const sound = {
  pause: mockPause,
  play: mockPlay,
  remove: mockUnload,
  seekTo: mockSeek,
  isLoaded: true,
  currentStatus: { isLoaded: true, currentTime: 0, duration: 65, playing: false, playbackState: 'readyToPlay' },
  addListener: jest.fn((_event, callback) => { mockPlaybackUpdate = callback; return { remove: jest.fn() }; }),
};

function renderBubble() {
  return render(
    <VoiceMessageBubble
      audioUrl="https://api.example.test/private/voice.m4a"
      durationMs={65_000}
      isOwn={false}
      primaryColor="#2563eb"
      textColor="#111111"
      textColorSecondary="#555555"
    />,
  );
}

describe('VoiceMessageBubble', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetAudioMode.mockResolvedValue(undefined);
    mockAuthenticatedMediaRequest.mockResolvedValue({
      uri: 'https://api.example.test/private/voice.m4a',
      headers: { Authorization: 'Bearer redacted' },
    });
    mockPause.mockResolvedValue(undefined);
    mockPlay.mockResolvedValue(undefined);
    mockUnload.mockResolvedValue(undefined);
    mockSeek.mockResolvedValue(undefined);
    mockCreateAsync.mockImplementation(() => sound);
  });

  it('loads private audio with authenticated media headers and exposes playback state', async () => {
    const { getByLabelText, getByText } = renderBubble();
    expect(getByText('1:05')).toBeTruthy();

    fireEvent.press(getByLabelText('Play voice message'));

    await waitFor(() => expect(mockAuthenticatedMediaRequest).toHaveBeenCalledWith(
      'https://api.example.test/private/voice.m4a',
    ));
    expect(mockSetAudioMode).toHaveBeenCalledWith(expect.objectContaining({ playsInSilentMode: true, allowsRecording: false }));
    expect(mockCreateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.any(Object) }),
      { updateInterval: 250 },
    );
    expect(getByLabelText('Pause voice message')).toBeTruthy();

    await act(async () => {
      mockPlaybackUpdate?.({ isLoaded: true, currentTime: 5, duration: 65, playing: true });
    });
    expect(getByText('1:00')).toBeTruthy();
  });

  it('pauses and resumes the already-loaded sound without downloading it again', async () => {
    const { getByLabelText } = renderBubble();
    fireEvent.press(getByLabelText('Play voice message'));
    await waitFor(() => expect(getByLabelText('Pause voice message')).toBeTruthy());

    fireEvent.press(getByLabelText('Pause voice message'));
    await waitFor(() => expect(mockPause).toHaveBeenCalledTimes(1));
    fireEvent.press(getByLabelText('Play voice message'));
    await waitFor(() => expect(mockPlay).toHaveBeenCalledTimes(2));
    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows visible failure copy and releases the sound on unmount', async () => {
    mockCreateAsync.mockImplementationOnce(() => { throw new Error('media unavailable'); });
    const failed = renderBubble();
    fireEvent.press(failed.getByLabelText('Play voice message'));
    expect(await failed.findByText('Voice message failed')).toBeTruthy();
    failed.unmount();

    const loaded = renderBubble();
    fireEvent.press(loaded.getByLabelText('Play voice message'));
    await waitFor(() => expect(loaded.getByLabelText('Pause voice message')).toBeTruthy());
    loaded.unmount();
    expect(mockUnload).toHaveBeenCalledTimes(1);
  });

  it('seeks to the beginning when replaying a finished voice message', async () => {
    const ui = renderBubble();
    fireEvent.press(ui.getByLabelText('Play voice message'));
    await ui.findByLabelText('Pause voice message');
    act(() => mockPlaybackUpdate?.({ isLoaded: true, currentTime: 65, duration: 65, playing: false, didJustFinish: true }));
    fireEvent.press(ui.getByLabelText('Play voice message'));
    await waitFor(() => expect(mockSeek).toHaveBeenCalledWith(0));
    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });

  it('does not create audio after a pending authorization resolves on an unmounted message', async () => {
    let release!: (source: { uri: string }) => void;
    mockAuthenticatedMediaRequest.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    const ui = renderBubble();
    fireEvent.press(ui.getByLabelText('Play voice message'));
    await waitFor(() => expect(mockAuthenticatedMediaRequest).toHaveBeenCalled());
    ui.unmount();
    await act(async () => { release({ uri: 'https://api.example.test/private/voice.m4a' }); });
    expect(mockCreateAsync).not.toHaveBeenCalled();
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it('releases a stalled native load and exposes retry instead of spinning forever', async () => {
    jest.useFakeTimers();
    try {
      mockCreateAsync.mockReturnValueOnce({ ...sound, isLoaded: false });
      const ui = renderBubble();
      await act(async () => { fireEvent.press(ui.getByLabelText('Play voice message')); });
      await act(async () => { jest.advanceTimersByTime(15_000); });
      expect(ui.getByText('Voice message failed')).toBeTruthy();
      expect(mockUnload).toHaveBeenCalledTimes(1);
      await act(async () => { fireEvent.press(ui.getByLabelText('Play voice message')); });
      expect(mockCreateAsync).toHaveBeenCalledTimes(2);
      expect(ui.getByLabelText('Pause voice message')).toBeTruthy();
      ui.unmount();
    } finally { jest.useRealTimers(); }
  });
});
