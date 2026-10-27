// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockPlayer = {
  isLoaded: true,
  currentStatus: { isLoaded: true, playbackState: 'ready' },
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  pause: jest.fn(),
  clearLockScreenControls: jest.fn(),
  remove: jest.fn(),
  release: jest.fn(),
};

jest.mock('expo-audio', () => ({ createAudioPlayer: jest.fn(() => mockPlayer) }));

import { loadAudioPlayer } from './loadAudioPlayer';

describe('loadAudioPlayer', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stops the sound and frees the native player when released', async () => {
    const sound = await loadAudioPlayer({ uri: 'https://example.test/a.mp3' }, jest.fn(), new AbortController().signal);

    sound.release();

    // `remove()` alone only unregisters the player from expo-audio's list: the native player
    // keeps playing, with nothing left in the app able to pause it.
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockPlayer.clearLockScreenControls).toHaveBeenCalled();
    expect(mockPlayer.release).toHaveBeenCalled();
  });

  it('releases only once', async () => {
    const sound = await loadAudioPlayer({ uri: 'https://example.test/a.mp3' }, jest.fn(), new AbortController().signal);

    sound.release();
    sound.release();

    expect(mockPlayer.release).toHaveBeenCalledTimes(1);
  });

  it('frees the native player when loading is cancelled', async () => {
    const controller = new AbortController();
    mockPlayer.isLoaded = false;
    const pending = loadAudioPlayer({ uri: 'https://example.test/a.mp3' }, jest.fn(), controller.signal);

    controller.abort();

    await expect(pending).rejects.toThrow('Audio load cancelled');
    expect(mockPlayer.release).toHaveBeenCalled();
    mockPlayer.isLoaded = true;
  });
});
