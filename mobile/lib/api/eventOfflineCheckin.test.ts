// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    code?: string;
    constructor(status: number, message: string, _errors?: unknown, code?: string) { super(message); this.status = status; this.code = code; }
  },
}));
jest.mock('@/lib/constants', () => ({ API_V2: '/api/v2' }));
jest.mock('@sentry/react-native', () => ({ captureMessage: jest.fn() }));

import * as Sentry from '@sentry/react-native';
import { api } from '@/lib/api/client';
import {
  EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION,
  getMyEventCheckinCredential,
  getOfflineCheckinWorkspace,
  issueMyEventCheckinCredential,
  revokeMyEventCheckinCredential,
  rotateMyEventCheckinCredential,
  syncOfflineCheckinBatch,
} from './eventOfflineCheckin';

const options = {
  headers: {
    'X-Events-Contract': '2',
    'X-Event-Checkin-Contract': String(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  },
};

const workspace = {
  contract_version: 1,
  event_id: 91,
  occurrence_key: 'occurrence:91',
  manifest_version: 2,
  limits: { replay_window_minutes: 1_440, batch_max_items: 500 },
  devices: [],
  recent_batches: [],
  open_conflicts: 0,
  permissions: {
    manage_devices: true,
    download_manifest: true,
    sync_offline_queue: true,
    resolve_conflicts: true,
    manual_fallback_required: true,
  },
  privacy: {
    device_secrets_redacted: true,
    credential_secrets_redacted: true,
    contact_fields_redacted: true,
    wallet_effects_supported: false,
  },
};

beforeEach(() => jest.clearAllMocks());

describe('mobile Event offline check-in API', () => {
  it('negotiates the private strict workspace contract', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: workspace });

    const response = await getOfflineCheckinWorkspace(91);

    expect(response.privacy.wallet_effects_supported).toBe(false);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/91/offline-checkin', undefined, options);
  });

  it('reports only shape metadata when a secret-bearing response drifts', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { ...workspace, raw_device_secret: 'nxd1_private-secret' },
    });

    await expect(getOfflineCheckinWorkspace(91)).rejects
      .toHaveProperty('code', 'EVENT_CHECKIN_CONTRACT_DRIFT');
    const telemetry = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
    expect(telemetry).toContain('/api/v2/events/{id}/offline-checkin');
    expect(telemetry).not.toContain('nxd1_private-secret');
  });

  it('loads and issues a strict one-shot attendee credential without PII', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: {
        contract_version: 1,
        event_id: 91,
        credential: {
          id: 17,
          registration_id: 23,
          version: 1,
          status: 'active',
          expires_at: '2026-07-13T09:00:00Z',
          revoked_at: null,
          token: null,
          token_one_shot: false,
          contains_pii: false,
        },
      },
    });
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        contract_version: 1,
        event_id: 91,
        credential: {
          id: 18,
          registration_id: 23,
          version: 2,
          status: 'active',
          expires_at: '2026-07-13T09:00:00Z',
          token: 'nqx2_one-shot-signed-code.signature',
          token_one_shot: true,
          contains_pii: false,
        },
        manifest_version: 3,
      },
    });

    const current = await getMyEventCheckinCredential(91);
    const issued = await issueMyEventCheckinCredential(91, 'mobile-credential-idem');

    expect(current.credential?.token).toBeNull();
    expect(issued.credential).toEqual(expect.objectContaining({
      token_one_shot: true,
      contains_pii: false,
    }));
    expect(api.get).toHaveBeenCalledWith(
      '/api/v2/events/91/offline-checkin/credentials/me',
      undefined,
      options,
    );
    expect(api.post).toHaveBeenCalledWith(
      '/api/v2/events/91/offline-checkin/credentials',
      {},
      { headers: { ...options.headers, 'Idempotency-Key': 'mobile-credential-idem' } },
    );
  });

  it('uses versioned rotate and reasoned revoke credential endpoints', async () => {
    const active = {
      contract_version: 1,
      event_id: 91,
      credential: {
        id: 19,
        version: 3,
        status: 'active',
        expires_at: '2026-07-13T09:00:00Z',
        token: null,
        token_one_shot: false,
        contains_pii: false,
      },
    };
    const revoked = {
      contract_version: 1,
      event_id: 91,
      credential: { id: 19, version: 3, status: 'revoked', revoked_at: '2026-07-12T10:00:00Z' },
    };
    (api.post as jest.Mock).mockResolvedValueOnce({ data: active }).mockResolvedValueOnce({ data: revoked });

    await rotateMyEventCheckinCredential(91, 19, 2, 'mobile-rotate-idem');
    await revokeMyEventCheckinCredential(91, 19, 3, 'Lost printed copy');

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/api/v2/events/91/offline-checkin/credentials/19/rotate',
      { expected_version: 2 },
      { headers: { ...options.headers, 'Idempotency-Key': 'mobile-rotate-idem' } },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/api/v2/events/91/offline-checkin/credentials/19/revoke',
      { expected_version: 3, reason: 'Lost printed copy' },
      options,
    );
  });

  it('sends stable batch and nonce identifiers without a raw credential', async () => {
    (api.post as jest.Mock).mockResolvedValue({
      data: {
        contract_version: 1,
        event_id: 91,
        batch: {
          id: 7,
          client_batch_id: 'mobile-batch-stable',
          status: 'completed',
          item_count: 1,
          accepted_count: 1,
          conflict_count: 0,
          rejected_count: 0,
          created_at: '2026-07-12T09:00:00Z',
          completed_at: '2026-07-12T09:00:01Z',
        },
        items: [{
          id: 8,
          position: 1,
          client_nonce: 'nonce-stable-123',
          operation: 'check_in',
          observed_at: '2026-07-12T09:00:00Z',
          expected_attendance_version: 0,
          state: 'synced',
          decision_version: 1,
          code: 'attendance_applied',
          reason: null,
          decided_at: '2026-07-12T09:00:01Z',
        }],
        privacy: { credential_redacted: true, attendee_identity_redacted: true },
      },
    });

    await syncOfflineCheckinBatch(91, {
      deviceSecret: 'nxd1_device-secret',
      clientBatchId: 'mobile-batch-stable',
      manifestVersion: 2,
      items: [{
        client_nonce: 'nonce-stable-123',
        operation: 'check_in',
        observed_at: '2026-07-12T09:00:00Z',
        expected_attendance_version: 0,
        credential_fingerprint: 'a'.repeat(16),
        credential_hash_reference: 'a'.repeat(64),
      }],
    });

    const request = JSON.stringify((api.post as jest.Mock).mock.calls[0]);
    expect(request).toContain('mobile-batch-stable');
    expect(request).toContain('nonce-stable-123');
    expect(request).not.toContain('nqx2_');
  });
});
