// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Pure presentation rules for the organiser's "Messages to attendees" list
 * (E-106). Everything here turns a broadcast's raw counts into ONE plain
 * description; the components translate it. Keeping the rules pure means the
 * awkward cases (one failed recipient out of forty, a scheduled time that has
 * just passed) are unit-tested rather than discovered by an organiser.
 */

import type { EventBroadcast } from '@/lib/event-communications-api';

/** A scheduled message this close to its time is described as "Sending shortly". */
export const DUE_WINDOW_MS = 60_000;

export type BroadcastKind =
  | 'draft'
  | 'scheduled'
  | 'due'
  | 'sending'
  | 'sent'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type BroadcastTone = 'default' | 'primary' | 'success' | 'warning' | 'danger';

export interface BroadcastDescription {
  kind: BroadcastKind;
  tone: BroadcastTone;
  /** The instant the status line talks about, or null when none applies or none was recorded. */
  whenIso: string | null;
  /** `whenIso` formatted in the event zone, or null. */
  whenLabel: string | null;
  /** People the message is (or was) addressed to. */
  people: number;
  delivered: number;
  total: number;
  skipped: number;
  failed: number;
  /** Work still in flight while sending. */
  pending: number;
  /** 0–100 while sending; null otherwise. */
  progress: number | null;
}

/** "Europe/Dublin" → "Dublin", "America/Argentina/Buenos_Aires" → "Buenos Aires". */
export function timeZoneCity(iana: string): string {
  const trimmed = iana.trim();
  if (!trimmed) return '';
  const last = trimmed.split('/').pop() ?? trimmed;
  return last.replace(/_/g, ' ');
}

function parseInstant(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A date and time in the given zone, in the reader's language; null when it cannot be read. */
export function formatWhen(iso: string | null | undefined, timeZone: string, locale?: string): string | null {
  const date = parseInstant(iso);
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
}

/** True when a scheduled message is at (or within a minute of) its time. */
export function isDue(broadcast: Pick<EventBroadcast, 'status' | 'scheduled_at'>, now: number): boolean {
  if (broadcast.status !== 'scheduled') return false;
  const at = parseInstant(broadcast.scheduled_at);
  return at === null || at.getTime() <= now + DUE_WINDOW_MS;
}

export function describeBroadcast(
  broadcast: EventBroadcast,
  now: number,
  timeZone: string,
  locale?: string,
): BroadcastDescription {
  const { delivered, total, suppressed, dead_lettered: deadLettered } = broadcast.delivery;
  const pending = Math.max(0, total - delivered - suppressed - deadLettered);
  const base = {
    people: broadcast.audience.recipient_count,
    delivered,
    total,
    skipped: suppressed,
    failed: deadLettered,
    pending,
    progress: null as number | null,
  };
  const at = (iso: string | null) => ({ whenIso: iso, whenLabel: formatWhen(iso, timeZone, locale) });

  switch (broadcast.status) {
    case 'draft':
      return { ...base, ...at(null), kind: 'draft', tone: 'default' };
    case 'scheduled':
      return isDue(broadcast, now)
        ? { ...base, ...at(broadcast.scheduled_at), kind: 'due', tone: 'primary' }
        : { ...base, ...at(broadcast.scheduled_at), kind: 'scheduled', tone: 'primary' };
    case 'sending': {
      const done = total > 0 ? Math.round(((delivered + suppressed + deadLettered) / total) * 100) : 0;
      return { ...base, ...at(null), kind: 'sending', tone: 'primary', progress: Math.min(100, done) };
    }
    case 'cancelled':
      return { ...base, ...at(broadcast.cancelled_at), kind: 'cancelled', tone: 'default' };
    case 'sent':
    case 'failed': {
      const when = broadcast.status === 'sent'
        ? broadcast.sent_at ?? broadcast.failed_at
        : broadcast.failed_at ?? broadcast.sent_at;
      if (delivered === 0 && (broadcast.status === 'failed' || deadLettered > 0)) {
        return { ...base, ...at(when), kind: 'failed', tone: 'danger' };
      }
      if (suppressed === 0 && deadLettered === 0) {
        return { ...base, ...at(when), kind: 'sent', tone: 'success' };
      }
      // Mostly delivered is a warning, not a failure: one bounced address
      // must not paint a message that reached 39 people red.
      const tone: BroadcastTone = total > 0 && delivered / total >= 0.5 ? 'warning' : 'danger';
      return { ...base, ...at(when), kind: 'partial', tone };
    }
    default:
      return { ...base, ...at(null), kind: 'draft', tone: 'default' };
  }
}

/** Polling is worth it only while something is (about to be) on its way. */
export function needsPolling(broadcasts: EventBroadcast[], now: number): boolean {
  return broadcasts.some((broadcast) => broadcast.status === 'sending' || isDue(broadcast, now));
}

export const SKIPPED_REASON_KEYS = [
  'email_cadence_off',
  'email_channel_disabled',
  'email_destination_missing',
  'email_provider_suppressed',
  'in_app_channel_disabled',
  'push_channel_disabled',
  'push_destination_missing',
  'recipient_ineligible',
  'safeguarding_contact_denied',
  'organizer_broadcasts_disabled',
  'events_feature_disabled',
] as const;

export const FAILED_REASON_KEYS = [
  'event_broadcast_email_provider_rejected',
  'event_broadcast_email_destination_invalid',
  'event_broadcast_email_provider_suppressed',
  'event_broadcast_push_provider_rejected',
  'event_broadcast_push_destination_missing',
  'event_broadcast_push_channel_disabled',
  'event_broadcast_stale_claim_released',
  'event_broadcast_content_integrity_failed',
  'event_broadcast_safeguarding_unavailable',
  'event_broadcast_delivery_contract_unavailable',
  'event_broadcast_provider_failure',
] as const;

/** Translation key suffix for a reason, with a catch-all for codes this client does not know yet. */
export function reasonKey(reason: string, known: readonly string[]): string {
  return known.includes(reason) ? reason : 'other';
}

/** Folds reason counts into known keys (unknown ones summed under "other"), largest first. */
export function groupReasons(
  reasons: Record<string, number> | undefined,
  known: readonly string[],
): Array<{ key: string; count: number }> {
  const grouped = new Map<string, number>();
  Object.entries(reasons ?? {}).forEach(([reason, count]) => {
    if (count <= 0) return;
    const key = reasonKey(reason, known);
    grouped.set(key, (grouped.get(key) ?? 0) + count);
  });
  return [...grouped.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

/** Short excerpt for a card or an accessible name; null when there is no text. */
export function broadcastExcerpt(broadcast: EventBroadcast, max = 140): string | null {
  const source = broadcast.summary?.excerpt ?? broadcast.body ?? null;
  if (source === null) return null;
  const collapsed = source.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}
