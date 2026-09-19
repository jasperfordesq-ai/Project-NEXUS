// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import * as ExpoCrypto from 'expo-crypto';
import nacl from 'tweetnacl';

interface EncryptedEnvelope {
  v: 1;
  nonce: string;
  ciphertext: string;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBase64(bytes: Uint8Array): string {
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

export function decodeBase64(value: string): Uint8Array {
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
