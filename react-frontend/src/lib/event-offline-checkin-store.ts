// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  eventOfflineCheckinApi,
  type OfflineCheckinBatch,
  type OfflineCheckinManifest,
  type OfflineOperation,
} from '@/lib/event-offline-checkin-api';
import { tokenManager } from '@/lib/api';

const DATABASE_NAME = 'nexus-event-checkin-v1';
const DATABASE_VERSION = 1;
const KEY_STORE = 'keys';
const RECORD_STORE = 'records';
const MAX_LOCAL_ITEMS = 500;

export type OfflineQueueState = 'pending' | 'synced' | 'conflict' | 'rejected';

export interface OfflineQueueItem {
  clientNonce: string;
  registrationId: number;
  userId: number;
  displayName: string;
  operation: OfflineOperation;
  observedAt: string;
  expectedAttendanceVersion: number;
  credentialFingerprint: string;
  credentialHashReference: string;
  reason: string | null;
  state: OfflineQueueState;
  code: string | null;
  decisionVersion: number | null;
}

export interface OfflineCheckinSession {
  sessionGeneration: string | null;
  eventId: number;
  deviceId: number;
  deviceVersion: number;
  deviceSecret: string;
  manifest: OfflineCheckinManifest;
  queue: OfflineQueueItem[];
  activeBatchId: string | null;
  activeBatchNonces: string[];
  updatedAt: string;
}

interface EncryptedRecord {
  id: string;
  sessionGeneration?: string | null;
  eventId: number;
  deviceId: number;
  expiresAt: string;
  iv: string;
  ciphertext: string;
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

function currentSessionGeneration(): string | null {
  try {
    const storage = sessionStorage.getItem('nexus_impersonation_active') === '1'
      ? sessionStorage
      : localStorage;
    return storage.getItem('nexus_auth_session_generation');
  } catch {
    return null;
  }
}

function sessionId(eventId: number, deviceId: number, generation: string | null): string {
  const suffix = `event:${eventId}:device:${deviceId}`;
  return generation ? `session:${generation}:${suffix}` : suffix;
}

function base64UrlBytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('credential_invalid');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - value.length % 4) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export async function verifyOfflineCredential(
  credential: string,
  manifest: OfflineCheckinManifest,
  now = new Date(),
): Promise<{ claims: SignedClaims; hash: string; fingerprint: string }> {
  const trimmed = credential.trim();
  if (!trimmed.startsWith('nqx2_') || trimmed.length > 1024) {
    throw new Error('credential_invalid');
  }
  const parts = trimmed.slice(5).split('.');
  if (parts.length !== 2) throw new Error('credential_invalid');
  const claimsPart = parts[0];
  const signaturePart = parts[1];
  if (!claimsPart || !signaturePart) throw new Error('credential_invalid');
  let claims: SignedClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlBytes(claimsPart))) as SignedClaims;
  } catch {
    throw new Error('credential_invalid');
  }
  if (claims.alg !== 'Ed25519' || claims.aud !== 'event-checkin' || claims.v !== 2
    || claims.evt !== manifest.event_id || claims.ten !== manifest.tenant_id
    || claims.exp <= Math.floor(now.getTime() / 1000)
    || claims.iat > Math.floor(now.getTime() / 1000) + 300
    || !/^[0-9a-f]{16}$/.test(claims.kid)
    || !/^[0-9a-f]{64}$/.test(claims.occ)
    || !Number.isInteger(claims.ver) || claims.ver <= 0) {
    throw new Error(claims.exp <= Math.floor(now.getTime() / 1000)
      ? 'credential_expired'
      : 'credential_invalid');
  }
  const occurrenceHash = await sha256Hex(manifest.occurrence_key);
  if (occurrenceHash !== claims.occ) throw new Error('credential_wrong_event');
  const verificationKey = manifest.credential_verification.keys
    .find((candidate) => candidate.kid === claims.kid && candidate.alg === 'Ed25519');
  if (!verificationKey) throw new Error('credential_signing_key_unknown');
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      base64UrlBytes(verificationKey.public_key),
      { name: 'Ed25519' }, // admin-i18n-ignore: Web Crypto algorithm identifier
      false,
      ['verify'],
    );
    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' }, // admin-i18n-ignore: Web Crypto algorithm identifier
      key,
      base64UrlBytes(signaturePart),
      new TextEncoder().encode(claimsPart),
    );
    if (!valid) throw new Error('credential_signature_invalid');
  } catch (error) {
    if (error instanceof Error && error.message === 'credential_signature_invalid') throw error;
    throw new Error('credential_verification_unavailable');
  }
  const hash = await sha256Hex(trimmed);

  return { claims, hash, fingerprint: hash.slice(0, 16) };
}

