// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as ExpoCrypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import { Platform } from 'react-native';
import { z } from 'zod';
import { STORAGE_KEYS } from '@/lib/constants';
import {
  getOfflineCheckinBatch,
  findOfflineCheckinBatch,
  findOfflineCheckinBatchByNonce,
  parseOfflineWorkspaceCache,
  syncOfflineCheckinBatch,
  type MobileOfflineBatch,
  type MobileOfflineManifest,
  type MobileOfflineWorkspace,
  type OfflineAttendanceOperation,
} from '@/lib/api/eventOfflineCheckin';
import { storage } from '@/lib/storage';
import { reportToSink } from '@/lib/observability/reportSink';
import { encodeBase64, decodeBase64, sealMobileOfflinePayload, openMobileOfflinePayload } from '@/lib/encryptedPayload';
export { sealMobileOfflinePayload, openMobileOfflinePayload } from '@/lib/encryptedPayload';

/**
 * 🔴 Underscores, not colons — `expo-secure-store` REFUSES a key containing anything
 * outside `[A-Za-z0-9._-]`.
 *
 * This was `nexus:event-checkin:encryption-key:v1`. On Android SecureStore threw on every
 * write, `lib/storage.ts` swallows write errors by design, `storage.get` then returned
 * null, and `encryptionKey()`'s read-back check threw `offline_encryption_key_unavailable`
 * — so **offline check-in could never be activated on any device**. Measured on
 * 2026-08-23: authorising a staff device created the device server-side (201), downloaded
 * the manifest (200) and refreshed the workspace (200), and the organiser still saw "That
 * offline check-in action could not be completed" over "No devices are authorized for this
 * event".
 *
 * Every other key in the app uses underscores (`STORAGE_KEYS` in `lib/constants.ts`),
 * which is why nothing else was affected. Guarded by `lib/secureStoreKeys.test.ts`.
 */
const KEY_STORAGE_KEY = 'nexus_event_checkin_encryption_key_v1';
/**
 * 🔴 Same fault as the key above, found by the guard the moment it was written. This one
 * goes through `storage.setJson`/`getJson` on native, so the session index could never be
 * written either — every session was invisible to `purgeRevokedOrExpiredMobileSessions`
 * and to the bookkeeping that depends on it.
 */
const INDEX_STORAGE_KEY = 'nexus_event_checkin_session_index_v1';
/**
 * Colons are fine here: this prefix is only used when `Platform.OS === 'web'`, where
 * `lib/storage.ts` falls back to `localStorage` and SecureStore's key rules do not apply.
 */
const WEB_RECORD_PREFIX = 'nexus:event-checkin:ciphertext:v1:';
const DIRECTORY_NAME = 'event-offline-checkin-v1';
const MAX_LOCAL_ITEMS = 500;
let storeGeneration = 0;
const deviceGenerations = new Map<string, number>();
type StoreGeneration = { global: number; deviceKey: string; device: number };

function generationFor(eventId: number, deviceId: number): StoreGeneration {
  const deviceKey = sessionKey(eventId, deviceId);
  return { global: storeGeneration, deviceKey, device: deviceGenerations.get(deviceKey) ?? 0 };
}

function invalidateDevice(eventId: number, deviceId: number): void {
  const key = sessionKey(eventId, deviceId);
  deviceGenerations.set(key, (deviceGenerations.get(key) ?? 0) + 1);
}
let storeWrites: Promise<void> = Promise.resolve();

function inStoreOrder<T>(operation: () => Promise<T>): Promise<T> {
  const result = storeWrites.then(operation);
  storeWrites = result.then(() => undefined, () => undefined);
  return result;
}

function assertStoreGeneration(generation: StoreGeneration): void {
  if (generation.global !== storeGeneration
    || generation.device !== (deviceGenerations.get(generation.deviceKey) ?? 0)) {
    throw new Error('offline_session_ended');
  }
}
const ALLOWED_CLAIMS = new Set(['alg', 'aud', 'evt', 'exp', 'iat', 'jti', 'kid', 'occ', 'ten', 'v', 'ver']);

const pendingDeviceSchema = z.object({ id: z.number().int().positive(), version: z.number().int().positive() }).strict();
const registrationBaseSchema = z.object({
  eventId: z.number().int().positive(), userId: z.number().int().positive(), tenant: z.string().min(1),
  label: z.string().min(1).max(120), idempotencyKey: z.string().min(1), revision: z.number().int().positive(),
});
const pendingRegistrationSchema = z.discriminatedUnion('stage', [
  registrationBaseSchema.extend({ stage: z.literal('register') }).strict(),
  registrationBaseSchema.extend({ stage: z.literal('rotate'), device: pendingDeviceSchema }).strict(),
  registrationBaseSchema.extend({ stage: z.literal('reauthorize'), device: pendingDeviceSchema }).strict(),
  registrationBaseSchema.extend({ stage: z.literal('activate'), device: pendingDeviceSchema, secret: z.string().min(1) }).strict(),
  registrationBaseSchema.extend({ stage: z.literal('completed') }).strict(),
]);
type OfflineRegistrationRecord = z.infer<typeof pendingRegistrationSchema>;
export type PendingOfflineRegistration = Exclude<OfflineRegistrationRecord, { stage: 'completed' }>;

