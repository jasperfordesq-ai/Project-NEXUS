// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockFiles = new Map<string, string>();
const mockStorage = new Map<string, string>();
const mockWrite = jest.fn();
let mockSequence = 0;
jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/', EncodingType: { UTF8: 'utf8' },
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path)),
  writeAsStringAsync: (...args: unknown[]) => mockWrite(...args),
  makeDirectoryAsync: jest.fn(async () => undefined),
  deleteAsync: jest.fn(async (path: string) => {
    for (const key of mockFiles.keys()) if (key === path || key.startsWith(`${path}/`)) mockFiles.delete(key);
  }),
}));
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, CryptoEncoding: { HEX: 'hex' },
  digestStringAsync: async (_algorithm: string, value: string) => require('crypto').createHash('sha256').update(value).digest('hex'),
  getRandomBytes: (length: number) => new Uint8Array(length).fill(7),
  randomUUID: () => `operation-${++mockSequence}`,
}));
jest.mock('@/lib/storage', () => ({ storage: {
  get: async (key: string) => mockStorage.get(key) ?? null,
  set: async (key: string, value: string) => { mockStorage.set(key, value); },
  getJson: async (key: string) => JSON.parse(mockStorage.get(key) ?? 'null'),
  setJson: async (key: string, value: unknown) => { mockStorage.set(key, JSON.stringify(value)); },
  remove: async (key: string) => { mockStorage.delete(key); },
} }));
jest.mock('@/lib/observability/reportSink', () => ({ reportToSink: jest.fn() }));
jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() }, ApiResponseError: class extends Error {} }));
jest.mock('@/lib/observability/report', () => ({ reportSentryMessage: jest.fn() }));

import { activateMobileOfflineSession, cacheMobileOfflineWorkspace, loadCachedMobileOfflineWorkspace, invalidateCachedMobileOfflineWorkspace, purgeAllMobileOfflineCheckinData, openMobileOfflinePayload, sealMobileOfflinePayload } from './eventOfflineCheckinStore';
import { STORAGE_KEYS } from './constants';
import type { MobileOfflineManifest, MobileOfflineWorkspace } from './api/eventOfflineCheckin';

const workspace: MobileOfflineWorkspace = {
  contract_version: 1, event_id: 91, occurrence_key: 'event:91', manifest_version: 1,
  limits: { replay_window_minutes: 1440, batch_max_items: 100 },
  devices: [{ id: 22, public_id: '12345678-1234-4123-8123-123456789012', label: 'Private door label',
    registered_by_user_id: 41, version: 1, status: 'active', registered_at: '2026-09-18',
    expires_at: '2099-01-01', rotated_at: null, revoked_at: null, revocation_reason: null }],
  recent_batches: [], open_conflicts: 0,
  permissions: { manage_devices: true, download_manifest: true, sync_offline_queue: true, resolve_conflicts: true, manual_fallback_required: true },
  privacy: { device_secrets_redacted: true, credential_secrets_redacted: true, contact_fields_redacted: true, wallet_effects_supported: false },
};
const manifest: MobileOfflineManifest = {
  schema_version: 2, event_id: 91, tenant_id: 7, occurrence_key: 'event:91', manifest_version: 1,
  device: { id: 22, version: 1 }, generated_at: '2026-09-18', expires_at: '2099-01-01',
  credential_verification: { format: 'nqx2', algorithm: 'Ed25519', keys: [] }, registrations: [],
  privacy: { credential_contains_pii: false, encrypted_at_rest_required: true },
};
const sessionPath = 'file:///documents/event-offline-checkin-v1/event-91-device-22.nqx';
function stored() {
  const key = new Uint8Array(Buffer.from(mockStorage.get('nexus_event_checkin_encryption_key_v1')!, 'base64'));
  return { key, value: JSON.parse(openMobileOfflinePayload(mockFiles.get(sessionPath)!, key)) };
}
beforeEach(() => {
  mockFiles.clear(); mockStorage.clear(); jest.clearAllMocks();
  mockStorage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: 41 }));
  mockStorage.set(STORAGE_KEYS.TENANT_SLUG, 'community');
  mockWrite.mockImplementation(async (path: string, value: string) => { mockFiles.set(path, value); });
});