export function deriveOfflineTransition(
  initialState: string | null,
  queued: Array<Pick<OfflineQueueItem, 'operation' | 'state'>>,
  operation: OfflineOperation,
): string {
  let state = initialState ?? 'not_checked_in';
  for (const item of queued) {
    if (item.state === 'rejected' || item.state === 'conflict') continue;
    state = applyTransition(state, item.operation);
  }

  return applyTransition(state, operation);
}

function applyTransition(state: string, operation: OfflineOperation): string {
  if (operation === 'check_in' && state === 'not_checked_in') return 'checked_in';
  if (operation === 'check_out' && state === 'checked_in') return 'checked_out';
  if (operation === 'no_show' && state === 'not_checked_in') return 'no_show';
  if (operation === 'undo' && state !== 'not_checked_in') return 'not_checked_in';
  throw new Error('transition_invalid');
}

export async function activateOfflineCheckinSession(
  deviceSecret: string,
  manifest: OfflineCheckinManifest,
): Promise<OfflineCheckinSession> {
  const expiresAt = new Date(manifest.expires_at);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date()) {
    throw new Error('manifest_expired');
  }
  const session: OfflineCheckinSession = {
    sessionGeneration: currentSessionGeneration(),
    eventId: manifest.event_id,
    deviceId: manifest.device.id,
    deviceVersion: manifest.device.version,
    deviceSecret,
    manifest,
    queue: [],
    activeBatchId: null,
    activeBatchNonces: [],
    updatedAt: new Date().toISOString(),
  };
  await saveSession(session);

  return session;
}

export async function refreshOfflineCheckinManifest(
  session: OfflineCheckinSession,
  manifest: OfflineCheckinManifest,
): Promise<OfflineCheckinSession> {
  assertSessionActive(session);
  if (manifest.event_id !== session.eventId
    || manifest.device.id !== session.deviceId
    || manifest.device.version !== session.deviceVersion) {
    throw new Error('device_rotated');
  }
  const next: OfflineCheckinSession = {
    ...session,
    manifest,
    updatedAt: new Date().toISOString(),
  };
  await saveSession(next);

  return next;
}