async function registrationContext(eventId: number) {
  if (!Number.isInteger(eventId) || eventId <= 0 || Platform.OS === 'web' || !FileSystem.documentDirectory) {
    throw new Error('offline_registration_store_unavailable');
  }
  const generation = generationFor(eventId, 0);
  const identity = async () => {
    const [raw, tenant] = await Promise.all([
      storage.get(STORAGE_KEYS.USER_DATA, { required: true }),
      storage.get(STORAGE_KEYS.TENANT_SLUG, { required: true }),
    ]);
    const user = raw ? JSON.parse(raw) : null;
    if (!Number.isInteger(user?.id) || user.id <= 0 || !tenant) throw new Error('offline_registration_identity_unavailable');
    return { userId: user.id as number, tenant };
  };
  const owner = await identity();
  const hash = await sha256(JSON.stringify([owner.tenant, owner.userId, eventId]));
  const path = `${FileSystem.documentDirectory}${DIRECTORY_NAME}/registration-${hash}.nqx`;
  const check = async () => {
    assertStoreGeneration(generation);
    const current = await identity();
    assertStoreGeneration(generation);
    if (current.userId !== owner.userId || current.tenant !== owner.tenant) throw new Error('offline_registration_identity_changed');
  };
  return { ...owner, eventId, path, check };
}

type RegistrationContext = Awaited<ReturnType<typeof registrationContext>>;

async function readPendingRegistration(context: RegistrationContext): Promise<OfflineRegistrationRecord | null> {
  await context.check();
  const records: OfflineRegistrationRecord[] = [];
  let failure: unknown;
  for (const slot of [0, 1]) {
    const path = `${context.path}.${slot}`;
    if (!(await FileSystem.getInfoAsync(path)).exists) continue;
    try {
      const ciphertext = await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 });
      records.push(pendingRegistrationSchema.parse(JSON.parse(openMobileOfflinePayload(ciphertext, await encryptionKey(false)))));
    } catch (error) { failure = error; }
  }
  await context.check();
  if (!records.length) {
    if (failure) throw failure;
    return null;
  }
  const value = records.sort((a, b) => b.revision - a.revision)[0];
  if (value.userId !== context.userId || value.tenant !== context.tenant || value.eventId !== context.eventId) {
    throw new Error('offline_registration_identity_changed');
  }
  return value;
}

