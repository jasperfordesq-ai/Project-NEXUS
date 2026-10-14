// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Idempotency keys and draft persistence for the organiser's message composer
 * (E-106).
 *
 * The old screen minted a fresh Idempotency-Key on every click, so a press
 * that timed out and was pressed again created a second draft. Here a key
 * belongs to one LOGICAL operation: the same payload replays the same key (the
 * server answers with the original result), and only a changed payload gets a
 * new one.
 */

import type {
  EventBroadcastChannel,
  EventBroadcastContentInput,
  EventBroadcastSegment,
  EventBroadcastVariant,
} from '@/lib/event-communications-api';

export type ComposerOp = 'create' | 'revise' | 'schedule' | 'cancel' | 'retry';

/** op (optionally with a target, e.g. `cancel:8`) → the key issued for its current signature. */
export type KeyLedger = Record<string, { signature: string; key: string }>;

export function newIdempotencyKey(op: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `event-broadcast-${op}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * The key for `op` with this payload `signature`. Same signature → same key
 * (a retry replays); a different signature → a new key. Mutates `ledger`.
 */
export function keyFor(
  ledger: KeyLedger,
  op: string,
  signature: string,
  makeKey: (op: string) => string = newIdempotencyKey,
): string {
  const known = ledger[op];
  if (known && known.signature === signature) return known.key;
  const key = makeKey(op);
  ledger[op] = { signature, key };
  return key;
}

export function contentSignature(content: EventBroadcastContentInput): string {
  return JSON.stringify({
    variant: content.variant,
    segments: [...content.segments].sort(),
    channels: [...content.channels].sort(),
    body: content.body,
  });
}

export function scheduleSignature(broadcastId: number, scheduledAt: string | null): string {
  return `${broadcastId}|${scheduledAt ?? 'now'}`;
}

export function versionSignature(broadcastId: number, version: number): string {
  return `${broadcastId}|${version}`;
}

/** Everything the composer form holds, as plain JSON-safe values. */
export interface ComposerValues {
  variant: EventBroadcastVariant;
  segments: EventBroadcastSegment[];
  channels: EventBroadcastChannel[];
  body: string;
  when: 'now' | 'later';
  /** YYYY-MM-DD in the event zone, or null. */
  date: string | null;
  /** HH:MM in the event zone, or null. */
  time: string | null;
}

export type ComposerMode = 'new' | 'edit' | 'change';

export interface PersistedComposer {
  values: ComposerValues;
  mode: ComposerMode;
  sourceId: number | null;
  session: KeyLedger;
}

export function initialComposerValues(): ComposerValues {
  return {
    variant: 'announcement',
    segments: ['registration_confirmed'],
    channels: ['email', 'in_app'],
    body: '',
    when: 'now',
    date: null,
    time: null,
  };
}

export function composerStorageKey(eventId: number): string {
  return `event-communications:${eventId}:composer`;
}

const VARIANTS = new Set(['announcement', 'follow_up', 'review_request']);
const SEGMENTS = new Set(['registration_confirmed', 'waitlist_active', 'attendance_attended', 'attendance_no_show']);
const CHANNELS = new Set(['email', 'in_app', 'push']);

function isStringArray(value: unknown, allowed: Set<string>): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && allowed.has(item));
}

function readValues(value: unknown): ComposerValues | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.variant !== 'string' || !VARIANTS.has(v.variant)) return null;
  if (!isStringArray(v.segments, SEGMENTS) || !isStringArray(v.channels, CHANNELS)) return null;
  if (typeof v.body !== 'string') return null;
  if (v.when !== 'now' && v.when !== 'later') return null;
  const date = typeof v.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.date) ? v.date : null;
  const time = typeof v.time === 'string' && /^\d{2}:\d{2}$/.test(v.time) ? v.time : null;
  return {
    variant: v.variant as EventBroadcastVariant,
    segments: v.segments as EventBroadcastSegment[],
    channels: v.channels as EventBroadcastChannel[],
    body: v.body,
    when: v.when,
    date,
    time,
  };
}

function readLedger(value: unknown): KeyLedger {
  if (!value || typeof value !== 'object') return {};
  const ledger: KeyLedger = {};
  Object.entries(value as Record<string, unknown>).forEach(([op, entry]) => {
    if (entry && typeof entry === 'object') {
      const { signature, key } = entry as Record<string, unknown>;
      if (typeof signature === 'string' && typeof key === 'string') ledger[op] = { signature, key };
    }
  });
  return ledger;
}

/** Storage is optional: private windows and locked-down browsers throw. Never let that break the page. */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadComposer(eventId: number): PersistedComposer | null {
  try {
    const raw = storage()?.getItem(composerStorageKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const values = readValues(parsed.values);
    if (!values) return null;
    const mode = parsed.mode === 'edit' || parsed.mode === 'change' ? parsed.mode : 'new';
    const sourceId = typeof parsed.sourceId === 'number' && parsed.sourceId > 0 ? parsed.sourceId : null;
    return { values, mode, sourceId, session: readLedger(parsed.session) };
  } catch {
    return null;
  }
}

export function saveComposer(eventId: number, persisted: PersistedComposer): void {
  try {
    storage()?.setItem(composerStorageKey(eventId), JSON.stringify(persisted));
  } catch {
    // Quota or privacy mode: losing the safety copy must not stop the organiser writing.
  }
}

export function clearComposer(eventId: number): void {
  try {
    storage()?.removeItem(composerStorageKey(eventId));
  } catch {
    // See saveComposer.
  }
}

export function valuesToContent(values: ComposerValues): EventBroadcastContentInput {
  return {
    variant: values.variant,
    segments: values.segments,
    channels: values.channels,
    body: values.body,
  };
}

export function sameValues(a: ComposerValues, b: ComposerValues): boolean {
  return JSON.stringify({ ...a, segments: [...a.segments].sort(), channels: [...a.channels].sort() })
    === JSON.stringify({ ...b, segments: [...b.segments].sort(), channels: [...b.channels].sort() });
}
