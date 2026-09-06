// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as ExpoCrypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import nacl from 'tweetnacl';
import { Platform } from 'react-native';
import {
  syncOfflineCheckinBatch,
  type MobileOfflineBatch,
  type MobileOfflineManifest,
  type MobileOfflineWorkspace,
  type OfflineAttendanceOperation,
} from '@/lib/api/eventOfflineCheckin';
import { storage } from '@/lib/storage';

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
const ALLOWED_CLAIMS = new Set(['alg', 'aud', 'evt', 'exp', 'iat', 'jti', 'kid', 'occ', 'ten', 'v', 'ver']);

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

interface EncryptedEnvelope {
  v: 1;
  nonce: string;
  ciphertext: string;
}

interface SessionReference {
  eventId: number;
  deviceId: number;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    result += BASE64[(chunk >> 18) & 63];
    result += BASE64[(chunk >> 12) & 63];
    result += second === undefined ? '=' : BASE64[(chunk >> 6) & 63];
    result += third === undefined ? '=' : BASE64[chunk & 63];
  }
  return result;
}

function decodeBase64(value: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error('offline_ciphertext_invalid');
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const a = BASE64.indexOf(value[index] ?? '');
    const b = BASE64.indexOf(value[index + 1] ?? '');
    const c = value[index + 2] === '=' ? 0 : BASE64.indexOf(value[index + 2] ?? '');
    const d = value[index + 3] === '=' ? 0 : BASE64.indexOf(value[index + 3] ?? '');
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('offline_ciphertext_invalid');
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    bytes.push((chunk >> 16) & 255);
    if (value[index + 2] !== '=') bytes.push((chunk >> 8) & 255);
    if (value[index + 3] !== '=') bytes.push(chunk & 255);
  }
  return Uint8Array.from(bytes);
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

async function encryptionKey(): Promise<Uint8Array> {
  const stored = await storage.get(KEY_STORAGE_KEY);
  if (stored) {
    const decoded = decodeBase64(stored);
    if (decoded.length !== nacl.secretbox.keyLength) throw new Error('offline_encryption_key_invalid');
    return decoded;
  }
  const created = ExpoCrypto.getRandomBytes(nacl.secretbox.keyLength);
  await storage.set(KEY_STORAGE_KEY, encodeBase64(created));
  const verified = await storage.get(KEY_STORAGE_KEY);
  if (verified !== encodeBase64(created)) throw new Error('offline_encryption_key_unavailable');
  return created;
}

export function sealMobileOfflinePayload(value: string, key: Uint8Array, nonce?: Uint8Array): string {
  if (key.length !== nacl.secretbox.keyLength) throw new Error('offline_encryption_key_invalid');
  const actualNonce = nonce ?? ExpoCrypto.getRandomBytes(nacl.secretbox.nonceLength);
  if (actualNonce.length !== nacl.secretbox.nonceLength) throw new Error('offline_nonce_invalid');
  const ciphertext = nacl.secretbox(new TextEncoder().encode(value), actualNonce, key);
  return JSON.stringify({
    v: 1,
    nonce: encodeBase64(actualNonce),
    ciphertext: encodeBase64(ciphertext),
  } satisfies EncryptedEnvelope);
}