async function writePendingRegistration(context: RegistrationContext, pending: OfflineRegistrationRecord): Promise<void> {
  await context.check();
  const key = await encryptionKey();
  await context.check();
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}${DIRECTORY_NAME}`, { intermediates: true });
  await context.check();
  // Alternate slots: a torn write cannot destroy the last authenticated revision.
  // Expo's iOS move removes its destination first, so rename is not a safe substitute.
  const path = `${context.path}.${pending.revision % 2}`;
  await FileSystem.writeAsStringAsync(path, sealMobileOfflinePayload(JSON.stringify(pending), key), { encoding: FileSystem.EncodingType.UTF8 });
  const verified = openMobileOfflinePayload(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }), key);
  if (verified !== JSON.stringify(pending)) throw new Error('offline_registration_write_failed');
  await context.check();
}

export async function getPendingOfflineRegistration(eventId: number): Promise<PendingOfflineRegistration | null> {
  const context = await registrationContext(eventId);
  return inStoreOrder(async () => {
    const saved = await readPendingRegistration(context);
    return saved?.stage === 'completed' ? null : saved;
  });
}

export async function reserveOfflineRegistration(eventId: number, label: string): Promise<PendingOfflineRegistration> {
  const context = await registrationContext(eventId);
  return inStoreOrder(async () => {
    const saved = await readPendingRegistration(context);
    if (saved && saved.stage !== 'completed') {
      if (saved.label !== label.trim()) throw new Error('offline_registration_unresolved');
      return saved;
    }
    const pending = pendingRegistrationSchema.parse({
      eventId, userId: context.userId, tenant: context.tenant, label: label.trim(),
      idempotencyKey: `mobile-offline-register-${ExpoCrypto.randomUUID()}`, revision: (saved?.revision ?? 0) + 1, stage: 'register',
    });
    await writePendingRegistration(context, pending);
    return pending as PendingOfflineRegistration;
  });
}

/** Compare revisions so a delayed response cannot replace a newer recovery step. */
export async function updatePendingOfflineRegistration(previous: PendingOfflineRegistration, next: PendingOfflineRegistration): Promise<PendingOfflineRegistration> {
  const context = await registrationContext(previous.eventId);
  return inStoreOrder(async () => {
    const saved = await readPendingRegistration(context);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(pendingRegistrationSchema.parse(previous))) {
      throw new Error('offline_registration_changed');
    }
    const updated = pendingRegistrationSchema.parse({ ...next, revision: previous.revision + 1 });
    if (updated.stage === 'completed') throw new Error('offline_registration_changed');
    if (updated.eventId !== saved.eventId || updated.userId !== saved.userId || updated.tenant !== saved.tenant || updated.label !== saved.label) {
      throw new Error('offline_registration_identity_changed');
    }
    await writePendingRegistration(context, updated);
    return updated;
  });
}

export async function completeOfflineRegistration(pending: PendingOfflineRegistration): Promise<void> {
  const context = await registrationContext(pending.eventId);
  await inStoreOrder(async () => {
    const saved = await readPendingRegistration(context);
    if (!saved || (saved.stage === 'completed' && saved.idempotencyKey === pending.idempotencyKey)) return;
    if (JSON.stringify(saved) !== JSON.stringify(pendingRegistrationSchema.parse(pending))) throw new Error('offline_registration_changed');
    await writePendingRegistration(context, {
      eventId: saved.eventId, userId: saved.userId, tenant: saved.tenant, label: saved.label,
      idempotencyKey: saved.idempotencyKey, revision: saved.revision + 1, stage: 'completed',
    });
  });
}

export type MobileOfflineQueueState = 'pending' | 'synced' | 'conflict' | 'rejected';

export interface MobileOfflineQueueItem {
  clientNonce: string;
  registrationId: number;
  userId: number;
  displayName: string;
  operation: OfflineAttendanceOperation;
  observedAt: string;
  expectedAttendanceVersion: number;
  credentialFingerprint: string;
  credentialHashReference: string;
  reason: string | null;
  state: MobileOfflineQueueState;
  code: string | null;
  decisionVersion: number | null;
}

export interface MobileOfflineSession {
  eventId: number;
  deviceId: number;
  deviceVersion: number;
  deviceSecret: string;
  replayWindowMinutes: number;
  batchMaxItems: number;
  manifest: MobileOfflineManifest;
  queue: MobileOfflineQueueItem[];
  activeBatchId: string | null;
  activeBatchNonces: string[];
  activeBatchManifestVersion?: number | null;
  activeServerBatchId?: number | null;
  activeBatchStatus?: MobileOfflineBatch['batch']['status'] | null;
  offlineWorkspace?: { userId: number; tenant: string; workspace: MobileOfflineWorkspace };
  updatedAt: string;
}

interface SignedClaims {
  alg: 'Ed25519';
  aud: 'event-checkin';
  evt: number;
  exp: number;
  iat: number;
  jti: string;
  kid: string;
  occ: string;
  ten: number;
  v: 2;
  ver: number;
}

interface SessionReference {
  eventId: number;
  deviceId: number;
}

function decodeBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('credential_invalid');
  const standard = value.replace(/-/g, '+').replace(/_/g, '/');
  return decodeBase64(standard + '='.repeat((4 - standard.length % 4) % 4));
}

function sessionKey(eventId: number, deviceId: number): string {
  return `event-${eventId}-device-${deviceId}`;
}

function sessionPath(eventId: number, deviceId: number): string {
  if (!FileSystem.documentDirectory) throw new Error('offline_store_unavailable');
  return `${FileSystem.documentDirectory}${DIRECTORY_NAME}/${sessionKey(eventId, deviceId)}.nqx`;
}

async function sha256(value: string): Promise<string> {
  return ExpoCrypto.digestStringAsync(ExpoCrypto.CryptoDigestAlgorithm.SHA256, value, {
    encoding: ExpoCrypto.CryptoEncoding.HEX,
  });
}

async function encryptionKey(create = true): Promise<Uint8Array> {
  const stored = await storage.get(KEY_STORAGE_KEY);
  if (stored) {
    const decoded = decodeBase64(stored);
    if (decoded.length !== nacl.secretbox.keyLength) throw new Error('offline_encryption_key_invalid');
    return decoded;
  }
  if (!create) throw new Error('offline_encryption_key_unavailable');
  const created = ExpoCrypto.getRandomBytes(nacl.secretbox.keyLength);
  await storage.set(KEY_STORAGE_KEY, encodeBase64(created));
  const verified = await storage.get(KEY_STORAGE_KEY);
  if (verified !== encodeBase64(created)) throw new Error('offline_encryption_key_unavailable');
  return created;
}

async function references(): Promise<SessionReference[]> {
  return (await storage.getJson<SessionReference[]>(INDEX_STORAGE_KEY)) ?? [];
}

async function setReferences(next: SessionReference[]): Promise<void> {
  await storage.setJson(INDEX_STORAGE_KEY, next);
}

async function writeCiphertext(eventId: number, deviceId: number, ciphertext: string): Promise<void> {
  if (Platform.OS === 'web') {
    await storage.set(`${WEB_RECORD_PREFIX}${sessionKey(eventId, deviceId)}`, ciphertext);
    return;
  }
  if (!FileSystem.documentDirectory) throw new Error('offline_store_unavailable');
  await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}${DIRECTORY_NAME}`, {
    intermediates: true,
  });
  await FileSystem.writeAsStringAsync(sessionPath(eventId, deviceId), ciphertext, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

async function readCiphertext(eventId: number, deviceId: number): Promise<string | null> {
  if (Platform.OS === 'web') {
    return storage.get(`${WEB_RECORD_PREFIX}${sessionKey(eventId, deviceId)}`);
  }
  const path = sessionPath(eventId, deviceId);
  const info = await FileSystem.getInfoAsync(path);
  return info.exists
    ? FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 })
    : null;
}

