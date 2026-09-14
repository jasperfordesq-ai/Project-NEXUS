// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';

/**
 * Where a member got to in each podcast episode, kept on the device.
 *
 * 🔴 This is deliberately LOCAL, not server-side. `POST /v2/podcasts/episodes/{id}/listen`
 * accepts a `position_seconds` for analytics but nothing in the API ever hands it back —
 * `PodcastEpisode` has no resume field. Sending the position somewhere it cannot be read
 * from would look like a resume feature and behave like nothing at all.
 *
 * 🔴 Underscores only. `expo-secure-store` refuses a key containing anything outside
 * `[A-Za-z0-9._-]` and `storage.set` swallows the throw, so a colon here would mean every
 * write silently vanished. Guarded by `lib/secureStoreKeys.test.ts`.
 */
const POSITIONS_STORAGE_KEY_PREFIX = 'nexus_podcast_positions_v2';

export interface PodcastPlaybackScope {
  tenantId: number;
  userId: number;
}

/**
 * SecureStore's Android backing store rejects values over roughly 2 KB, so this cannot be
 * an unbounded history. Thirty episodes at ~30 bytes each stays comfortably inside that,
 * and the oldest entry is dropped first.
 */
const MAX_TRACKED_EPISODES = 30;

/**
 * Below this, resuming is worse than starting again — a member who pressed play by
 * accident does not want to be dropped four seconds in on their next visit.
 */
export const MIN_RESUMABLE_SECONDS = 15;

/**
 * Within this much of the end the episode counts as finished: clear the mark rather than
 * offering to resume someone into the closing credits.
 */
export const END_OF_EPISODE_SECONDS = 20;

/** `p` position in whole seconds, `t` when it was written. Short keys keep the blob small. */
interface StoredPosition {
  p: number;
  t: number;
}

type PositionMap = Record<string, StoredPosition>;

function storageKey(scope: PodcastPlaybackScope): string | null {
  const tenantId = Number(scope.tenantId);
  const userId = Number(scope.userId);
  if (!Number.isSafeInteger(tenantId) || tenantId <= 0 || !Number.isSafeInteger(userId) || userId <= 0) {
    return null;
  }
  return `${POSITIONS_STORAGE_KEY_PREFIX}_t${tenantId}_u${userId}`;
}

async function readAll(key: string): Promise<PositionMap> {
  const raw = await storage.getJson<PositionMap>(key);
  if (!raw || typeof raw !== 'object') return {};
  const cleaned: PositionMap = {};
  for (const [id, entry] of Object.entries(raw)) {
    if (!entry || typeof entry !== 'object') continue;
    const position = Number((entry as StoredPosition).p);
    const at = Number((entry as StoredPosition).t);
    if (!Number.isFinite(position) || position <= 0) continue;
    cleaned[id] = { p: Math.round(position), t: Number.isFinite(at) ? at : 0 };
  }
  return cleaned;
}

async function writeAll(key: string, map: PositionMap): Promise<void> {
  const entries = Object.entries(map);
  if (entries.length > MAX_TRACKED_EPISODES) {
    entries.sort((a, b) => b[1].t - a[1].t);
    entries.length = MAX_TRACKED_EPISODES;
  }
  await storage.setJson(key, Object.fromEntries(entries));
}

/** Keep the whole read/change/write transaction ordered, not only each storage call. */
const pendingScopeOperations = new Map<string, Promise<void>>();

function inScopeOrder<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const result = (pendingScopeOperations.get(key) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => undefined, () => undefined);
  pendingScopeOperations.set(key, settled);
  void settled.then(() => {
    if (pendingScopeOperations.get(key) === settled) pendingScopeOperations.delete(key);
  });
  return result;
}

async function clearPosition(key: string, episodeId: number): Promise<void> {
  const map = await readAll(key);
  if (!(String(episodeId) in map)) return;
  delete map[String(episodeId)];
  await writeAll(key, map);
}

/**
 * The saved position for one episode, in seconds, or null when there is nothing worth
 * resuming from. `durationSeconds` is optional because the browse projection does not
 * always carry it; without it the end-of-episode rule simply cannot apply.
 */
export async function loadPodcastPosition(
  scope: PodcastPlaybackScope,
  episodeId: number,
  durationSeconds?: number | null,
): Promise<number | null> {
  const key = storageKey(scope);
  if (!key) return null;
  return inScopeOrder(key, async () => {
    const entry = (await readAll(key))[String(episodeId)];
    if (!entry) return null;
    if (entry.p < MIN_RESUMABLE_SECONDS) return null;
    if (durationSeconds && entry.p >= durationSeconds - END_OF_EPISODE_SECONDS) return null;
    return entry.p;
  });
}

/**
 * Remember where playback has reached. Positions inside the first or last few seconds are
 * treated as "no mark" and clear any existing one, so finishing an episode and then
 * reopening it starts from the beginning.
 */
export async function savePodcastPosition(
  scope: PodcastPlaybackScope,
  episodeId: number,
  positionSeconds: number,
  durationSeconds?: number | null,
): Promise<void> {
  const key = storageKey(scope);
  if (!key) return;
  const position = Math.round(positionSeconds);
  const finished = Boolean(durationSeconds) && position >= (durationSeconds as number) - END_OF_EPISODE_SECONDS;
  await inScopeOrder(key, async () => {
    if (!Number.isFinite(position) || position < MIN_RESUMABLE_SECONDS || finished) {
      await clearPosition(key, episodeId);
      return;
    }
    const map = await readAll(key);
    map[String(episodeId)] = { p: position, t: Date.now() };
    await writeAll(key, map);
  });
}

/** Forget where an episode had reached — used by "Start over" and on completion. */
export async function clearPodcastPosition(scope: PodcastPlaybackScope, episodeId: number): Promise<void> {
  const key = storageKey(scope);
  if (!key) return;
  await inScopeOrder(key, () => clearPosition(key, episodeId));
}
