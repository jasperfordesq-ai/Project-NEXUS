// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { Message } from '@/lib/api/messages';
import { buildThreadRows } from './threadRows';

const t = (key: string) => ({ 'thread.today': 'Today', 'thread.yesterday': 'Yesterday' }[key] ?? key);

function message(id: number, senderId: number, at: Date, extra: Partial<Message> = {}): Message {
  return {
    id,
    body: `m${id}`,
    sender: { id: senderId, name: `User ${senderId}`, avatar_url: null },
    sender_id: senderId,
    created_at: at.toISOString(),
    is_own: senderId === 1,
    is_voice: false,
    audio_url: null,
    reactions: {},
    is_read: true,
    ...extra,
  };
}

// Local-time constructors so the day boundaries land where the device would put them.
const now = new Date(2026, 2, 10, 12, 0, 0);

describe('buildThreadRows', () => {
  it('inserts Today and Yesterday separators and groups consecutive bubbles', () => {
    const rows = buildThreadRows([
      message(1, 5, new Date(2026, 2, 9, 18, 0)),
      message(2, 5, new Date(2026, 2, 10, 10, 0)),
      message(3, 5, new Date(2026, 2, 10, 10, 2)),
      message(4, 5, new Date(2026, 2, 10, 10, 4)),
      message(5, 1, new Date(2026, 2, 10, 10, 5)),
      message(6, 1, new Date(2026, 2, 10, 10, 11)),
    ], { now, t });

    expect(rows.map((row) => (row.kind === 'date' ? `date:${row.label}` : `${row.message.id}:${row.groupPosition}`))).toEqual([
      'date:Yesterday',
      '1:single',
      'date:Today',
      '2:first',
      '3:middle',
      '4:last',
      '5:single',
      // Six minutes after the previous own message: a new group of one.
      '6:single',
    ]);
  });

  it('labels older days with the short weekday, day and month, adding the year when it differs', () => {
    const rows = buildThreadRows([
      message(1, 5, new Date(2025, 0, 5, 9, 0)),
      message(2, 5, new Date(2026, 1, 20, 9, 0)),
    ], { now, t });

    const dates = rows.filter((row) => row.kind === 'date').map((row) => (row.kind === 'date' ? row.label : ''));
    expect(dates).toHaveLength(2);
    expect(dates[0]).toMatch(/Jan/);
    expect(dates[0]).toMatch(/2025/);
    expect(dates[1]).toMatch(/Feb/);
    expect(dates[1]).not.toMatch(/2026/);
  });

  it('never groups across a date boundary or a change of sender', () => {
    const rows = buildThreadRows([
      message(1, 5, new Date(2026, 2, 9, 23, 59)),
      message(2, 5, new Date(2026, 2, 10, 0, 1)),
      message(3, 1, new Date(2026, 2, 10, 0, 2)),
    ], { now, t });

    expect(rows.map((row) => (row.kind === 'date' ? `date:${row.label}` : `${row.message.id}:${row.groupPosition}`))).toEqual([
      'date:Yesterday', '1:single', 'date:Today', '2:single', '3:single',
    ]);
  });

  it('gives every row a stable, unique key', () => {
    const rows = buildThreadRows([
      message(1, 5, new Date(2026, 2, 10, 10, 0)),
      message(2, 5, new Date(2026, 2, 10, 10, 1)),
    ], { now, t });
    const keys = rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(['date-2026-03-10', 'message-1', 'message-2']);
  });

  it('returns no rows for no messages', () => {
    expect(buildThreadRows([], { now, t })).toEqual([]);
  });
});