export function assertMobileOfflineSessionActive(session: MobileOfflineSession): void {
  if (new Date(session.manifest.expires_at).getTime() <= Date.now()) throw new Error('manifest_expired');
  if (session.manifest.device.id !== session.deviceId
    || session.manifest.device.version !== session.deviceVersion) throw new Error('device_rotated');
}

async function writeSession(session: MobileOfflineSession, generation: StoreGeneration, reconciliation = false): Promise<void> {
  assertStoreGeneration(generation);
  try {
    assertMobileOfflineSessionActive(session);
  } catch (error) {
    if (!reconciliation || !(error instanceof Error) || error.message !== 'manifest_expired') throw error;
  }
  const key = await encryptionKey(!reconciliation);
  assertStoreGeneration(generation);
  const ciphertext = sealMobileOfflinePayload(JSON.stringify(session), key);
  await writeCiphertext(session.eventId, session.deviceId, ciphertext);
  assertStoreGeneration(generation);
  const current = await references();
  assertStoreGeneration(generation);
  if (!current.some((item) => item.eventId === session.eventId && item.deviceId === session.deviceId)) {
    await setReferences([...current, { eventId: session.eventId, deviceId: session.deviceId }]);
  }
  assertStoreGeneration(generation);
}

export async function activateMobileOfflineSession(
  deviceSecret: string,
  manifest: MobileOfflineManifest,
  workspace: MobileOfflineWorkspace,
): Promise<MobileOfflineSession> {
  const generation = generationFor(manifest.event_id, manifest.device.id);
  if (manifest.event_id !== workspace.event_id || manifest.manifest_version !== workspace.manifest_version) {
    throw new Error('manifest_stale');
  }
  const session: MobileOfflineSession = {
    eventId: manifest.event_id,
    deviceId: manifest.device.id,
    deviceVersion: manifest.device.version,
    deviceSecret,
    replayWindowMinutes: workspace.limits.replay_window_minutes,
    batchMaxItems: workspace.limits.batch_max_items,
    manifest,
    queue: [],
    activeBatchId: null,
    activeBatchNonces: [],
    updatedAt: new Date().toISOString(),
  };
  await inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const existing = await readCiphertext(session.eventId, session.deviceId);
    assertStoreGeneration(generation);
    if (existing !== null) throw new Error('offline_registration_existing_session');
    await writeSession(session, generation);
  });
  return session;
}

export async function refreshMobileOfflineManifest(
  session: MobileOfflineSession,
  manifest: MobileOfflineManifest,
  workspace: MobileOfflineWorkspace,
): Promise<MobileOfflineSession> {
  const generation = generationFor(session.eventId, session.deviceId);
  assertMobileOfflineSessionActive(session);
  if (manifest.event_id !== session.eventId
    || manifest.device.id !== session.deviceId
    || manifest.device.version !== session.deviceVersion
    || workspace.event_id !== session.eventId) {
    throw new Error('device_rotated');
  }
  return inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const { session: current } = await readSessionForReview(session.eventId, session.deviceId, generation);
    if (!current || current.deviceVersion !== session.deviceVersion || current.deviceSecret !== session.deviceSecret) {
      throw new Error('offline_session_ended');
    }
    if (manifest.manifest_version < current.manifest.manifest_version) throw new Error('manifest_stale');
    const next: MobileOfflineSession = {
      ...current,
      manifest,
      replayWindowMinutes: workspace.limits.replay_window_minutes,
      batchMaxItems: workspace.limits.batch_max_items,
      updatedAt: new Date().toISOString(),
    };
    await writeSession(next, generation);
    return next;
  });
}

export type MobileOfflineInactiveReason = 'manifest_expired' | 'device_rotated' | 'device_revoked';

/** Call only with a freshly accepted server workspace, never inferred permissions. */
export async function cacheMobileOfflineWorkspace(
  session: MobileOfflineSession,
  value: MobileOfflineWorkspace,
): Promise<MobileOfflineSession> {
  const context = await registrationContext(session.eventId);
  const generation = generationFor(session.eventId, session.deviceId);
  const workspace = parseOfflineWorkspaceCache(value);
  const device = workspace.devices.find(item => item.id === session.deviceId);
  if (workspace.event_id !== session.eventId || !device || device.status !== 'active'
    || device.version !== session.deviceVersion || device.registered_by_user_id !== context.userId) {
    throw new Error('offline_workspace_identity_mismatch');
  }
  return inStoreOrder(async () => {
    await context.check();
    const review = await readSessionForReview(session.eventId, session.deviceId, generation);
    const current = review.session;
    if (!current || current.deviceSecret !== session.deviceSecret || current.deviceVersion !== session.deviceVersion
      || current.eventId !== session.eventId || current.manifest.event_id !== workspace.event_id
      || (current.offlineWorkspace && (current.offlineWorkspace.userId !== context.userId || current.offlineWorkspace.tenant !== context.tenant))) {
      throw new Error('offline_workspace_identity_mismatch');
    }
    const next = { ...current, offlineWorkspace: { userId: context.userId, tenant: context.tenant, workspace } };
    await context.check();
    await writeSession(next, generation, true);
    await context.check();
    return next;
  });
}

