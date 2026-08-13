// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { api } from '@/lib/api';
import { eventCommunicationsApi } from './event-communications-api';

const mockApi = vi.mocked(api);

function broadcastFixture(body: string | null = null) {
  return {
    contract_version: 1,
    id: 8,
    event_id: 42,
    variant: 'announcement',
    status: 'draft',
    version: 1,
    audience: { segments: ['registration_confirmed'], recipient_count: 0 },
    channels: ['email', 'in_app'],
    body,
    delivery: { total: 0, delivered: 0, suppressed: 0, dead_lettered: 0, failure_code: null },
    capabilities: { edit: true, schedule: true, cancel: true, retry: false },
    scheduled_at: null,
    cancelled_at: null,
    sent_at: null,
    failed_at: null,
    created_at: '2026-07-11T10:00:00+00:00',
    updated_at: '2026-07-11T10:00:00+00:00',
  };
}

const historyMeta = {
  current_page: 1,
  per_page: 50,
  total: 0,
  total_pages: 0,
  has_more: false,
};

describe('eventCommunicationsApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('parses an identity-free broadcast page', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [broadcastFixture()],
      meta: { current_page: 1, per_page: 20, total: 1, total_pages: 1, has_more: false },
    });

    const response = await eventCommunicationsApi.list(42);

    expect(response.success).toBe(true);
    expect(response.data?.[0]?.audience.recipient_count).toBe(0);
    expect(mockApi.get).toHaveBeenCalledWith('/v2/events/42/broadcasts?page=1&per_page=20');
  });

  it('sends mutation idempotency outside organizer-authored content', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        broadcast: broadcastFixture('Exact organizer prose.'),
        history: [],
        history_meta: historyMeta,
        changed: true,
        idempotent_replay: false,
      },
    });
    const input = {
      variant: 'announcement' as const,
      segments: ['registration_confirmed'] as const,
      channels: ['email', 'in_app'] as const,
      body: 'Exact organizer prose.',
    };

    const response = await eventCommunicationsApi.create(42, {
      ...input,
      segments: [...input.segments],
      channels: [...input.channels],
    }, 'broadcast-key');

    expect(response.success).toBe(true);
    expect(mockApi.post).toHaveBeenCalledWith(
      '/v2/events/42/broadcasts',
      expect.objectContaining({ body: 'Exact organizer prose.' }),
      { headers: { 'Idempotency-Key': 'broadcast-key' } },
    );
  });

  it('schedules against the optimistic version with an offset timestamp', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        broadcast: { ...broadcastFixture('Body'), status: 'scheduled', version: 2, scheduled_at: '2026-07-12T10:00:00+00:00' },
        history: [],
        history_meta: historyMeta,
        changed: true,
        idempotent_replay: false,
      },
    });

    await eventCommunicationsApi.schedule(8, 1, '2026-07-12T10:00:00+00:00', 'schedule-key');

    expect(mockApi.post).toHaveBeenCalledWith(
      '/v2/event-broadcasts/8/schedule',
      { expected_version: 1, scheduled_at: '2026-07-12T10:00:00+00:00' },
      { headers: { 'Idempotency-Key': 'schedule-key' } },
    );
  });

  it('fails closed if recipient identity or raw diagnostics drift into the contract', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: [{
        ...broadcastFixture(),
        recipient_user_id: 99,
        claim_token: 'private-claim',
        raw_error: 'user@example.test rejected',
      }],
      meta: { current_page: 1, per_page: 20, total: 1, total_pages: 1, has_more: false },
    });

    const response = await eventCommunicationsApi.list(42);

    expect(response.success).toBe(false);
    expect(response.code).toBe('EVENTS_CONTRACT_DRIFT');
    expect(response.data).toBeUndefined();
  });

  // 🔴 The preview path had NO web coverage at all, which is how this shipped:
  // mobile got z.partialRecord and the web schema kept z.record, and no test
  // exercised it. Sentry NEXUS-REACT-W, production 2026-08-02.
  it('accepts a preview that counts only the segments actually requested', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 42,
        variant: 'announcement',
        segments: ['registration_confirmed'],
        channels: ['email'],
        recipient_count: 3,
        delivery_count: 3,
        // ONE key, because one segment was requested. An enum-keyed z.record()
        // is exhaustive in Zod 4 and would demand all four.
        segment_counts: { registration_confirmed: 3 },
        generated_at: '2026-08-02T11:57:38+00:00',
      },
    });

    const response = await eventCommunicationsApi.preview(42, {
      variant: 'announcement',
      segments: ['registration_confirmed'],
      channels: ['email'],
    });

    expect(response.success).toBe(true);
    expect(response.code).not.toBe('EVENTS_CONTRACT_DRIFT');
    expect(response.data?.segment_counts.registration_confirmed).toBe(3);
    expect(response.data?.segment_counts.waitlist_active).toBeUndefined();
  });

  it('accepts a preview covering every segment too', async () => {
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 42,
        variant: 'follow_up',
        segments: ['registration_confirmed', 'waitlist_active', 'attendance_attended', 'attendance_no_show'],
        channels: ['email', 'push'],
        recipient_count: 6,
        delivery_count: 12,
        segment_counts: {
          registration_confirmed: 3,
          waitlist_active: 1,
          attendance_attended: 2,
          attendance_no_show: 0,
        },
        generated_at: '2026-08-02T11:57:38+00:00',
      },
    });

    const response = await eventCommunicationsApi.preview(42, {
      variant: 'follow_up',
      segments: ['registration_confirmed', 'waitlist_active', 'attendance_attended', 'attendance_no_show'],
      channels: ['email', 'push'],
    });

    expect(response.success).toBe(true);
    expect(response.data?.segment_counts.attendance_no_show).toBe(0);
  });

  it('still fails closed on a preview segment key outside the contract', async () => {
    // Loosening record → partialRecord must not stop rejecting a key the
    // enum does not define.
    mockApi.post.mockResolvedValue({
      success: true,
      data: {
        contract_version: 1,
        event_id: 42,
        variant: 'announcement',
        segments: ['registration_confirmed'],
        channels: ['email'],
        recipient_count: 3,
        delivery_count: 3,
        segment_counts: { registration_confirmed: 3, everyone_on_the_platform: 900 },
        generated_at: '2026-08-02T11:57:38+00:00',
      },
    });

    const response = await eventCommunicationsApi.preview(42, {
      variant: 'announcement',
      segments: ['registration_confirmed'],
      channels: ['email'],
    });

    expect(response.success).toBe(false);
    expect(response.code).toBe('EVENTS_CONTRACT_DRIFT');
  });

  it('requests an independent bounded history page', async () => {
    mockApi.get.mockResolvedValue({
      success: true,
      data: {
        broadcast: broadcastFixture('Body'),
        history: [],
        history_meta: { ...historyMeta, current_page: 2, total: 51, total_pages: 2 },
      },
    });

    const response = await eventCommunicationsApi.get(8, 2, 50);

    expect(response.success).toBe(true);
    expect(response.data?.history_meta.current_page).toBe(2);
    expect(mockApi.get).toHaveBeenCalledWith('/v2/event-broadcasts/8?history_page=2&history_per_page=50');
  });
});
