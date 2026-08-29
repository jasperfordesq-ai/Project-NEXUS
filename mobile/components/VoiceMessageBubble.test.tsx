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
let mockPlaybackUpdate: ((status: Record<string, unknown>) => void) | undefined;

jest.mock('expo-av', () => ({
  Audio: {
    setAudioModeAsync: (...args: unknown[]) => mockSetAudioMode(...args),
    Sound: {
      createAsync: (...args: unknown[]) => mockCreateAsync(...args),
    },
  },
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
  pauseAsync: mockPause,
  playAsync: mockPlay,
  unloadAsync: mockUnload,
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
    mockCreateAsync.mockImplementation(async (_source, _initial, update) => {
      mockPlaybackUpdate = update;
      return { sound };
    });
  });

  it('loads private audio with authenticated media headers and exposes playback state', async () => {
    const { getByLabelText, getByText } = renderBubble();
    expect(getByText('1:05')).toBeTruthy();

    fireEvent.press(getByLabelText('Play voice message'));

    await waitFor(() => expect(mockAuthenticatedMediaRequest).toHaveBeenCalledWith(
      'https://api.example.test/private/voice.m4a',
    ));
    expect(mockSetAudioMode).toHaveBeenCalledWith({ playsInSilentModeIOS: true });
    expect(mockCreateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.any(Object) }),
      { shouldPlay: true },
      expect.any(Function),
    );
    expect(getByLabelText('Pause voice message')).toBeTruthy();

    await act(async () => {
      mockPlaybackUpdate?.({ isLoaded: true, positionMillis: 5_000, durationMillis: 65_000 });
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
    await waitFor(() => expect(mockPlay).toHaveBeenCalledTimes(1));
    expect(mockCreateAsync).toHaveBeenCalledTimes(1);
  });

  it('shows visible failure copy and releases the sound on unmount', async () => {
    mockCreateAsync.mockRejectedValueOnce(new Error('media unavailable'));
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
});
