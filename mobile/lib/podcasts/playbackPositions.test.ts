// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockStore = new Map<string, string>();
jest.mock('@/lib/storage', () => ({
  storage: {
    getJson: jest.fn(async (key: string) => {
      const raw = mockStore.get(key);
      return raw ? JSON.parse(raw) : null;
    }),
    setJson: jest.fn(async (key: string, value: unknown) => {
      mockStore.set(key, JSON.stringify(value));
    }),
  },
}));

import {
  MIN_RESUMABLE_SECONDS,
  clearPodcastPosition,
  loadPodcastPosition,
  savePodcastPosition,
} from './playbackPositions';

describe('podcast playback positions', () => {
  beforeEach(() => { mockStore.clear(); });

  it('remembers where an episode reached and hands it back', async () => {
    await savePodcastPosition(11, 754, 2700);
    await expect(loadPodcastPosition(11, 2700)).resolves.toBe(754);
  });

  it('keeps episodes apart', async () => {
    await savePodcastPosition(11, 754, 2700);
    await savePodcastPosition(12, 90, 2700);
    await expect(loadPodcastPosition(12, 2700)).resolves.toBe(90);
    await expect(loadPodcastPosition(13, 2700)).resolves.toBeNull();
  });

  it('offers nothing to resume from a few seconds in — an accidental tap is not a place', async () => {
    await savePodcastPosition(11, MIN_RESUMABLE_SECONDS - 1, 2700);
    await expect(loadPodcastPosition(11, 2700)).resolves.toBeNull();
  });

  it('forgets an episode that reached the end, so it starts from the beginning next time', async () => {
    await savePodcastPosition(11, 500, 2700);
    await savePodcastPosition(11, 2695, 2700);
    await expect(loadPodcastPosition(11, 2700)).resolves.toBeNull();
  });

  it('start over forgets the mark', async () => {
    await savePodcastPosition(11, 754, 2700);
    await clearPodcastPosition(11);
    await expect(loadPodcastPosition(11, 2700)).resolves.toBeNull();
  });

  /**
   * SecureStore's Android backing store rejects a value over roughly 2 KB and
   * `lib/storage.ts` swallows the throw, so an unbounded history would eventually stop
   * saving anything at all — silently.
   */
  it('keeps only the thirty most recent episodes, newest first', async () => {
    for (let episode = 1; episode <= 40; episode += 1) {
      jest.spyOn(Date, 'now').mockReturnValue(1_000_000 + episode * 1000);
      await savePodcastPosition(episode, 100 + episode, 2700);
    }
    jest.restoreAllMocks();

    const written = JSON.parse(mockStore.get('nexus_podcast_positions_v1') as string) as Record<string, unknown>;
    expect(Object.keys(written)).toHaveLength(30);
    expect(written['40']).toBeDefined();
    expect(written['1']).toBeUndefined();
    expect(JSON.stringify(written).length).toBeLessThan(2048);
  });

  it('survives a corrupt or half-written blob rather than throwing at the player', async () => {
    mockStore.set('nexus_podcast_positions_v1', JSON.stringify({ 11: { p: 'not a number' }, 12: null, 13: { p: 300, t: 1 } }));
    await expect(loadPodcastPosition(11, 2700)).resolves.toBeNull();
    await expect(loadPodcastPosition(12, 2700)).resolves.toBeNull();
    await expect(loadPodcastPosition(13, 2700)).resolves.toBe(300);
  });
});