/** Existing unbound sessions require an online validation before offline restoration. */
export async function loadCachedMobileOfflineWorkspace(eventId: number): Promise<MobileOfflineSessionReview & { workspace: MobileOfflineWorkspace | null }> {
  const context = await registrationContext(eventId);
  return inStoreOrder(async () => {
    await context.check();
    for (const reference of await references()) {
      if (reference.eventId !== eventId) continue;
      const generation = generationFor(eventId, reference.deviceId);
      const review = await readSessionForReview(eventId, reference.deviceId, generation);
      await context.check();
      const session = review.session;
      const cache = session?.offlineWorkspace;
      if (!session || !cache || cache.userId !== context.userId || cache.tenant !== context.tenant) continue;
      const workspace = parseOfflineWorkspaceCache(cache.workspace);
      const device = workspace.devices.find(item => item.id === reference.deviceId);
      if (session.eventId !== eventId || session.deviceId !== reference.deviceId || workspace.event_id !== eventId
        || session.manifest.event_id !== eventId || session.manifest.device.id !== reference.deviceId
        || !device || device.registered_by_user_id !== context.userId || device.status !== 'active'
        || device.version !== session.deviceVersion) continue;
      assertStoreGeneration(generation);
      await context.check();
      return { ...review, workspace };
    }
    await context.check();
    return { session: null, inactive: null, workspace: null };
  });
}

/** A server refusal invalidates cached authority without deleting pending attendance. */
export async function invalidateCachedMobileOfflineWorkspace(eventId: number): Promise<void> {
  const context = await registrationContext(eventId);
  await inStoreOrder(async () => {
    await context.check();
    for (const reference of await references()) {
      if (reference.eventId !== eventId) continue;
      const generation = generationFor(eventId, reference.deviceId);
      const { session } = await readSessionForReview(eventId, reference.deviceId, generation);
      if (!session?.offlineWorkspace || session.offlineWorkspace.userId !== context.userId
        || session.offlineWorkspace.tenant !== context.tenant) continue;
      const next = { ...session };
      delete next.offlineWorkspace;
      await context.check();
      await writeSession(next, generation, true);
    }
    await context.check();
  });
}

export interface MobileOfflineSessionReview {
  session: MobileOfflineSession | null;
  /** Why the session can no longer queue or sync — null while it is still active. */
  inactive: MobileOfflineInactiveReason | null;
}

/**
 * Read a stored session WITHOUT destroying it when the manifest has expired or the device
 * was rotated.
 *
 * 🔴 `loadMobileOfflineSession` used to purge on ANY error, including those two. A staff
 * member who scanned twenty members while offline and opened the app a day later found the
 * queue gone with no word — the never-synced check-ins were deleted along with the expired
 * roster (audit 2026-09-05, S4-19). Only an unreadable record (wrong key, tampered
 * ciphertext) is destroyed here; an inactive session is returned read-only so the caller
 * can show how many pending items it still holds and let the member decide.
 */
export async function loadMobileOfflineSessionForReview(
  eventId: number,
  deviceId: number,
): Promise<MobileOfflineSessionReview> {
  const generation = generationFor(eventId, deviceId);
  return inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const review = await readSessionForReview(eventId, deviceId, generation);
    assertStoreGeneration(generation);
    return review;
  });
}

async function readSessionForReview(
  eventId: number,
  deviceId: number,
  generation: StoreGeneration,
): Promise<MobileOfflineSessionReview> {
  const ciphertext = await readCiphertext(eventId, deviceId);
  assertStoreGeneration(generation);
  if (!ciphertext) return { session: null, inactive: null };
  let session: MobileOfflineSession;
  try {
    const key = await encryptionKey(false);
    assertStoreGeneration(generation);
    session = JSON.parse(openMobileOfflinePayload(ciphertext, key)) as MobileOfflineSession;
    session.activeBatchNonces ??= [];
  } catch (error) {
    assertStoreGeneration(generation);
    invalidateDevice(eventId, deviceId);
    await purgeStoredSession(eventId, deviceId);
    throw error;
  }
  try {
    assertMobileOfflineSessionActive(session);
  } catch (error) {
    const reason = error instanceof Error ? error.message : '';
    if (reason === 'manifest_expired' || reason === 'device_rotated') {
      return { session, inactive: reason };
    }
    throw error;
  }
  return { session, inactive: null };
}

export async function loadMobileOfflineSession(
  eventId: number,
  deviceId: number,
): Promise<MobileOfflineSession | null> {
  const review = await loadMobileOfflineSessionForReview(eventId, deviceId);
  // Inactive is reported, not purged — see loadMobileOfflineSessionForReview.
  if (review.inactive) throw new Error(review.inactive);
  return review.session;
}

