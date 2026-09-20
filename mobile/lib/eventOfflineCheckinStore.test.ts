// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockStorageMap = new Map<string, string>();
const mockSessionFiles = new Map<string, string>();
const mockDeleteAsync = jest.fn<Promise<void>, [string, { idempotent: boolean }]>();
const mockReportToSink = jest.fn();
jest.mock('@/lib/observability/reportSink', () => ({
  reportToSink: (...args: unknown[]) => mockReportToSink(...args),
}));

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
  randomUUID: jest.fn(() => '12345678-1234-4123-8123-123456789012'),
  digestStringAsync: jest.fn(async () => '0'.repeat(64)),
}));

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  syncOfflineCheckinBatch: jest.fn(),
  findOfflineCheckinBatch: jest.fn(),
  getOfflineCheckinBatch: jest.fn(),
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
  activateMobileOfflineSession,
  syncMobileOfflineSession,
  loadMobileOfflineSessionForReview,
  purgeMobileOfflineSession,
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

function seedStoredSession(saved: MobileOfflineSession): void {
  const key = new Uint8Array(32).fill(9);
  mockStorageMap.set(ENCRYPTION_KEY, Buffer.from(key).toString('base64'));
  mockSessionFiles.set('file:///documents/event-offline-checkin-v1/event-' + saved.eventId + '-device-' + saved.deviceId + '.nqx', sealMobileOfflinePayload(JSON.stringify(saved), key));
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
    mockSessionFiles.clear();
    const files = require('expo-file-system/legacy');
    files.getInfoAsync.mockReset().mockImplementation(async (path: string) => ({ exists: mockSessionFiles.has(path) }));
    files.readAsStringAsync.mockReset().mockImplementation(async (path: string) => mockSessionFiles.get(path) ?? '');
    files.writeAsStringAsync.mockReset().mockImplementation(async (path: string, value: string) => { mockSessionFiles.set(path, value); });
    mockDeleteAsync.mockReset().mockImplementation(async path => {
      for (const file of mockSessionFiles.keys()) {
        if (file === path || file.startsWith(path + '/')) mockSessionFiles.delete(file);
      }
    });
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

  it('persists the batch identity before sending any offline attendance', async () => {
    const files = require('expo-file-system/legacy');
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    files.writeAsStringAsync.mockClear();
    syncOfflineCheckinBatch.mockImplementationOnce(async (_eventId: number, request: { clientBatchId: string }) => {
      expect(files.writeAsStringAsync).toHaveBeenCalled();
      const ciphertext = files.writeAsStringAsync.mock.calls.at(-1)[1];
      const key = new Uint8Array(Buffer.from(mockStorageMap.get(ENCRYPTION_KEY)!, 'base64'));
      const persisted = JSON.parse(openMobileOfflinePayload(ciphertext, key));
      expect(persisted.activeBatchId).toBe(request.clientBatchId);
      expect(persisted.activeBatchNonces).toEqual([fixture.queue[0].clientNonce]);
      return { items: [] };
    });
    seedStoredSession(fixture);
    await syncMobileOfflineSession(fixture);
  });

  it('does not send attendance if saving its retry identity fails', async () => {
    const files = require('expo-file-system/legacy');
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    syncOfflineCheckinBatch.mockClear();
    files.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    seedStoredSession(fixture);
    await expect(syncMobileOfflineSession(fixture)).rejects.toThrow();
    expect(syncOfflineCheckinBatch).not.toHaveBeenCalled();
  });

  it.each(['processing', 'dead_letter'])('keeps an unresolved batch identity and status (%s)', async status => {
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    syncOfflineCheckinBatch.mockResolvedValueOnce({ batch: { id: 73, status }, items: [] });
    seedStoredSession(fixture);
    const result = await syncMobileOfflineSession(fixture);
    expect(result.session.activeBatchId).toBeTruthy();
    expect(result.session.activeBatchNonces).toEqual([fixture.queue[0].clientNonce]);
    expect(result.session.activeBatchStatus).toBe(status);
    expect(result.session.activeServerBatchId).toBe(73);
  });

  it('replays an existing batch without changing its items at the local age cutoff', async () => {
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    syncOfflineCheckinBatch.mockClear().mockResolvedValueOnce({ batch: { status: 'processing' }, items: [] });
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.activeBatchId = 'original-batch';
    fixture.activeBatchNonces = [fixture.queue[0].clientNonce];
    fixture.queue[0].observedAt = '2000-01-01T00:00:00Z';
    seedStoredSession(fixture);
    await syncMobileOfflineSession(fixture);
    expect(syncOfflineCheckinBatch).toHaveBeenCalledWith(91, expect.objectContaining({
      clientBatchId: 'original-batch', items: [expect.objectContaining({ observed_at: '2000-01-01T00:00:00Z' })],
    }));
  });

  it('replays every original item and manifest version, then clears only a fully settled batch', async () => {
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    syncOfflineCheckinBatch.mockClear();
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.activeBatchId = 'original-batch';
    fixture.activeBatchManifestVersion = 1;
    fixture.manifest.manifest_version = 9;
    fixture.queue[0].state = 'synced';
    fixture.queue.push({ ...fixture.queue[0], clientNonce: 'second-nonce', state: 'pending' });
    fixture.activeBatchNonces = fixture.queue.map(item => item.clientNonce);
    syncOfflineCheckinBatch.mockResolvedValueOnce({ batch: { status: 'completed' }, items: fixture.queue.map(item => ({
      client_nonce: item.clientNonce, state: 'synced', code: null, decision_version: 1,
    })) });
    seedStoredSession(fixture);
    const result = await syncMobileOfflineSession(fixture);
    expect(syncOfflineCheckinBatch).toHaveBeenCalledWith(91, expect.objectContaining({
      clientBatchId: 'original-batch', manifestVersion: 1, items: [
        expect.objectContaining({ client_nonce: fixture.queue[0].clientNonce }),
        expect.objectContaining({ client_nonce: 'second-nonce' }),
      ],
    }));
    expect(result.session.activeBatchId).toBeNull();
    expect(result.session.activeBatchNonces).toEqual([]);
    expect(result.session.activeBatchManifestVersion).toBeNull();
  });

  it('reuses the persisted batch when the screen retries its older session snapshot', async () => {
    const files = require('expo-file-system/legacy');
    const crypto = require('expo-crypto');
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    const uuid = crypto.randomUUID.mockReset().mockReturnValueOnce('first').mockReturnValueOnce('must-not-be-used');
    let ciphertext: string | null = null;
    files.getInfoAsync.mockImplementation(async () => ({ exists: ciphertext !== null }));
    files.readAsStringAsync.mockImplementation(async () => ciphertext);
    files.writeAsStringAsync.mockImplementation(async (_path: string, value: string) => { ciphertext = value; });
    syncOfflineCheckinBatch.mockReset().mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce({ items: [] });
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    try {
      seedStoredSession(fixture);
      ciphertext = mockSessionFiles.values().next().value ?? null;
      await expect(syncMobileOfflineSession(fixture)).rejects.toThrow('response lost');
      expect(fixture.activeBatchId).toBeNull();
      await syncMobileOfflineSession(fixture);
      expect(syncOfflineCheckinBatch.mock.calls[0][1].clientBatchId).toBe('mobile-first');
      expect(syncOfflineCheckinBatch.mock.calls[1][1]).toEqual(syncOfflineCheckinBatch.mock.calls[0][1]);
      expect(uuid).toHaveBeenCalledTimes(1);
    } finally {
      uuid.mockReset().mockReturnValue('12345678-1234-4123-8123-123456789012');
      files.getInfoAsync.mockImplementation(async () => ({ exists: false }));
      files.readAsStringAsync.mockImplementation(async () => '');
      files.writeAsStringAsync.mockImplementation(async () => undefined);
    }
  });

  it.each(['saved-id', 'recent-id', 'not-found', 'read-failed', 'logout', 'dead-letter'])('reconciles a submitted batch without sending attendance (%s)', async scenario => {
    const files = require('expo-file-system/legacy');
    const api = require('@/lib/api/eventOfflineCheckin');
    api.syncOfflineCheckinBatch.mockClear();
    api.findOfflineCheckinBatch.mockReset();
    api.getOfflineCheckinBatch.mockReset();
    const fixture = session('2000-01-01T00:00:00Z');
    if (scenario === 'dead-letter') {
      fixture.manifest.expires_at = '2099-01-01T00:00:00Z';
      fixture.activeBatchStatus = 'dead_letter';
    }
    fixture.activeBatchId = 'saved-batch';
    fixture.activeBatchNonces = [fixture.queue[0].clientNonce];
    if (scenario !== 'recent-id' && scenario !== 'not-found') fixture.activeServerBatchId = 73;
    fixture.queue.push({ ...fixture.queue[0], clientNonce: 'unsent-local-item' });
    const key = new Uint8Array(32).fill(7);
    mockStorageMap.set(ENCRYPTION_KEY, Buffer.from(key).toString('base64'));
    const ciphertext = sealMobileOfflinePayload(JSON.stringify(fixture), key);
    mockSessionFiles.set('file:///documents/event-offline-checkin-v1/event-91-device-22.nqx', ciphertext);
    files.getInfoAsync.mockResolvedValueOnce({ exists: true });
    files.readAsStringAsync.mockResolvedValueOnce(ciphertext);
    files.writeAsStringAsync.mockClear();
    const batch = { batch: { id: 73, status: 'completed' }, items: [{
      client_nonce: fixture.queue[0].clientNonce, state: 'synced', code: 'attendance_applied', decision_version: 1,
    }] };
    api.findOfflineCheckinBatch.mockImplementation(async () => {
      if (scenario === 'not-found') throw new Error('offline_batch_not_found');
      return batch;
    });
    api.getOfflineCheckinBatch.mockImplementation(async () => {
      if (scenario === 'read-failed') throw new Error('read failed');
      if (scenario === 'logout') await purgeAllMobileOfflineCheckinData();
      return batch;
    });
    if (['not-found', 'read-failed', 'logout'].includes(scenario)) {
      await expect(syncMobileOfflineSession(fixture)).rejects.toThrow();
      expect(files.writeAsStringAsync).not.toHaveBeenCalled();
    } else {
      const result = await syncMobileOfflineSession(fixture);
      expect(result.session.activeBatchId).toBeNull();
      expect(result.session.queue.map(item => item.state)).toEqual(['synced', 'pending']);
      const saved = JSON.parse(openMobileOfflinePayload(files.writeAsStringAsync.mock.calls[0][1], key));
      expect(saved.queue.map((item: { state: string }) => item.state)).toEqual(['synced', 'pending']);
      expect(saved.manifest.expires_at).toBe(fixture.manifest.expires_at);
      expect(scenario === 'recent-id' ? api.findOfflineCheckinBatch : api.getOfflineCheckinBatch).toHaveBeenCalledWith(91, scenario === 'recent-id' ? 22 : 73, expect.objectContaining({
        clientBatchId: 'saved-batch', items: [expect.objectContaining({ client_nonce: 'nonce-12345678' })],
      }));
      if (scenario === 'saved-id') expect(api.findOfflineCheckinBatch).not.toHaveBeenCalled();
    }
    expect(api.syncOfflineCheckinBatch).not.toHaveBeenCalled();
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

  it('does not generate a new encryption key while reading an orphaned record', async () => {
    const files = require('expo-file-system/legacy');
    files.getInfoAsync.mockResolvedValueOnce({ exists: true });
    files.readAsStringAsync.mockResolvedValueOnce('orphaned ciphertext');
    await expect(loadMobileOfflineSessionForReview(91, 22)).rejects.toThrow();
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
  });

  it('restores an intact session while an unrelated device is removed', async () => {
    const files = require('expo-file-system/legacy');
    const key = new Uint8Array(32).fill(3);
    const fixture = session('2099-01-01T00:00:00Z');
    mockStorageMap.set(ENCRYPTION_KEY, Buffer.from(key).toString('base64'));
    files.getInfoAsync.mockResolvedValueOnce({ exists: true });
    files.readAsStringAsync.mockResolvedValueOnce(sealMobileOfflinePayload(JSON.stringify(fixture), key));
    const pending = loadMobileOfflineSessionForReview(91, 22);
    await purgeMobileOfflineSession(91, 23);
    expect(await pending).toEqual({ session: fixture, inactive: null });
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(true);
  });

  it('does not restore a valid record whose read crosses logout', async () => {
    const files = require('expo-file-system/legacy');
    const key = new Uint8Array(32).fill(3);
    mockStorageMap.set(ENCRYPTION_KEY, Buffer.from(key).toString('base64'));
    files.getInfoAsync.mockResolvedValueOnce({ exists: true });
    let finishRead!: (value: string) => void;
    let started!: () => void;
    const reading = new Promise<void>((resolve) => { started = resolve; });
    files.readAsStringAsync.mockImplementationOnce(() => {
      started();
      return new Promise<string>((resolve) => { finishRead = resolve; });
    });
    const pending = loadMobileOfflineSessionForReview(91, 22).then(() => 'restored', () => 'cancelled');
    await reading;
    const cleanup = purgeAllMobileOfflineCheckinData();
    finishRead(sealMobileOfflinePayload(JSON.stringify(session('2099-01-01T00:00:00Z')), key));
    await cleanup;
    expect(await pending).toBe('cancelled');
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
    expect(mockStorageMap.has(SESSION_INDEX_KEY)).toBe(false);
  });

  it('does not restore the session index when an activation write crosses logout cleanup', async () => {
    const files = require('expo-file-system/legacy');
    let finishWrite!: () => void;
    let started!: () => void;
    const writing = new Promise<void>((resolve) => { started = resolve; });
    files.writeAsStringAsync.mockImplementationOnce(() => {
      started();
      return new Promise<void>((resolve) => { finishWrite = resolve; });
    });
    const fixture = session('2099-01-01T00:00:00Z');
    const activation = activateMobileOfflineSession(fixture.deviceSecret, fixture.manifest, {
      event_id: 91, manifest_version: 1,
      limits: { replay_window_minutes: 1440, batch_max_items: 500 },
    } as MobileOfflineWorkspace).then(() => 'activated', () => 'cancelled');
    await writing;
    const cleanup = purgeAllMobileOfflineCheckinData();
    finishWrite();
    await cleanup;
    expect(await activation).toBe('cancelled');
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
    expect(mockStorageMap.has(SESSION_INDEX_KEY)).toBe(false);
  });

  it('rejects a sync response after logout without recreating storage, then allows a new activation', async () => {
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    const files = require('expo-file-system/legacy');
    let finish!: (value: unknown) => void;
    let sent!: () => void;
    const dispatched = new Promise<void>((resolve) => { sent = resolve; });
    syncOfflineCheckinBatch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; sent(); }));
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    seedStoredSession(fixture);
    const pending = syncMobileOfflineSession(fixture).then(() => 'synced', () => 'cancelled');
    await dispatched;
    await purgeAllMobileOfflineCheckinData();
    const writesBefore = files.writeAsStringAsync.mock.calls.length;
    finish({ items: [] });
    expect(await pending).toBe('cancelled');
    expect(files.writeAsStringAsync.mock.calls.length).toBe(writesBefore);
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
    expect(mockStorageMap.has(SESSION_INDEX_KEY)).toBe(false);

    await activateMobileOfflineSession(fixture.deviceSecret, fixture.manifest, {
      event_id: 91, manifest_version: 1,
      limits: { replay_window_minutes: 1440, batch_max_items: 500 },
    } as MobileOfflineWorkspace);
    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(true);
    expect(JSON.parse(mockStorageMap.get(SESSION_INDEX_KEY)!)).toEqual([{ eventId: 91, deviceId: 22 }]);
  });

  it('does not resurrect a device removed while its sync response was pending', async () => {
    const { syncOfflineCheckinBatch } = require('@/lib/api/eventOfflineCheckin');
    const files = require('expo-file-system/legacy');
    let finish!: (value: unknown) => void;
    let sent!: () => void;
    const dispatched = new Promise<void>((resolve) => { sent = resolve; });
    syncOfflineCheckinBatch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; sent(); }));
    const fixture = session('2099-01-01T00:00:00Z');
    fixture.queue[0].observedAt = new Date().toISOString();
    seedStoredSession(fixture);
    const pending = syncMobileOfflineSession(fixture).then(() => 'synced', () => 'cancelled');
    await dispatched;
    await purgeMobileOfflineSession(91, 22);
    const writesBefore = files.writeAsStringAsync.mock.calls.length;
    finish({ items: [] });
    expect(await pending).toBe('cancelled');
    expect(files.writeAsStringAsync.mock.calls.length).toBe(writesBefore);
    expect(JSON.parse(mockStorageMap.get(SESSION_INDEX_KEY) ?? '[]')).toEqual([]);
  });

  it('removes the encryption key and index even when native file deletion fails', async () => {
    mockStorageMap.set(ENCRYPTION_KEY, 'secret-key');
    mockStorageMap.set(SESSION_INDEX_KEY, JSON.stringify([{ eventId: 91, deviceId: 22 }]));
    const failure = new Error('File is unavailable');
    mockDeleteAsync.mockRejectedValueOnce(failure);

    await expect(purgeAllMobileOfflineCheckinData()).resolves.toBeUndefined();

    expect(mockStorageMap.has(ENCRYPTION_KEY)).toBe(false);
    expect(mockStorageMap.has(SESSION_INDEX_KEY)).toBe(false);
    expect(mockReportToSink).toHaveBeenCalledWith(failure, { operation: 'purge_offline_checkin_files' });
  });
});
