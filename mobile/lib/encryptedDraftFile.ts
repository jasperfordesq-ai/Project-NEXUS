// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import * as FileSystem from 'expo-file-system/legacy';
import * as Crypto from 'expo-crypto';
import { storage } from './storage';
import { encodeBase64, decodeBase64, sealMobileOfflinePayload, openMobileOfflinePayload } from './encryptedPayload';

type Manifest = { version: 1; generation: string; key: string };
const directory = () => {
  if (!FileSystem.documentDirectory) throw new Error('Draft storage unavailable');
  return `${FileSystem.documentDirectory}creation-drafts/`;
};
const pointer = (scope: string) => {
  if (!/^[A-Za-z0-9._-]+$/.test(scope)) throw new Error('Invalid draft scope');
  return `${scope}_file_v1`;
};
const file = (scope: string, generation: string) => `${directory()}${scope}_${generation}.nqx`;
async function manifest(scope: string): Promise<Manifest | null> {
  const raw = await storage.get(pointer(scope), { required: true });
  if (raw === null) return null;
  const value = JSON.parse(raw) as Manifest;
  if (value?.version !== 1 || typeof value.generation !== 'string' || !/^[a-f0-9]{32}$/.test(value.generation)
    || typeof value.key !== 'string' || decodeBase64(value.key).length !== 32) throw new Error('Invalid draft manifest');
  return value;
}
const queues = new Map<string, Promise<void>>();
async function ordered<T>(scope: string, action: () => Promise<T>): Promise<T> {
  pointer(scope);
  const next = (queues.get(scope) ?? Promise.resolve()).then(action);
  const settled = next.then(() => undefined, () => undefined);
  queues.set(scope, settled);
  try { return await next; } finally { if (queues.get(scope) === settled) queues.delete(scope); }
}
/** Ciphertext is verified before the small Keychain/Keystore pointer commits it.
 * A failed write leaves the previous complete generation authoritative.
 * Keys and the authoritative pointer live in SecureStore; plaintext never enters a file.
 */
export function saveEncryptedDraftFile(scope: string, value: unknown): Promise<void> {
  return ordered(scope, async () => {
    const previous = await manifest(scope);
    const plain = JSON.stringify(value);
    if (plain === undefined) throw new Error('Invalid draft value');
    const key = Crypto.getRandomBytes(32);
    const generation = Array.from(Crypto.getRandomBytes(16), byte => byte.toString(16).padStart(2, '0')).join('');
    const path = file(scope, generation);
    await FileSystem.makeDirectoryAsync(directory(), { intermediates: true });
    await FileSystem.writeAsStringAsync(path, sealMobileOfflinePayload(plain, key), { encoding: FileSystem.EncodingType.UTF8 });
    const verified = openMobileOfflinePayload(await FileSystem.readAsStringAsync(path, { encoding: FileSystem.EncodingType.UTF8 }), key);
    if (verified !== plain) throw new Error('Draft verification failed');
    await storage.set(pointer(scope), JSON.stringify({ version: 1, generation, key: encodeBase64(key) } satisfies Manifest), { required: true });
    if (previous) await FileSystem.deleteAsync(file(scope, previous.generation), { idempotent: true }).catch(() => undefined);
  });
}
/** Missing means no file-backed generation; corrupt/unavailable never means absent. */
export function loadEncryptedDraftFile<T>(scope: string): Promise<{ value: T } | null> {
  return ordered(scope, async () => {
    const saved = await manifest(scope);
    if (!saved) return null;
    const ciphertext = await FileSystem.readAsStringAsync(file(scope, saved.generation), { encoding: FileSystem.EncodingType.UTF8 });
    return { value: JSON.parse(openMobileOfflinePayload(ciphertext, decodeBase64(saved.key))) as T };
  });
}