export async function verifyMobileOfflineCredential(
  credential: string,
  manifest: MobileOfflineManifest,
  now = new Date(),
): Promise<{ claims: SignedClaims; hash: string; fingerprint: string }> {
  const trimmed = credential.trim();
  if (!trimmed.startsWith('nqx2_') || trimmed.length > 1024) throw new Error('credential_invalid');
  const parts = trimmed.slice(5).split('.');
  const claimsPart = parts[0];
  const signaturePart = parts[1];
  if (parts.length !== 2 || !claimsPart || !signaturePart) throw new Error('credential_invalid');
  let rawClaims: unknown;
  try {
    rawClaims = JSON.parse(new TextDecoder().decode(decodeBase64Url(claimsPart)));
  } catch {
    throw new Error('credential_invalid');
  }
  if (!rawClaims || typeof rawClaims !== 'object' || Array.isArray(rawClaims)
    || Object.keys(rawClaims).some((key) => !ALLOWED_CLAIMS.has(key))) {
    throw new Error('credential_invalid');
  }
  const claims = rawClaims as SignedClaims;
  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (claims.alg !== 'Ed25519' || claims.aud !== 'event-checkin' || claims.v !== 2
    || claims.evt !== manifest.event_id || claims.ten !== manifest.tenant_id
    || claims.exp <= nowSeconds || claims.iat > nowSeconds + 300
    || !Number.isInteger(claims.ver) || claims.ver <= 0
    || !/^[0-9a-f]{16}$/.test(claims.kid) || !/^[0-9a-f]{64}$/.test(claims.occ)) {
    throw new Error(claims.exp <= nowSeconds ? 'credential_expired' : 'credential_invalid');
  }
  if (await sha256(manifest.occurrence_key) !== claims.occ) throw new Error('credential_wrong_event');
  const verificationKey = manifest.credential_verification.keys.find((key) => key.kid === claims.kid);
  if (!verificationKey) throw new Error('credential_signing_key_unknown');
  const valid = nacl.sign.detached.verify(
    new TextEncoder().encode(claimsPart),
    decodeBase64Url(signaturePart),
    decodeBase64Url(verificationKey.public_key),
  );
  if (!valid) throw new Error('credential_signature_invalid');
  const hash = await sha256(trimmed);
  return { claims, hash, fingerprint: hash.slice(0, 16) };
}

function transition(state: string, operation: OfflineAttendanceOperation): string {
  if (operation === 'check_in' && state === 'not_checked_in') return 'checked_in';
  if (operation === 'check_out' && state === 'checked_in') return 'checked_out';
  if (operation === 'no_show' && state === 'not_checked_in') return 'no_show';
  if (operation === 'undo' && state !== 'not_checked_in') return 'not_checked_in';
  throw new Error('transition_invalid');
}

export async function enqueueMobileOfflineCredential(
  session: MobileOfflineSession,
  credential: string,
  operation: OfflineAttendanceOperation,
  reason: string | null,
): Promise<MobileOfflineSession> {
  const generation = generationFor(session.eventId, session.deviceId);
  return inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const current = await readSessionForReview(session.eventId, session.deviceId, generation);
    if (!current.session) throw new Error('offline_session_ended');
    if (current.session) {
      if (current.session.deviceVersion !== session.deviceVersion || current.session.deviceSecret !== session.deviceSecret) {
        throw new Error('offline_session_ended');
      }
      session = current.session;
    }
    assertMobileOfflineSessionActive(session);
    if (session.queue.length >= MAX_LOCAL_ITEMS) throw new Error('queue_full');
    if (operation === 'undo' && !reason?.trim()) throw new Error('reason_required');
    const verified = await verifyMobileOfflineCredential(credential, session.manifest);
    const registration = session.manifest.registrations.find((item) => (
      item.credential_verifier === verified.hash
      && item.credential_fingerprint === verified.fingerprint
      && item.credential_version === verified.claims.ver
    ));
    if (!registration) throw new Error('credential_revoked_or_rotated');
    if (session.queue.some((item) => item.credentialHashReference === verified.hash
      && item.operation === operation && item.state === 'pending')) throw new Error('credential_copied');
    const subjectQueue = session.queue.filter((item) => item.registrationId === registration.registration_id);
    let state = registration.attendance_status ?? 'not_checked_in';
    subjectQueue.forEach((item) => {
      if (item.state !== 'conflict' && item.state !== 'rejected') state = transition(state, item.operation);
    });
    transition(state, operation);
    const expectedAttendanceVersion = registration.attendance_version
      + subjectQueue.filter((item) => item.state === 'pending' || item.state === 'synced').length;
    const next: MobileOfflineSession = {
      ...session,
      queue: [...session.queue, {
        clientNonce: ExpoCrypto.randomUUID(),
        registrationId: registration.registration_id,
        userId: registration.user_id,
        displayName: registration.display_name,
        operation,
        observedAt: new Date().toISOString(),
        expectedAttendanceVersion,
        credentialFingerprint: verified.fingerprint,
        credentialHashReference: verified.hash,
        reason: reason?.trim() || null,
        state: 'pending',
        code: null,
        decisionVersion: null,
      }],
      updatedAt: new Date().toISOString(),
    };
    await writeSession(next, generation);
    return next;
  });
}