export async function enqueueOfflineCredential(
  session: OfflineCheckinSession,
  credential: string,
  operation: OfflineOperation,
  reason: string | null,
): Promise<OfflineCheckinSession> {
  if (session.queue.length >= MAX_LOCAL_ITEMS) throw new Error('queue_full');
  assertSessionActive(session);
  const verified = await verifyOfflineCredential(credential, session.manifest);
  const registration = session.manifest.registrations.find(
    (candidate) => candidate.credential_verifier === verified.hash
      && candidate.credential_fingerprint === verified.fingerprint
      && candidate.credential_version === verified.claims.ver,
  );
  if (!registration) throw new Error('credential_revoked_or_rotated');
  if (session.queue.some((item) => item.credentialHashReference === verified.hash
    && item.operation === operation && item.state === 'pending')) {
    throw new Error('credential_copied');
  }
  const subjectQueue = session.queue.filter(
    (item) => item.registrationId === registration.registration_id,
  );
  deriveOfflineTransition(registration.attendance_status, subjectQueue, operation);
  if (operation === 'undo' && !reason?.trim()) throw new Error('reason_required');
  const expectedAttendanceVersion = registration.attendance_version
    + subjectQueue.filter((item) => item.state === 'pending' || item.state === 'synced').length;
  const next: OfflineCheckinSession = {
    ...session,
    queue: [...session.queue, {
      clientNonce: crypto.randomUUID(),
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

export async function synchronizeOfflineCheckin(
  session: OfflineCheckinSession,
): Promise<{ session: OfflineCheckinSession; batch: OfflineCheckinBatch | null }> {
  assertSessionActive(session);
  if (!navigator.onLine) throw new Error('offline');
  const allPending = session.queue.filter((item) => item.state === 'pending');
  const selectedNonces = session.activeBatchId && session.activeBatchNonces.length > 0
    ? new Set(session.activeBatchNonces)
    : null;
  const pending = (selectedNonces
    ? allPending.filter((item) => selectedNonces.has(item.clientNonce))
    : allPending.slice(0, MAX_LOCAL_ITEMS));
  if (pending.length === 0) return { session, batch: null };
  const clientBatchId = session.activeBatchId ?? `web-${crypto.randomUUID()}`;
  const staged = await eventOfflineCheckinApi.stage(session.eventId, {
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
  if (!staged.success || !staged.data) {
    const next = {
      ...session,
      activeBatchId: clientBatchId,
      activeBatchNonces: pending.map((item) => item.clientNonce),
      updatedAt: new Date().toISOString(),
    };
    await saveSession(next);
    throw new Error(staged.code ?? 'sync_failed');
  }
  const states = new Map(staged.data.items.map((item) => [item.client_nonce, item]));
  const next: OfflineCheckinSession = {
    ...session,
    activeBatchId: null,
    activeBatchNonces: [],
    queue: session.queue.map((item) => {
      const decision = states.get(item.clientNonce);
      return decision ? {
        ...item,
        state: decision.state,
        code: decision.code,
        decisionVersion: decision.decision_version,
      } : item;
    }),
    updatedAt: new Date().toISOString(),
  };
  await saveSession(next);

  return { session: next, batch: staged.data };
}

export async function loadOfflineCheckinSession(
  eventId: number,
  deviceId: number,
): Promise<OfflineCheckinSession | null> {
  const database = await openDatabase();
  const generation = currentSessionGeneration();
  const id = sessionId(eventId, deviceId, generation);
  const legacyId = sessionId(eventId, deviceId, null);
  const record = await requestResult<EncryptedRecord | undefined>(
    database.transaction(RECORD_STORE, 'readonly').objectStore(RECORD_STORE).get(id),
  );
  if (generation !== null) {
    const unownedLegacyRecord = await requestResult<EncryptedRecord | undefined>(
      database.transaction(RECORD_STORE, 'readonly').objectStore(RECORD_STORE).get(legacyId),
    );
    if (unownedLegacyRecord) await purgeRecord(database, legacyId);
  }
  if (!record) return null;
  if (new Date(record.expiresAt) <= new Date()) {
    await purgeRecord(database, id);
    return null;
  }
  const key = await requestResult<CryptoKey | undefined>(
    database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(id),
  );
  if (!key) {
    await purgeRecord(database, id);
    return null;
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(record.iv) },
      key,
      base64ToBytes(record.ciphertext),
    );
    const session = JSON.parse(new TextDecoder().decode(plaintext)) as OfflineCheckinSession;
    session.activeBatchNonces ??= [];
    session.sessionGeneration = generation;
    assertSessionActive(session);
    return session;
  } catch {
    await purgeRecord(database, id);
    throw new Error('encrypted_store_invalid');
  }
}

export async function purgeOfflineCheckinSession(
  eventId: number,
  deviceId: number,
  generation = currentSessionGeneration(),
): Promise<void> {
  const database = await openDatabase();
  await purgeRecord(database, sessionId(eventId, deviceId, generation));
}

export async function removeSyncedOfflineCheckinItems(
  session: OfflineCheckinSession,
): Promise<OfflineCheckinSession> {
  const next: OfflineCheckinSession = {
    ...session,
    queue: session.queue.filter((item) => item.state !== 'synced'),
    updatedAt: new Date().toISOString(),
  };
  await saveSession(next);

  return next;
}

export async function purgeAllOfflineCheckinData(): Promise<void> {
  return purgeOfflineCheckinDataForGeneration(currentSessionGeneration());
}

export async function purgeOfflineCheckinDataForGeneration(
  generation: string | null,
): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  const database = await openDatabase();
  const transaction = database.transaction([KEY_STORE, RECORD_STORE], 'readwrite');
  const keyStore = transaction.objectStore(KEY_STORE);
  const records = transaction.objectStore(RECORD_STORE);
  const cursorRequest = records.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const record = cursor.value as EncryptedRecord;
    if (record.sessionGeneration === generation || record.sessionGeneration === undefined) {
      keyStore.delete(record.id);
      cursor.delete();
    }
    cursor.continue();
  };
  await transactionComplete(transaction);
}

async function saveSession(session: OfflineCheckinSession): Promise<void> {
  assertSessionActive(session);
  if (currentSessionGeneration() !== session.sessionGeneration) {
    throw new Error('auth_context_changed');
  }
  const database = await openDatabase();
  const id = sessionId(session.eventId, session.deviceId, session.sessionGeneration);
  let key = await requestResult<CryptoKey | undefined>(
    database.transaction(KEY_STORE, 'readonly').objectStore(KEY_STORE).get(id),
  );
  if (!key) {
    key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    const keyTransaction = database.transaction(KEY_STORE, 'readwrite');
    keyTransaction.objectStore(KEY_STORE).put(key, id);
    await transactionComplete(keyTransaction);
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(session));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const record: EncryptedRecord = {
    id,
    sessionGeneration: session.sessionGeneration,
    eventId: session.eventId,
    deviceId: session.deviceId,
    expiresAt: session.manifest.expires_at,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    updatedAt: session.updatedAt,
  };
  let recordTransaction: IDBTransaction | null = null;
  const committed = await tokenManager.runIfSessionCurrent(session.sessionGeneration, () => {
    recordTransaction = database.transaction(RECORD_STORE, 'readwrite');
    recordTransaction.objectStore(RECORD_STORE).put(record);
    return true;
  });
  if (!committed || !recordTransaction) {
    await purgeRecord(database, id);
    throw new Error('auth_context_changed');
  }
  await transactionComplete(recordTransaction);
}

async function purgeRecord(database: IDBDatabase, id: string): Promise<void> {
  const transaction = database.transaction([KEY_STORE, RECORD_STORE], 'readwrite');
  transaction.objectStore(KEY_STORE).delete(id);
  transaction.objectStore(RECORD_STORE).delete(id);
  await transactionComplete(transaction);
}

function assertSessionActive(session: OfflineCheckinSession): void {
  if (new Date(session.manifest.expires_at) <= new Date()) throw new Error('manifest_expired');
  if (session.manifest.device.id !== session.deviceId
    || session.manifest.device.version !== session.deviceVersion) {
    throw new Error('device_rotated');
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined' || !crypto.subtle) {
    return Promise.reject(new Error('offline_store_unavailable'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(KEY_STORE)) database.createObjectStore(KEY_STORE);
      if (!database.objectStoreNames.contains(RECORD_STORE)) {
        database.createObjectStore(RECORD_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('offline_store_unavailable'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('offline_store_failed'));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('offline_store_failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('offline_store_failed'));
  });
}