it('requires online binding for a legacy session, then restores encrypted workspace and current queue', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  expect((await loadCachedMobileOfflineWorkspace(91)).session).toBeNull();
  const { key, value } = stored();
  value.queue = [{ clientNonce: 'saved-item', state: 'pending' }];
  value.activeBatchId = 'saved-batch';
  value.activeBatchNonces = ['saved-item'];
  mockFiles.set(sessionPath, sealMobileOfflinePayload(JSON.stringify(value), key));
  const cached = await cacheMobileOfflineWorkspace(active, workspace);
  expect(cached.queue).toEqual(value.queue);
  const reopened = await loadCachedMobileOfflineWorkspace(91);
  expect(reopened.workspace).toEqual(workspace);
  expect(reopened.session?.activeBatchId).toBe('saved-batch');
  expect([...mockFiles.values()].join()).not.toContain('Private door label');
  expect([...mockFiles.values()].join()).not.toContain('private-secret');
});

it.each(['user', 'tenant', 'event'])('does not restore another %s cache', async mismatch => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  await cacheMobileOfflineWorkspace(active, workspace);
  if (mismatch === 'user') mockStorage.set(STORAGE_KEYS.USER_DATA, JSON.stringify({ id: 42 }));
  if (mismatch === 'tenant') mockStorage.set(STORAGE_KEYS.TENANT_SLUG, 'other');
  expect((await loadCachedMobileOfflineWorkspace(mismatch === 'event' ? 92 : 91)).session).toBeNull();
  expect(mockFiles.has(sessionPath)).toBe(true);
});

it('retains an expired cached session for read-only review', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  await cacheMobileOfflineWorkspace(active, workspace);
  const { key, value } = stored();
  value.manifest.expires_at = '2000-01-01';
  mockFiles.set(sessionPath, sealMobileOfflinePayload(JSON.stringify(value), key));
  expect((await loadCachedMobileOfflineWorkspace(91)).inactive).toBe('manifest_expired');
});

it.each(['device', 'owner', 'version', 'event', 'schema'])('refuses mismatched online cache data (%s)', async mismatch => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  const changed = structuredClone(workspace);
  if (mismatch === 'device') changed.devices[0].id = 23;
  if (mismatch === 'owner') changed.devices[0].registered_by_user_id = 42;
  if (mismatch === 'version') changed.devices[0].version = 2;
  if (mismatch === 'event') changed.event_id = 92;
  if (mismatch === 'schema') (changed as unknown as { permissions: unknown }).permissions = {};
  await expect(cacheMobileOfflineWorkspace(active, changed)).rejects.toThrow();
  expect(stored().value.offlineWorkspace).toBeUndefined();
});

it('does not restore cached authority after logout', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  await cacheMobileOfflineWorkspace(active, workspace);
  await purgeAllMobileOfflineCheckinData();
  expect((await loadCachedMobileOfflineWorkspace(91)).session).toBeNull();
});

it('invalidates refused authority without deleting attendance or its stable batch', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  await cacheMobileOfflineWorkspace(active, workspace);
  const { key, value } = stored();
  value.queue = [{ clientNonce: 'saved', state: 'pending' }];
  value.activeBatchId = 'stable-batch';
  mockFiles.set(sessionPath, sealMobileOfflinePayload(JSON.stringify(value), key));
  await invalidateCachedMobileOfflineWorkspace(91);
  expect((await loadCachedMobileOfflineWorkspace(91)).session).toBeNull();
  expect(stored().value).toMatchObject({ queue: value.queue, activeBatchId: 'stable-batch' });
});

it('refuses malformed cached permissions without deleting the saved queue', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  await cacheMobileOfflineWorkspace(active, workspace);
  const { key, value } = stored();
  value.offlineWorkspace.workspace.permissions = {};
  mockFiles.set(sessionPath, sealMobileOfflinePayload(JSON.stringify(value), key));
  await expect(loadCachedMobileOfflineWorkspace(91)).rejects.toThrow();
  expect(mockFiles.has(sessionPath)).toBe(true);
});

it('cannot save cache data when logout starts during the encrypted read', async () => {
  const active = await activateMobileOfflineSession('private-secret', manifest, workspace);
  const files = require('expo-file-system/legacy');
  let purge: Promise<void> | undefined;
  const read = jest.spyOn(files, 'readAsStringAsync').mockImplementationOnce(async () => {
    purge = purgeAllMobileOfflineCheckinData();
    return mockFiles.get(sessionPath);
  });
  try {
    await expect(cacheMobileOfflineWorkspace(active, workspace)).rejects.toThrow('offline_session_ended');
    await purge;
    expect(mockFiles.has(sessionPath)).toBe(false);
  } finally { read.mockRestore(); }
});
