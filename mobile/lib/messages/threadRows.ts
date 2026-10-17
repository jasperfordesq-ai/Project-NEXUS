// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { Message } from '@/lib/api/messages';
import { dateLocale } from '@/lib/utils/dateLocale';

/** Where a bubble sits in a run of consecutive messages from one sender. */
export type GroupPosition = 'single' | 'first' | 'middle' | 'last';

export type ThreadRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'message'; key: string; message: Message; groupPosition: GroupPosition };

export interface BuildThreadRowsOptions {
  /** The current time (ms or Date); drives Today / Yesterday. */
  now: number | Date;
  t: (key: string) => string;
}

/** Two messages this close together from the same sender read as one group. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function senderKey(message: Message): string {
  const id = message.sender_id ?? message.sender?.id;
  return `${message.is_own ? 'own' : 'other'}:${id ?? 'unknown'}`;
}

function dayLabel(date: Date, now: Date, t: (key: string) => string): string {
  const key = localDayKey(date);
  if (key === localDayKey(now)) return t('thread.today');
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (key === localDayKey(yesterday)) return t('thread.yesterday');
  const options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  // Always the app's chosen language and the community's region, never the device's
  // (mobile/scripts/check-date-locale.mjs enforces this).
  return date.toLocaleDateString(dateLocale(), options);
}

/**
 * Turn a sorted list of messages into list rows: a date chip whenever the day changes, and
 * each message tagged with its position in a run from one sender (same sender, under five
 * minutes apart, same day). Pure, so the thread can memoise it and the rule is testable.
 */
export function buildThreadRows(messages: readonly Message[], options: BuildThreadRowsOptions): ThreadRow[] {
  const now = options.now instanceof Date ? options.now : new Date(options.now);
  const rows: ThreadRow[] = [];
  let previousDay: string | null = null;

  const groupsWith = (a: Message | undefined, b: Message | undefined): boolean => {
    if (!a || !b) return false;
    const aTime = new Date(a.created_at);
    const bTime = new Date(b.created_at);
    if (localDayKey(aTime) !== localDayKey(bTime)) return false;
    if (senderKey(a) !== senderKey(b)) return false;
    return Math.abs(bTime.getTime() - aTime.getTime()) < GROUP_WINDOW_MS;
  };

  messages.forEach((message, index) => {
    const date = new Date(message.created_at);
    const day = localDayKey(date);
    if (day !== previousDay) {
      rows.push({ kind: 'date', key: `date-${day}`, label: dayLabel(date, now, options.t) });
      previousDay = day;
    }
    const joinsPrevious = groupsWith(messages[index - 1], message);
    const joinsNext = groupsWith(message, messages[index + 1]);
    const groupPosition: GroupPosition = joinsPrevious && joinsNext
      ? 'middle'
      : joinsPrevious ? 'last' : joinsNext ? 'first' : 'single';
    rows.push({ kind: 'message', key: `message-${message.id}`, message, groupPosition });
  });

  return rows;
}
