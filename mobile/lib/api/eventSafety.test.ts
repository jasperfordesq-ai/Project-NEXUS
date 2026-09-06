// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
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
  EVENT_SAFETY_CONTRACT_HEADER,
  EVENT_SAFETY_CONTRACT_VERSION,
  acknowledgeEventCode,
  eventSafetySchema,
  getEventSafety,
  requestEventGuardianConsent,
} from './eventSafety';

const fixture: unknown = require('../../../contracts/events/v2/event-safety.json');
const options = {
  headers: {
    'X-Events-Contract': '2',
    [EVENT_SAFETY_CONTRACT_HEADER]: String(EVENT_SAFETY_CONTRACT_VERSION),
  },
};

beforeEach(() => jest.clearAllMocks());

describe('mobile Event Safety contract', () => {
  it('strictly validates the privacy-minimised projection and negotiates both contracts', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: fixture });

    const response = await getEventSafety(101);

    expect(response.data.contract_version).toBe(1);
    expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/safety', undefined, options);
    expect(eventSafetySchema.safeParse({
      ...(fixture as object),
      guardian_token: 'must-not-reach-mobile',
    }).success).toBe(false);
  });

  it('fails closed on secret-bearing contract drift without sending response values to telemetry', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: { ...(fixture as object), guardian_email: 'private@example.test' },
    });

    await expect(getEventSafety(101)).rejects.toHaveProperty('code', 'EVENT_SAFETY_CONTRACT_DRIFT');
    const telemetry = JSON.stringify((Sentry.captureMessage as jest.Mock).mock.calls);
    expect(telemetry).not.toContain('private@example.test');
    expect(telemetry).toContain('/api/v2/events/{id}/safety');
  });

  it('binds code acknowledgement and guardian delivery to idempotency keys', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: fixture });
    const textHash = '426bb49f31b7c15dfd91b62db039e1247633019cc53a970926f4bff91f549296';

    await acknowledgeEventCode(101, 'conduct-2026-07', textHash, 'code-key');
    await requestEventGuardianConsent(101, {
      guardianName: 'Private Guardian',
      guardianEmail: 'private@example.test',
      relationship: 'guardian',
      preferredLanguage: 'ga',
    }, 'guardian-key');

    expect(api.post).toHaveBeenNthCalledWith(
      1,
      '/api/v2/events/101/safety/code-of-conduct/acknowledgements',
      { text_version: 'conduct-2026-07', text_hash: textHash },
      { headers: { ...options.headers, 'Idempotency-Key': 'code-key' } },
    );
    expect(api.post).toHaveBeenNthCalledWith(
      2,
      '/api/v2/events/101/safety/guardian-consents',
      {
        guardian_name: 'Private Guardian',
        guardian_email: 'private@example.test',
        relationship_code: 'guardian',
        preferred_language: 'ga',
      },
      { headers: { ...options.headers, 'Idempotency-Key': 'guardian-key' } },
    );
  });
});