export function openMobileOfflinePayload(value: string, key: Uint8Array): string {
  if (key.length !== nacl.secretbox.keyLength) throw new Error('offline_encryption_key_invalid');
  let parsed: EncryptedEnvelope;
  try {
    parsed = JSON.parse(value) as EncryptedEnvelope;
  } catch {
    throw new Error('offline_ciphertext_invalid');
  }
  if (parsed.v !== 1 || typeof parsed.nonce !== 'string' || typeof parsed.ciphertext !== 'string') {
    throw new Error('offline_ciphertext_invalid');
  }
  const nonce = decodeBase64(parsed.nonce);
  const ciphertext = decodeBase64(parsed.ciphertext);
  if (nonce.length !== nacl.secretbox.nonceLength) throw new Error('offline_ciphertext_invalid');
  const plaintext = nacl.secretbox.open(ciphertext, nonce, key);
  if (!plaintext) throw new Error('offline_ciphertext_invalid');
  return new TextDecoder().decode(plaintext);
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

async function saveSession(session: MobileOfflineSession): Promise<void> {
  assertMobileOfflineSessionActive(session);
  const key = await encryptionKey();
  const ciphertext = sealMobileOfflinePayload(JSON.stringify(session), key);
  await writeCiphertext(session.eventId, session.deviceId, ciphertext);
  const current = await references();
  if (!current.some((item) => item.eventId === session.eventId && item.deviceId === session.deviceId)) {
    await setReferences([...current, { eventId: session.eventId, deviceId: session.deviceId }]);
  }
}

export async function activateMobileOfflineSession(
  deviceSecret: string,
  manifest: MobileOfflineManifest,
  workspace: MobileOfflineWorkspace,
): Promise<MobileOfflineSession> {
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
  await saveSession(session);
  return session;
}

export async function refreshMobileOfflineManifest(
  session: MobileOfflineSession,
  manifest: MobileOfflineManifest,
  workspace: MobileOfflineWorkspace,
): Promise<MobileOfflineSession> {
  assertMobileOfflineSessionActive(session);
  if (manifest.event_id !== session.eventId
    || manifest.device.id !== session.deviceId
    || manifest.device.version !== session.deviceVersion
    || workspace.event_id !== session.eventId) {
    throw new Error('device_rotated');
  }
  const next: MobileOfflineSession = {
    ...session,
    manifest,
    replayWindowMinutes: workspace.limits.replay_window_minutes,
    batchMaxItems: workspace.limits.batch_max_items,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(next);
  return next;
}

export type MobileOfflineInactiveReason = 'manifest_expired' | 'device_rotated';

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
  const ciphertext = await readCiphertext(eventId, deviceId);
  if (!ciphertext) return { session: null, inactive: null };
  let session: MobileOfflineSession;
  try {
    const key = await encryptionKey();
    session = JSON.parse(openMobileOfflinePayload(ciphertext, key)) as MobileOfflineSession;
    session.activeBatchNonces ??= [];
  } catch (error) {
    await purgeMobileOfflineSession(eventId, deviceId);
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
  await saveSession(next);
  return next;
}

export async function syncMobileOfflineSession(
  session: MobileOfflineSession,
): Promise<{ session: MobileOfflineSession; batch: MobileOfflineBatch | null }> {
  assertMobileOfflineSessionActive(session);
  const cutoff = Date.now() - session.replayWindowMinutes * 60_000;
  let working: MobileOfflineSession = {
    ...session,
    queue: session.queue.map((item) => item.state === 'pending' && new Date(item.observedAt).getTime() < cutoff
      ? { ...item, state: 'rejected' as const, code: 'replay_window_expired' }
      : item),
  };
  const allPending = working.queue.filter((item) => item.state === 'pending');
  const selected = working.activeBatchId && working.activeBatchNonces.length > 0
    ? new Set(working.activeBatchNonces)
    : null;
  const pending = (selected
    ? allPending.filter((item) => selected.has(item.clientNonce))
    : allPending.slice(0, Math.min(session.batchMaxItems, MAX_LOCAL_ITEMS)));
  if (pending.length === 0) {
    await saveSession(working);
    return { session: working, batch: null };
  }
  const clientBatchId = working.activeBatchId ?? `mobile-${ExpoCrypto.randomUUID()}`;
  try {
    const batch = await syncOfflineCheckinBatch(session.eventId, {
      deviceSecret: session.deviceSecret,
      clientBatchId,
      manifestVersion: session.manifest.manifest_version,
      items: pending.map((item) => ({
        client_nonce: item.clientNonce,
        operation: item.operation,
        observed_at: item.observedAt,
        expected_attendance_version: item.expectedAttendanceVersion,
        credential_fingerprint: item.credentialFingerprint,
        credential_hash_reference: item.credentialHashReference,
        ...(item.reason ? { reason: item.reason } : {}),
      })),
    });
    const decisions = new Map(batch.items.map((item) => [item.client_nonce, item]));
    working = {
      ...working,
      activeBatchId: null,
      activeBatchNonces: [],
      queue: working.queue.map((item) => {
        const decision = decisions.get(item.clientNonce);
        return decision ? {
          ...item,
          state: decision.state,
          code: decision.code,
          decisionVersion: decision.decision_version,
        } : item;
      }),
      updatedAt: new Date().toISOString(),
    };
    await saveSession(working);
    return { session: working, batch };
  } catch (error) {
    working = {
      ...working,
      activeBatchId: clientBatchId,
      activeBatchNonces: pending.map((item) => item.clientNonce),
      updatedAt: new Date().toISOString(),
    };
    await saveSession(working);
    throw error;
  }
}

export async function purgeMobileOfflineSession(eventId: number, deviceId: number): Promise<void> {
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
  if (Platform.OS === 'web') {
    for (const reference of await references()) {
      await storage.remove(`${WEB_RECORD_PREFIX}${sessionKey(reference.eventId, reference.deviceId)}`);
    }
  } else if (FileSystem.documentDirectory) {
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}${DIRECTORY_NAME}`, { idempotent: true });
  }
  await Promise.all([
    storage.remove(KEY_STORAGE_KEY),
    storage.remove(INDEX_STORAGE_KEY),
  ]);
}
