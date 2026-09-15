// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const crypto = require('node:crypto');
const { Buffer } = require('node:buffer');

function decodeBase32(value) {
  const normalized = String(value).toUpperCase().replace(/[=\s-]/g, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) {
    throw new Error('E2E_ADMIN_TOTP_SECRET must be a base32 secret');
  }

  let bits = '';
  for (const character of normalized) {
    const index = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(character);
    bits += index.toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function createTotpCode(secret, timestampSeconds = Math.floor(Date.now() / 1000)) {
  const counter = BigInt(Math.floor(timestampSeconds / 30));
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(counter);

  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
}

module.exports = { createTotpCode };
