// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  cancelEventCommunication,
  createEventCommunication,
  getEventCommunicationDetail,
  getEventCommunications,
  previewEventCommunication,
  reviseEventCommunication,
  scheduleEventCommunication,
} from './eventCommunications';

function broadcastFixture(body: string | null = null) {
  return {
    contract_version: 1,
    id: 8,
    event_id: 42,
    variant: 'announcement',
    status: 'draft',
    version: 1,
    audience: { segments: ['registration_confirmed'], recipient_count: 12 },
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

function mutationEnvelope(broadcast = broadcastFixture('Exact organizer prose.')) {
  return {
    data: {
      broadcast,
      history: [],
      history_meta: historyMeta,
      changed: true,
      idempotent_replay: false,
    },
    meta: { base_url: 'https://api.example.test' },
  };
}

describe('mobile event communications API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('loads an aggregate-only communications page', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [broadcastFixture()],
      meta: {
        base_url: 'https://api.example.test',
        current_page: 1,
        per_page: 50,
        total: 1,
        total_pages: 1,
        has_more: false,
      },
    });

    const result = await getEventCommunications(42);

    expect(result.data[0]?.audience.recipient_count).toBe(12);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/broadcasts', {
      page: '1',
      per_page: '50',
    });
  });

  it('requests an explicit subsequent communications page', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [broadcastFixture()],
      meta: {
        base_url: 'https://api.example.test',
        current_page: 2,
        per_page: 25,
        total: 26,
        total_pages: 2,
        has_more: false,
      },
    });

    await getEventCommunications(42, 2, 25);

    expect(api.get).toHaveBeenCalledWith('/api/v2/events/42/broadcasts', {
      page: '2',
      per_page: '25',
    });
  });

  it('previews canonical segments without sending organizer content', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        contract_version: 1,
        event_id: 42,
        variant: 'announcement',
        segments: ['registration_confirmed'],
        channels: ['email'],
        recipient_count: 12,
        delivery_count: 12,
        segment_counts: { registration_confirmed: 12 },
        generated_at: '2026-07-11T10:00:00+00:00',
      },
      meta: { base_url: 'https://api.example.test' },
    });

    await previewEventCommunication(42, {
      variant: 'announcement',
      segments: ['registration_confirmed'],
      channels: ['email'],
    });

    expect(api.post).toHaveBeenCalledWith('/api/v2/events/42/broadcasts/preview', {
      variant: 'announcement',
      segments: ['registration_confirmed'],
      channels: ['email'],
    });
  });

  it('preserves exact organizer wording and sends idempotency as a header', async () => {
    (api.post as jest.Mock).mockResolvedValue(mutationEnvelope());
    const input = {
      variant: 'announcement' as const,
      segments: ['registration_confirmed'] as const,
      channels: ['email'] as const,
      body: '  Exact organizer prose.\nSecond line.  ',
    };

    await createEventCommunication(42, {
      ...input,
      segments: [...input.segments],
      channels: [...input.channels],
    }, 'mobile-create-key');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/42/broadcasts',
      expect.objectContaining({ body: '  Exact organizer prose.\nSecond line.  ' }),
      { headers: { 'Idempotency-Key': 'mobile-create-key' } },
    );
  });

  it('loads the privacy-filtered append-only detail ledger', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        broadcast: broadcastFixture('Exact organizer prose.'),
        history: [{
          id: 31,
          version: 1,
          action: 'created',
          from_status: null,
          to_status: 'draft',
          metadata: { recipient_count: 12 },
          created_at: '2026-07-11T10:00:00+00:00',
        }],
        history_meta: { ...historyMeta, total: 1, total_pages: 1 },
      },
      meta: { base_url: 'https://api.example.test' },
    });

    const detail = await getEventCommunicationDetail(8);

    expect(detail.broadcast.body).toBe('Exact organizer prose.');
    expect(detail.history[0]).toEqual(expect.objectContaining({ action: 'created', version: 1 }));
    expect(api.get).toHaveBeenCalledWith('/api/v2/event-broadcasts/8', {
      history_page: '1',
      history_per_page: '50',
    });
  });

  it('requests an independent bounded detail-history page', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        broadcast: broadcastFixture('Exact organizer prose.'),
        history: [],
        history_meta: { ...historyMeta, current_page: 2, total: 51, total_pages: 2 },
      },
      meta: { base_url: 'https://api.example.test' },
    });

    const detail = await getEventCommunicationDetail(8, 2, 50);

    expect(detail.history_meta.current_page).toBe(2);
    expect(api.get).toHaveBeenCalledWith('/api/v2/event-broadcasts/8', {
      history_page: '2',
      history_per_page: '50',
    });
  });

  it('revises an eligible draft with optimistic versioning and an idempotency header', async () => {
    (api.post as jest.Mock).mockResolvedValue(mutationEnvelope({
      ...broadcastFixture('Revised organizer prose.'),
      version: 2,
    }));
    const input = {
      variant: 'announcement' as const,
      segments: ['registration_confirmed'] as const,
      channels: ['email'] as const,
      body: 'Revised organizer prose.',
    };

    await reviseEventCommunication(8, 1, {
      ...input,
      segments: [...input.segments],
      channels: [...input.channels],
    }, 'mobile-revise-key');

    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/event-broadcasts/8/revisions',
      { ...input, segments: [...input.segments], channels: [...input.channels], expected_version: 1 },
      { headers: { 'Idempotency-Key': 'mobile-revise-key' } },
    );
  });

  it('uses optimistic versions for schedule and cancellation', async () => {
    (api.post as jest.Mock).mockResolvedValue(mutationEnvelope());

    await scheduleEventCommunication(8, 3, '2030-08-01T10:00:00+00:00', 'schedule-key');
    await cancelEventCommunication(8, 4, 'Plan changed', 'cancel-key');

    expect(api.post).toHaveBeenNthCalledWith(1,
      '/api/v2/event-broadcasts/8/schedule',
      { expected_version: 3, scheduled_at: '2030-08-01T10:00:00+00:00' },
      { headers: { 'Idempotency-Key': 'schedule-key' } },
    );
    expect(api.post).toHaveBeenNthCalledWith(2,
      '/api/v2/event-broadcasts/8/cancel',
      { expected_version: 4, reason: 'Plan changed' },
      { headers: { 'Idempotency-Key': 'cancel-key' } },
    );
  });

  it('fails closed and reports issue paths if recipient identity drifts into a card', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ ...broadcastFixture(), recipient_user_id: 99, raw_error: 'private address' }],
      meta: {
        base_url: 'https://api.example.test',
        current_page: 1,
        per_page: 50,
        total: 1,
        total_pages: 1,
        has_more: false,
      },
    });

    await expect(getEventCommunications(42)).rejects.toHaveProperty('code', 'EVENTS_CONTRACT_DRIFT');
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      'Event communications contract drift',
      expect.objectContaining({ extra: { issues: expect.any(Array) } }),
    );
    expect(JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls)).not.toContain('private address');
  });
});
