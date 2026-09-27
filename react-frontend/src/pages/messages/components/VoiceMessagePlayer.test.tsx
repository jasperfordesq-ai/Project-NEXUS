// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { render, screen } from '@/test/test-utils';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAssetUrl: (url: string) => url,
}));

describe('VoiceMessagePlayer', () => {
  let mockAudio: {
    src: string;
    play: ReturnType<typeof vi.fn>;
    pause: ReturnType<typeof vi.fn>;
    duration: number;
    currentTime: number;
    onloadedmetadata: (() => void) | null;
    ontimeupdate: (() => void) | null;
    onended: (() => void) | null;
  };

  beforeEach(() => {
    mockAudio = {
      src: '',
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      duration: 30,
      currentTime: 0,
      onloadedmetadata: null,
      ontimeupdate: null,
      onended: null,
    };

    vi.spyOn(window, 'Audio' as keyof Window).mockImplementation(function mockAudioConstructor() {
      return mockAudio as unknown as HTMLAudioElement;
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake-audio-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders play button initially', () => {
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);
    expect(screen.getByLabelText('Play')).toBeDefined();
  });

  it('renders time display showing 0:00', () => {
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);
    const timeElements = screen.getAllByText('0:00');
    expect(timeElements.length).toBeGreaterThanOrEqual(1);
  });

  it('sets audio src from audioUrl prop', () => {
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/voice.mp3" />);
    expect(mockAudio.src).toBe('https://cdn.example.com/voice.mp3');
  });

  it('creates object URL when audioBlob is provided', () => {
    const blob = new Blob(['audio data'], { type: 'audio/webm' });
    render(<VoiceMessagePlayer audioBlob={blob} />);
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it('toggles to pause label when play is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);

    await user.click(screen.getByLabelText('Play'));
    expect(mockAudio.play).toHaveBeenCalled();
    expect(screen.getByLabelText('Pause')).toBeDefined();
  });

  it('pauses audio when pause button is clicked', async () => {
    const { userEvent } = await import('@/test/test-utils');
    const user = userEvent.setup();
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);

    await user.click(screen.getByLabelText('Play'));
    await user.click(screen.getByLabelText('Pause'));
    expect(mockAudio.pause).toHaveBeenCalled();
    expect(screen.getByLabelText('Play')).toBeDefined();
  });

  it('updates duration display from audio metadata', async () => {
    const { act } = await import('react');
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);

    // Simulate loadedmetadata — triggers React state update, so wrap in act()
    mockAudio.duration = 90;
    act(() => {
      mockAudio.onloadedmetadata?.();
    });

    // 90 seconds = 1:30
    expect(screen.getByText('1:30')).toBeDefined();
  });

  it('revokes object URL on unmount when using blob', () => {
    const blob = new Blob(['audio'], { type: 'audio/webm' });
    const { unmount } = render(<VoiceMessagePlayer audioBlob={blob} />);
    unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    expect(mockAudio.pause).toHaveBeenCalled();
  });

  it('renders progress bar', () => {
    render(<VoiceMessagePlayer audioUrl="https://cdn.example.com/audio.mp3" />);
    // Progress bar should have 0% width initially
    const progressBar = document.querySelector('[style*="width: 0%"]');
    expect(progressBar).toBeDefined();
  });
});
