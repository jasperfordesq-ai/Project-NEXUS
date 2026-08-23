// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockStorageMap = new Map<string, string>();
const mockDeleteAsync = jest.fn<Promise<void>, [string, { idempotent: boolean }]>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  deleteAsync: (...args: [string, { idempotent: boolean }]) => mockDeleteAsync(...args),
  getInfoAsync: jest.fn(async () => ({ exists: false })),
  makeDirectoryAsync: jest.fn(async () => undefined),
  readAsStringAsync: jest.fn(async () => ''),
  writeAsStringAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 1),
  randomUUID: () => '12345678-1234-4123-8123-123456789012',
  digestStringAsync: jest.fn(async () => '0'.repeat(64)),
}));

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  syncOfflineCheckinBatch: jest.fn(),
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(async (key: string) => mockStorageMap.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => { mockStorageMap.set(key, value); }),
    remove: jest.fn(async (key: string) => { mockStorageMap.delete(key); }),
    getJson: jest.fn(async (key: string) => {
      const value = mockStorageMap.get(key);
      return value ? JSON.parse(value) : null;
    }),
    setJson: jest.fn(async (key: string, value: unknown) => {
      mockStorageMap.set(key, JSON.stringify(value));
    }),
  },
}));

import {
  assertMobileOfflineSessionActive,
  openMobileOfflinePayload,
  purgeAllMobileOfflineCheckinData,
  purgeRevokedOrExpiredMobileSessions,
  sealMobileOfflinePayload,
  type MobileOfflineSession,
} from '@/lib/eventOfflineCheckinStore';
import type { MobileOfflineWorkspace } from '@/lib/api/eventOfflineCheckin';

function session(expiresAt: string): MobileOfflineSession {
  return {
    eventId: 91,
    deviceId: 22,
    deviceVersion: 1,
    deviceSecret: 'nxd1_device-secret-that-must-never-be-plaintext',
    replayWindowMinutes: 1_440,
    batchMaxItems: 500,
    manifest: {
      schema_version: 2,
      tenant_id: 7,
      event_id: 91,
      occurrence_key: 'event:91:occurrence:test',
      manifest_version: 1,
      device: { id: 22, version: 1 },
      generated_at: '2026-07-12T08:00:00Z',
      expires_at: expiresAt,
      credential_verification: {
        format: 'nqx2',
        algorithm: 'Ed25519',
        keys: [{ kid: '0123456789abcdef', alg: 'Ed25519', public_key: 'A'.repeat(43) }],
      },
      registrations: [],
      privacy: { credential_contains_pii: false, encrypted_at_rest_required: true },
    },
    queue: [{
      clientNonce: 'nonce-12345678',
      registrationId: 44,
      userId: 55,
      displayName: 'Sensitive Member Name',
      operation: 'check_in',
      observedAt: '2026-07-12T09:00:00Z',
      expectedAttendanceVersion: 0,
      credentialFingerprint: '0'.repeat(16),
      credentialHashReference: '0'.repeat(64),
      reason: null,
      state: 'pending',
      code: null,
      decisionVersion: null,
    }],
    activeBatchId: null,
    activeBatchNonces: [],
    updatedAt: '2026-07-12T09:00:00Z',
  };
}

/**
 * 🔴 These two were inline string literals holding `nexus:event-checkin:...` — the exact
 * keys `expo-secure-store` REFUSES, because colons are outside its allowed
 * `[A-Za-z0-9._-]`. The tests passed anyway: they asserted the same wrong literal the
 * source used, so they pinned the bug rather than catching it. Offline check-in could
 * never be activated on any Android device as a result (measured 2026-08-23).
 *
 * Named constants here so the two places agree, and `lib/secureStoreKeys.test.ts` is the
 * guard that a key of this shape cannot be declared anywhere again.
 */
const ENCRYPTION_KEY = 'nexus_event_checkin_encryption_key_v1';
const SESSION_INDEX_KEY = 'nexus_event_checkin_session_index_v1';

describe('mobile Event offline check-in secure store', () => {
  beforeEach(() => {
    mockStorageMap.clear();
    mockDeleteAsync.mockClear();
  });

  it('authenticates and encrypts the roster, queue, and device secret without a plaintext fallback', () => {
    const key = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
    const plaintext = JSON.stringify(session('2099-01-01T00:00:00Z'));
    const sealed = sealMobileOfflinePayload(plaintext, key, new Uint8Array(24).fill(7));

    expect(sealed).not.toContain('Sensitive Member Name');
    expect(sealed).not.toContain('nxd1_device-secret');
    expect(openMobileOfflinePayload(sealed, key)).toBe(plaintext);
  });

  it('fails closed for tampered ciphertext and the wrong encryption key', () => {
    const key = new Uint8Array(32).fill(3);
    const wrongKey = new Uint8Array(32).fill(4);
    const sealed = sealMobileOfflinePayload('private roster', key, new Uint8Array(24).fill(5));
    const envelope = JSON.parse(sealed) as { v: 1; nonce: string; ciphertext: string };
    envelope.ciphertext = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`;

    expect(() => openMobileOfflinePayload(JSON.stringify(envelope), key)).toThrow('offline_ciphertext_invalid');
    expect(() => openMobileOfflinePayload(sealed, wrongKey)).toThrow('offline_ciphertext_invalid');
  });

  it('rejects an expired manifest before any queue mutation or replay', () => {
    expect(() => assertMobileOfflineSessionActive(session('2000-01-01T00:00:00Z')))
      .toThrow('manifest_expired');
  });

  it('purges a locally stored session when its staff device is revoked', async () => {
    mockStorageMap.set(SESSION_INDEX_KEY, JSON.stringify([
      { eventId: 91, deviceId: 22 },
      { eventId: 91, deviceId: 23 },
    ]));
    const workspace = {
      event_id: 91,
      devices: [
        { id: 22, status: 'active' },
        { id: 23, status: 'revoked' },
      ],
    } as MobileOfflineWorkspace;

    await purgeRevokedOrExpiredMobileSessions(workspace);

    expect(mockDeleteAsync).toHaveBeenCalledTimes(1);
    expect(mockDeleteAsync.mock.calls[0]?.[0]).toContain('event-91-device-23.nqx');
    expect(JSON.parse(mockStorageMap.get(SESSION_INDEX_KEY) ?? '[]'))
      .toEqual([{ eventId: 91, deviceId: 22 }]);
  });

  it('purges every encrypted record and the keystore key on logout', async () => {
    mockStorageMap.set(ENCRYPTION_KEY, 'secret-key');
    mockStorageMap.set(SESSION_INDEX_KEY, JSON.stringify([{ eventId: 91, deviceId: 22 }]));

    await purgeAllMobileOfflineCheckinData();

    expect(mockDeleteAsync).toHaveBeenCalledWith(
      'file:///documents/event-offline-checkin-v1',
      { idempotent: true },
    );
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
    expect(mockStorageMap.has(SESSION_INDEX_KEY)).toBe(false);
  });
});
