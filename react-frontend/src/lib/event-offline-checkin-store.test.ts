// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import type { OfflineCheckinManifest } from '@/lib/event-offline-checkin-api';
import {
  deriveOfflineTransition,
  offlineDecisionMessage,
  verifyOfflineCredential,
} from '@/lib/event-offline-checkin-store';

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function fixture(expiresAt: number) {
  const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const occurrenceKey = 'event:91:occurrence:2026-07-12T09:00:00Z';
  const claims = {
    alg: 'Ed25519',
    aud: 'event-checkin',
    evt: 91,
    exp: expiresAt,
    iat: 1_750_000_000,
    jti: '4cbf93da-75bc-4535-a4df-caa9d56c9662',
    kid: '0123456789abcdef',
    occ: await digest(occurrenceKey),
    ten: 7,
    v: 2,
    ver: 3,
  } as const;
  const claimsPart = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'Ed25519' },
    keys.privateKey,
    new TextEncoder().encode(claimsPart),
  ));
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const credential = `nqx2_${claimsPart}.${base64Url(signature)}`;
  const credentialHash = await digest(credential);
  const manifest: OfflineCheckinManifest = {
    schema_version: 2,
    tenant_id: 7,
    event_id: 91,
    occurrence_key: occurrenceKey,
    manifest_version: 8,
    device: { id: 22, version: 1 },
    generated_at: '2026-07-12T08:00:00Z',
    expires_at: '2026-07-13T08:00:00Z',
    credential_verification: {
      format: 'nqx2',
      algorithm: 'Ed25519',
      keys: [{
        kid: claims.kid,
        alg: 'Ed25519',
        public_key: base64Url(publicKey),
      }],
    },
    registrations: [{
      registration_id: 44,
      user_id: 55,
      display_name: 'Test Member',
      credential_version: 3,
      credential_fingerprint: credentialHash.slice(0, 16),
      credential_verifier: credentialHash,
      attendance_status: null,
      attendance_version: 0,
    }],
    privacy: {
      credential_contains_pii: false,
      encrypted_at_rest_required: true,
    },
  };
  return { credential, manifest };
}

describe('event offline check-in store', () => {
  it('verifies a scoped Ed25519 credential without trusting its opaque identifier', async () => {
    const now = new Date('2026-07-12T09:00:00Z');
    const { credential, manifest } = await fixture(Math.floor(now.getTime() / 1000) + 3_600);

    const verified = await verifyOfflineCredential(credential, manifest, now);

    expect(verified.claims).toMatchObject({ evt: 91, ten: 7, ver: 3, aud: 'event-checkin' });
    expect(verified.hash).toHaveLength(64);
    expect(verified.fingerprint).toHaveLength(16);
  });

  it('fails closed for a tampered, expired, or wrong-event credential', async () => {
    const now = new Date('2026-07-12T09:00:00Z');
    const nowSeconds = Math.floor(now.getTime() / 1000);
    const valid = await fixture(nowSeconds + 3_600);
    const expired = await fixture(nowSeconds - 1);
    const [claimsPart, signaturePart] = valid.credential.slice(5).split('.');
    const tamperedSignature = `${signaturePart?.startsWith('A') ? 'B' : 'A'}${signaturePart?.slice(1) ?? ''}`;

    await expect(verifyOfflineCredential(`nqx2_${claimsPart}.${tamperedSignature}`, valid.manifest, now))
      .rejects.toThrow('credential_signature_invalid');
    await expect(verifyOfflineCredential(expired.credential, expired.manifest, now))
      .rejects.toThrow('credential_expired');
    await expect(verifyOfflineCredential(valid.credential, { ...valid.manifest, event_id: 92 }, now))
      .rejects.toThrow('credential_invalid');
  });

  it('enforces entry, exit, no-show, and undo ordering while ignoring terminal failures', () => {
    expect(deriveOfflineTransition(null, [], 'check_in')).toBe('checked_in');
    expect(deriveOfflineTransition(null, [{ operation: 'check_in', state: 'pending' }], 'check_out'))
      .toBe('checked_out');
    expect(deriveOfflineTransition(null, [{ operation: 'check_in', state: 'rejected' }], 'no_show'))
      .toBe('no_show');
    expect(deriveOfflineTransition('checked_in', [], 'undo')).toBe('not_checked_in');
    expect(() => deriveOfflineTransition('checked_out', [], 'check_in')).toThrow('transition_invalid');
  });
});

describe('offlineDecisionMessage (E-102)', () => {
  it('turns a known server decision into a translation key', () => {
    expect(offlineDecisionMessage('credential_rotated')).toEqual({ key: 'queue.decisions.credential_rotated' });
    expect(offlineDecisionMessage('attendance_applied')).toEqual({ key: 'queue.decisions.attendance_applied' });
  });

  it('reads both replay conflicts as already recorded', () => {
    expect(offlineDecisionMessage('event_attendance_idempotency_conflict')).toEqual({ key: 'queue.decisions.already_recorded' });
    expect(offlineDecisionMessage('event_attendance_history_conflict')).toEqual({ key: 'queue.decisions.already_recorded' });
  });

  it('falls back to a generic message that still carries the reference', () => {
    expect(offlineDecisionMessage('something_new')).toEqual({ key: 'queue.decisions.unknown', params: { code: 'something_new' } });
  });
});