export async function syncMobileOfflineSession(
  session: MobileOfflineSession,
): Promise<{ session: MobileOfflineSession; batch: MobileOfflineBatch | null }> {
  const generation = generationFor(session.eventId, session.deviceId);
  // Reserve the exact batch against the latest queue. Network I/O stays outside
  // this lock so scanning can continue while a request is in flight.
  const prepared = await inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const stored = await readSessionForReview(session.eventId, session.deviceId, generation);
    if (!stored.session) throw new Error('offline_session_ended');
    if (stored.session) {
      if (stored.session.deviceVersion !== session.deviceVersion || stored.session.deviceSecret !== session.deviceSecret) {
        throw new Error('offline_session_ended');
      }
      session = stored.session;
      if (session.activeBatchId && (stored.inactive === 'manifest_expired'
        || (!stored.inactive && session.activeBatchStatus === 'dead_letter'))) {
        return { session, mode: 'review' as const };
      }
      if (stored.inactive) throw new Error(stored.inactive);
    }
    assertMobileOfflineSessionActive(session);
    const cutoff = Date.now() - session.replayWindowMinutes * 60_000;
    const selected = session.activeBatchId && session.activeBatchNonces.length > 0
      ? new Set(session.activeBatchNonces) : null;
    let working: MobileOfflineSession = {
      ...session,
      queue: session.queue.map(item => !selected?.has(item.clientNonce) && item.state === 'pending'
        && new Date(item.observedAt).getTime() < cutoff
        ? { ...item, state: 'rejected' as const, code: 'replay_window_expired' } : item),
    };
    const pending = selected ? working.queue.filter(item => selected.has(item.clientNonce))
      : working.queue.filter(item => item.state === 'pending').slice(0, Math.min(session.batchMaxItems, MAX_LOCAL_ITEMS));
    if (pending.length === 0) {
      await writeSession(working, generation);
      return { session: working, mode: 'empty' as const };
    }
    working = {
      ...working,
      activeBatchId: working.activeBatchId ?? 'mobile-' + ExpoCrypto.randomUUID(),
      activeBatchNonces: pending.map(item => item.clientNonce),
      activeBatchManifestVersion: working.activeBatchId
        ? working.activeBatchManifestVersion ?? working.manifest.manifest_version : working.manifest.manifest_version,
    };
    await writeSession(working, generation);
    return { session: working, mode: 'send' as const };
  });
  session = prepared.session;
  if (prepared.mode === 'empty') return { session, batch: null };
  const selected = new Set(session.activeBatchNonces);
  const items = session.queue.filter(item => selected.has(item.clientNonce));
  if (!session.activeBatchId || !items.length || items.length !== selected.size) throw new Error('offline_batch_items_missing');
  const expected = {
    clientBatchId: session.activeBatchId,
    items: items.map(item => ({
      client_nonce: item.clientNonce, operation: item.operation,
      expected_attendance_version: item.expectedAttendanceVersion,
    })),
  };
  assertStoreGeneration(generation);
  const batch = prepared.mode === 'review'
    ? session.activeServerBatchId
      ? await getOfflineCheckinBatch(session.eventId, session.activeServerBatchId, expected)
      : await findOfflineCheckinBatch(session.eventId, session.deviceId, expected)
    : await syncOfflineCheckinBatch(session.eventId, {
      deviceSecret: session.deviceSecret,
      clientBatchId: session.activeBatchId,
      manifestVersion: session.activeBatchManifestVersion ?? session.manifest.manifest_version,
      items: items.map(item => ({
        client_nonce: item.clientNonce, operation: item.operation, observed_at: item.observedAt,
        expected_attendance_version: item.expectedAttendanceVersion,
        credential_fingerprint: item.credentialFingerprint, credential_hash_reference: item.credentialHashReference,
        ...(item.reason ? { reason: item.reason } : {}),
      })),
    });
  // Failure leaves the durable batch and any later scans untouched.
  const next = await persistBatchDecisions(session, batch, generation, prepared.mode === 'review');
  return { session: next, batch };
}

async function persistBatchDecisions(
  submitted: MobileOfflineSession,
  batch: MobileOfflineBatch,
  generation: StoreGeneration,
  reconciliation = false,
): Promise<MobileOfflineSession> {
  return inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const { session: current } = await readSessionForReview(submitted.eventId, submitted.deviceId, generation);
    if (!current || current.deviceVersion !== submitted.deviceVersion
      || current.deviceSecret !== submitted.deviceSecret || current.activeBatchId !== submitted.activeBatchId) {
      throw new Error('offline_session_ended');
    }
    const next = applyBatchDecisions(current, batch);
    await writeSession(next, generation, reconciliation);
    return next;
  });
}

