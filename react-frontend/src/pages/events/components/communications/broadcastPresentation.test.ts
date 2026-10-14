// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import type { EventBroadcast } from '@/lib/event-communications-api';
import {
  broadcastExcerpt,
  describeBroadcast,
  FAILED_REASON_KEYS,
  formatWhen,
  groupReasons,
  needsPolling,
  SKIPPED_REASON_KEYS,
  timeZoneCity,
} from './broadcastPresentation';

const NOW = Date.parse('2030-06-01T12:00:00Z');

function broadcast(overrides: Partial<EventBroadcast> = {}): EventBroadcast {
  return {
    contract_version: 1,
    id: 8,
    event_id: 42,
    variant: 'announcement',
    status: 'draft',
    version: 1,
    audience: { segments: ['registration_confirmed'], recipient_count: 40 },
    channels: ['email'],
    body: null,
    delivery: { total: 0, delivered: 0, suppressed: 0, dead_lettered: 0, failure_code: null },
    capabilities: { edit: true, schedule: true, cancel: true, retry: false },
    scheduled_at: null,
    cancelled_at: null,
    sent_at: null,
    failed_at: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

describe('timeZoneCity', () => {
  it('names the city of an IANA zone in plain words', () => {
    expect(timeZoneCity('Europe/Dublin')).toBe('Dublin');
    expect(timeZoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
    expect(timeZoneCity('UTC')).toBe('UTC');
    expect(timeZoneCity('')).toBe('');
  });
});

describe('formatWhen', () => {
  it('formats in the event zone and returns null for nothing', () => {
    expect(formatWhen('2030-06-01T09:30:00Z', 'Europe/Dublin', 'en-IE')).toMatch(/10:30/);
    expect(formatWhen(null, 'Europe/Dublin')).toBeNull();
    expect(formatWhen('not a date', 'Europe/Dublin')).toBeNull();
  });
});

describe('describeBroadcast', () => {
  it('describes a draft with who it would go to', () => {
    const d = describeBroadcast(broadcast(), NOW, 'UTC');
    expect(d.kind).toBe('draft');
    expect(d.people).toBe(40);
  });

  it('separates a future schedule from one that is due', () => {
    expect(describeBroadcast(broadcast({ status: 'scheduled', scheduled_at: '2030-06-01T14:00:00Z' }), NOW, 'UTC').kind)
      .toBe('scheduled');
    expect(describeBroadcast(broadcast({ status: 'scheduled', scheduled_at: '2030-06-01T12:00:30Z' }), NOW, 'UTC').kind)
      .toBe('due');
    expect(describeBroadcast(broadcast({ status: 'scheduled', scheduled_at: '2030-06-01T11:00:00Z' }), NOW, 'UTC').kind)
      .toBe('due');
  });

  it('reports progress and what is still sending', () => {
    const d = describeBroadcast(broadcast({
      status: 'sending',
      delivery: { total: 10, delivered: 4, suppressed: 1, dead_lettered: 1, failure_code: null },
    }), NOW, 'UTC');
    expect(d.kind).toBe('sending');
    expect(d.pending).toBe(4);
    expect(d.progress).toBe(60);
  });

  it('calls a clean send "sent"', () => {
    const d = describeBroadcast(broadcast({
      status: 'sent',
      sent_at: '2030-06-01T10:00:00Z',
      delivery: { total: 40, delivered: 40, suppressed: 0, dead_lettered: 0, failure_code: null },
    }), NOW, 'UTC');
    expect(d.kind).toBe('sent');
    expect(d.tone).toBe('success');
  });

  it('treats one failure among many deliveries as a warning, not a failure', () => {
    const d = describeBroadcast(broadcast({
      status: 'failed',
      failed_at: '2030-06-01T10:00:00Z',
      delivery: { total: 40, delivered: 39, suppressed: 0, dead_lettered: 1, failure_code: 'event_broadcast_provider_failure' },
    }), NOW, 'UTC');
    expect(d.kind).toBe('partial');
    expect(d.tone).toBe('warning');
    expect(d.failed).toBe(1);
  });

  it('shows skipped people on an otherwise sent message', () => {
    const d = describeBroadcast(broadcast({
      status: 'sent',
      sent_at: '2030-06-01T10:00:00Z',
      delivery: { total: 40, delivered: 37, suppressed: 3, dead_lettered: 0, failure_code: null },
    }), NOW, 'UTC');
    expect(d.kind).toBe('partial');
    expect(d.skipped).toBe(3);
  });

  it('says it could not be sent when nothing arrived', () => {
    const d = describeBroadcast(broadcast({
      status: 'failed',
      failed_at: '2030-06-01T10:00:00Z',
      delivery: { total: 3, delivered: 0, suppressed: 0, dead_lettered: 3, failure_code: 'event_broadcast_provider_failure' },
    }), NOW, 'UTC');
    expect(d.kind).toBe('failed');
    expect(d.tone).toBe('danger');
  });

  it('describes a cancelled message with its time', () => {
    const d = describeBroadcast(broadcast({ status: 'cancelled', cancelled_at: '2030-06-01T10:00:00Z' }), NOW, 'UTC', 'en-GB');
    expect(d.kind).toBe('cancelled');
    expect(d.whenLabel).toMatch(/10:00/);
  });
});

describe('needsPolling', () => {
  it('polls only while something is sending or due', () => {
    expect(needsPolling([broadcast()], NOW)).toBe(false);
    expect(needsPolling([broadcast({ status: 'sending' })], NOW)).toBe(true);
    expect(needsPolling([broadcast({ status: 'scheduled', scheduled_at: '2030-06-02T10:00:00Z' })], NOW)).toBe(false);
    expect(needsPolling([broadcast({ status: 'scheduled', scheduled_at: '2030-06-01T11:59:00Z' })], NOW)).toBe(true);
  });
});

describe('groupReasons', () => {
  it('keeps known reasons and folds unknown codes into "other"', () => {
    expect(groupReasons({ email_cadence_off: 2, brand_new_reason: 1, also_new: 2 }, SKIPPED_REASON_KEYS)).toEqual([
      { key: 'other', count: 3 },
      { key: 'email_cadence_off', count: 2 },
    ]);
    expect(groupReasons({ event_broadcast_provider_failure: 1 }, FAILED_REASON_KEYS)).toEqual([
      { key: 'event_broadcast_provider_failure', count: 1 },
    ]);
    expect(groupReasons(undefined, FAILED_REASON_KEYS)).toEqual([]);
  });
});

describe('broadcastExcerpt', () => {
  it('prefers the summary excerpt and collapses whitespace', () => {
    expect(broadcastExcerpt(broadcast({
      summary: { excerpt: 'Doors  open\nat seven', skipped_reasons: {}, failed_reasons: {} },
    }))).toBe('Doors open at seven');
    expect(broadcastExcerpt(broadcast())).toBeNull();
    expect(broadcastExcerpt(broadcast({ body: 'abcdefghij' }), 5)).toBe('abcd…');
  });
});
