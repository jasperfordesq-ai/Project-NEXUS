// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { createAudioPlayer, type AudioSource, type AudioStatus } from 'expo-audio';

/** Load with a bounded wait; native decoder/network failures must not spin forever. */
export function loadAudioPlayer(source: AudioSource, onStatus: (status: AudioStatus) => void, signal: AbortSignal) {
  return new Promise<{ player: ReturnType<typeof createAudioPlayer>; release: () => void }>((resolve, reject) => {
    if (signal.aborted) { reject(new Error('Audio load cancelled')); return; }
    const player = createAudioPlayer(source, { updateInterval: 250 });
    let released = false;
    let settled = false;
    let subscription: { remove: () => void } | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const release = () => {
      if (released) return;
      released = true;
      clearTimeout(timer);
      subscription?.remove();
      signal.removeEventListener('abort', abort);
      player.remove();
    };
    const fail = (message: string) => {
      release();
      if (!settled) { settled = true; reject(new Error(message)); }
    };
    const abort = () => fail('Audio load cancelled');
    const update = (status: AudioStatus) => {
      if (released) return;
      onStatus(status);
      if (status.playbackState === 'error' || status.playbackState === 'failed') {
        fail('Audio unavailable');
      } else if (status.isLoaded && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ player, release });
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    subscription = player.addListener('playbackStatusUpdate', update);
    timer = setTimeout(() => fail('Audio load timed out'), 15_000);
    if (signal.aborted) abort();
    else if (player.isLoaded) update(player.currentStatus);
  });
}