function applyBatchDecisions(session: MobileOfflineSession, batch: MobileOfflineBatch): MobileOfflineSession {
  const decisions = new Map(batch.items.map(item => [item.client_nonce, item]));
  const selected = new Set(session.activeBatchNonces);
  const settled = ['completed', 'dead_letter'].includes(batch.batch?.status)
    && session.activeBatchNonces.every(nonce => {
      const decision = decisions.get(nonce);
      return decision && decision.state !== 'pending';
    });
  return {
    ...session,
    activeBatchId: settled ? null : session.activeBatchId,
    activeBatchNonces: settled ? [] : session.activeBatchNonces,
    activeBatchManifestVersion: settled ? null : session.activeBatchManifestVersion,
    activeServerBatchId: settled ? null : batch.batch?.id ?? session.activeServerBatchId,
    activeBatchStatus: settled ? null : batch.batch?.status ?? session.activeBatchStatus,
    queue: session.queue.map(item => {
      const decision = selected.has(item.clientNonce) ? decisions.get(item.clientNonce) : undefined;
      return decision ? { ...item, state: decision.state, code: decision.code, decisionVersion: decision.decision_version } : item;
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** Read decisions only: resolving a conflict must never resubmit an attendance action. */
export async function reconcileMobileOfflineConflicts(session: MobileOfflineSession): Promise<MobileOfflineSession> {
  const generation = generationFor(session.eventId, session.deviceId);
  const decisions = new Map<string, MobileOfflineBatch['items'][number]>();
  for (const item of session.queue) {
    if (item.state !== 'conflict' || decisions.has(item.clientNonce)) continue;
    assertStoreGeneration(generation);
    const batch = await findOfflineCheckinBatchByNonce(session.eventId, session.deviceId, {
      client_nonce: item.clientNonce, operation: item.operation,
      expected_attendance_version: item.expectedAttendanceVersion,
    });
    for (const decision of batch.items) decisions.set(decision.client_nonce, decision);
  }
  if (!decisions.size) return session;
  return inStoreOrder(async () => {
    assertStoreGeneration(generation);
    const { session: current } = await readSessionForReview(session.eventId, session.deviceId, generation);
    if (!current || current.deviceVersion !== session.deviceVersion || current.deviceSecret !== session.deviceSecret) {
      throw new Error('offline_session_ended');
    }
    const next = { ...current, updatedAt: new Date().toISOString(), queue: current.queue.map(item => {
      const decision = decisions.get(item.clientNonce);
      if (item.state !== 'conflict' || !decision || decision.state === 'pending'
        || decision.operation !== item.operation || decision.expected_attendance_version !== item.expectedAttendanceVersion
        || (decision.decision_version ?? 0) <= (item.decisionVersion ?? 0)) return item;
      return { ...item, state: decision.state, code: decision.code, decisionVersion: decision.decision_version };
    }) };
    await writeSession(next, generation, true);
    return next;
  });
}

export async function purgeMobileOfflineSession(eventId: number, deviceId: number): Promise<void> {
  invalidateDevice(eventId, deviceId);
  await inStoreOrder(() => purgeStoredSession(eventId, deviceId));
}

async function purgeStoredSession(eventId: number, deviceId: number): Promise<void> {
  if (Platform.OS === 'web') {
    await storage.remove(`${WEB_RECORD_PREFIX}${sessionKey(eventId, deviceId)}`);
  } else if (FileSystem.documentDirectory) {
    await FileSystem.deleteAsync(sessionPath(eventId, deviceId), { idempotent: true });
  }
  const current = await references();
  await setReferences(current.filter((item) => item.eventId !== eventId || item.deviceId !== deviceId));
}

export async function purgeRevokedOrExpiredMobileSessions(
  workspace: MobileOfflineWorkspace,
): Promise<void> {
  const active = new Map(workspace.devices.map((device) => [device.id, device.status]));
  const current = await references();
  for (const reference of current.filter((item) => item.eventId === workspace.event_id)) {
    if (active.get(reference.deviceId) !== 'active') {
      await purgeMobileOfflineSession(reference.eventId, reference.deviceId);
    }
  }
}

export async function purgeAllMobileOfflineCheckinData(): Promise<void> {
  // Invalidate even operations still awaiting the network, then clean up after
  // any native write already dispatched. No old completion can recreate the key.
  storeGeneration += 1;
  await inStoreOrder(purgeAllStoredData);
}

async function purgeAllStoredData(): Promise<void> {
  try {
    if (Platform.OS === 'web') {
      for (const reference of await references()) {
        await storage.remove(`${WEB_RECORD_PREFIX}${sessionKey(reference.eventId, reference.deviceId)}`);
      }
    } else if (FileSystem.documentDirectory) {
      await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${DIRECTORY_NAME}`, { idempotent: true });
    }
  } catch (error) {
    reportToSink(error, { operation: 'purge_offline_checkin_files' });
  } finally {
    // A leftover ciphertext file must not keep its key just because deletion failed.
    await Promise.all([
      storage.remove(KEY_STORAGE_KEY),
      storage.remove(INDEX_STORAGE_KEY),
    ]);
  }
}
