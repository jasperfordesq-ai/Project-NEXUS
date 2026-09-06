// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The offline check-in decision path: credential verification, the attendance
 * state machine, and the sync retry.
 *
 * Why this file exists separately from `eventOfflineCheckinStore.test.ts`: that
 * suite proves the roster is encrypted at rest. This one proves the decisions made
 * about it are right. They are different risks and they fail differently.
 *
 * What is at stake here is not a cosmetic bug. A steward stands at a hall door with
 * no signal and scans people in; attendance drives time credits. A check-in this
 * code drops is unpaid work, and a check-in it applies twice is credit nobody
 * earned. Every branch below is one of those two outcomes.
 *
 * 🔴 The Ed25519 signatures in these tests are REAL — generated with tweetnacl,
 * which is not mocked. Mocking `nacl.sign.detached.verify` would have made the
 * forgery test pass while verifying nothing, which is precisely the failure this
 * file is supposed to catch.
 */

/**
 * A deterministic stand-in for SHA-256. Real SHA-256 is not what the store needs
 * from `digestStringAsync` — it needs a digest that is stable for one input and
 * DIFFERENT for different inputs, because the digest is used as a credential's
 * identity. The constant-value mock in the sibling suite would make every
 * credential look like the same credential, so `credential_copied` would fire on
 * the second person scanned and the tests would encode that as correct.
 *
 * Named with a `mock` prefix so Babel permits the reference inside `jest.mock`.
 */
function mockSha256Hex(value: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  let c = 0xdeadbeef;
  let d = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    a = Math.imul(a ^ code, 16777619) >>> 0;
    b = Math.imul(b + code, 2654435761) >>> 0;
    c = Math.imul(c ^ (code + index), 40503) >>> 0;
    d = (d + Math.imul(code + 1, 2246822519)) >>> 0;
  }
  const word = (value32: number) => value32.toString(16).padStart(8, '0');
  return `${word(a)}${word(b)}${word(c)}${word(d)}`.repeat(2).slice(0, 64);
}

const mockStorageMap = new Map<string, string>();
const mockFiles = new Map<string, string>();
const mockSyncBatch = jest.fn();
let mockUuidCounter = 0;

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///documents/',
  EncodingType: { UTF8: 'utf8' },
  makeDirectoryAsync: jest.fn(async () => undefined),
  writeAsStringAsync: jest.fn(async (path: string, contents: string) => {
    mockFiles.set(path, contents);
  }),
  getInfoAsync: jest.fn(async (path: string) => ({ exists: mockFiles.has(path) })),
  readAsStringAsync: jest.fn(async (path: string) => mockFiles.get(path) ?? ''),
  deleteAsync: jest.fn(async (path: string) => {
    mockFiles.delete(path);
  }),
}));

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { HEX: 'hex' },
  getRandomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => (index * 7 + 11) % 256),
  // Distinct per call: the queue keys items by clientNonce, so a constant UUID
  // would silently collapse every queued operation into one.
  randomUUID: () => {
    mockUuidCounter += 1;
    return `00000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  },
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => mockSha256Hex(value)),
}));

jest.mock('@/lib/api/eventOfflineCheckin', () => ({
  syncOfflineCheckinBatch: (...args: unknown[]) => mockSyncBatch(...args),
}));

jest.mock('@/lib/storage', () => ({
  storage: {
    get: jest.fn(async (key: string) => mockStorageMap.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      mockStorageMap.set(key, value);
    }),
    remove: jest.fn(async (key: string) => {
      mockStorageMap.delete(key);
    }),
    getJson: jest.fn(async (key: string) => {
      const value = mockStorageMap.get(key);
      return value ? JSON.parse(value) : null;
    }),
    setJson: jest.fn(async (key: string, value: unknown) => {
      mockStorageMap.set(key, JSON.stringify(value));
    }),
  },
}));

import nacl from 'tweetnacl';

import {
  activateMobileOfflineSession,
  enqueueMobileOfflineCredential,
  loadMobileOfflineSession,
  loadMobileOfflineSessionForReview,
  refreshMobileOfflineManifest,
  sealMobileOfflinePayload,
  syncMobileOfflineSession,
  verifyMobileOfflineCredential,
  type MobileOfflineSession,
} from '@/lib/eventOfflineCheckinStore';
import type {
  MobileOfflineBatch,
  MobileOfflineManifest,
  OfflineAttendanceOperation,
} from '@/lib/api/eventOfflineCheckin';

const TENANT_ID = 7;
const EVENT_ID = 91;
const DEVICE_ID = 22;
const OCCURRENCE_KEY = 'event:91:occurrence:2026-09-01T18:00:00Z';
const KID = '0123456789abcdef';

/** Base64url with no padding — the only form `decodeBase64Url` accepts. */
function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const signingKeys = nacl.sign.keyPair();
const otherSigningKeys = nacl.sign.keyPair();

interface ClaimOverrides {
  [claim: string]: unknown;
}

/**
 * Issues a genuinely signed `nqx2_` credential, exactly as the server would, and
 * returns the digest the manifest has to record for it.
 */
function issueCredential(
  overrides: ClaimOverrides = {},
  keyPair: nacl.SignKeyPair = signingKeys,
): { credential: string; hash: string; fingerprint: string } {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const claims = {
    alg: 'Ed25519',
    aud: 'event-checkin',
    evt: EVENT_ID,
    exp: nowSeconds + 3600,
    iat: nowSeconds - 10,
    jti: 'credential-jti-1',
    kid: KID,
    occ: mockSha256Hex(OCCURRENCE_KEY),
    ten: TENANT_ID,
    v: 2,
    ver: 1,
    ...overrides,
  };
  const claimsPart = base64Url(new TextEncoder().encode(JSON.stringify(claims)));
  const signature = nacl.sign.detached(new TextEncoder().encode(claimsPart), keyPair.secretKey);
  const credential = `nqx2_${claimsPart}.${base64Url(signature)}`;
  const hash = mockSha256Hex(credential);
  return { credential, hash, fingerprint: hash.slice(0, 16) };
}

interface RegistrationSeed {
  registrationId?: number;
  userId?: number;
  displayName?: string;
  credentialVersion?: number;
  attendanceStatus?: string | null;
  attendanceVersion?: number;
  credential: { hash: string; fingerprint: string };
}

function registration(seed: RegistrationSeed) {
  return {
    registration_id: seed.registrationId ?? 44,
    user_id: seed.userId ?? 55,
    display_name: seed.displayName ?? 'Aoife Ní Bhriain',
    credential_version: seed.credentialVersion ?? 1,
    credential_fingerprint: seed.credential.fingerprint,
    credential_verifier: seed.credential.hash,
    attendance_status: seed.attendanceStatus ?? 'not_checked_in',
    attendance_version: seed.attendanceVersion ?? 0,
  };
}

function manifest(registrations: ReturnType<typeof registration>[] = []): MobileOfflineManifest {
  return {
    schema_version: 2,
    tenant_id: TENANT_ID,
    event_id: EVENT_ID,
    occurrence_key: OCCURRENCE_KEY,
    manifest_version: 3,
    device: { id: DEVICE_ID, version: 1 },
    generated_at: '2026-09-01T08:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    credential_verification: {
      format: 'nqx2',
      algorithm: 'Ed25519',
      keys: [{ kid: KID, alg: 'Ed25519', public_key: base64Url(signingKeys.publicKey) }],
    },
    registrations,
    privacy: { credential_contains_pii: false, encrypted_at_rest_required: true },
  } as MobileOfflineManifest;
}

function session(overrides: Partial<MobileOfflineSession> = {}): MobileOfflineSession {
  return {
    eventId: EVENT_ID,
    deviceId: DEVICE_ID,
    deviceVersion: 1,
    deviceSecret: 'nxd1_device-secret',
    replayWindowMinutes: 1_440,
    batchMaxItems: 500,
    manifest: manifest(),
    queue: [],
    activeBatchId: null,
    activeBatchNonces: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function batchResponse(
  items: { client_nonce: string; state: string; code?: string | null; decision_version?: number | null }[],
): MobileOfflineBatch {
  return {
    items: items.map((item) => ({
      client_nonce: item.client_nonce,
      state: item.state,
      code: item.code ?? null,
      decision_version: item.decision_version ?? 1,
    })),
  } as unknown as MobileOfflineBatch;
}

beforeEach(() => {
  mockStorageMap.clear();
  mockFiles.clear();
  mockSyncBatch.mockReset();
  mockUuidCounter = 0;
});

describe('verifying a scanned credential', () => {
  it('accepts one the event actually issued, and reports its digest', async () => {
    const issued = issueCredential();

    const verified = await verifyMobileOfflineCredential(issued.credential, manifest());

    expect(verified.hash).toBe(issued.hash);
    expect(verified.fingerprint).toBe(issued.hash.slice(0, 16));
    expect(verified.claims.evt).toBe(EVENT_ID);
  });

  it('REJECTS a credential signed by anything other than the event key', async () => {
    // The forgery case, and the reason this file signs for real. Someone who can
    // read a valid credential can read its claims; what they must not be able to do
    // is mint a new one. If this ever passes, anyone can check anyone in.
    const forged = issueCredential({}, otherSigningKeys);

    await expect(verifyMobileOfflineCredential(forged.credential, manifest()))
      .rejects.toThrow('credential_signature_invalid');
  });

  it('rejects a credential naming a signing key the manifest does not carry', async () => {
    const issued = issueCredential({ kid: 'fedcba9876543210' });

    await expect(verifyMobileOfflineCredential(issued.credential, manifest()))
      .rejects.toThrow('credential_signing_key_unknown');
  });

  it('reports an expired credential as EXPIRED, not merely invalid', async () => {
    // The distinct code matters at the door: "this pass has expired" is something a
    // steward can act on, and "invalid" sends them hunting for a fault that is not
    // there.
    const nowSeconds = Math.floor(Date.now() / 1000);
    const issued = issueCredential({ exp: nowSeconds - 1, iat: nowSeconds - 3600 });

    await expect(verifyMobileOfflineCredential(issued.credential, manifest()))
      .rejects.toThrow('credential_expired');
  });

  it('rejects a valid credential belonging to a DIFFERENT occurrence of the event', async () => {
    // A recurring event issues a pass per occurrence. Last week's pass is correctly
    // signed, unexpired and for the right event — the occurrence digest is the only
    // thing standing between it and a check-in at tonight's session.
    const issued = issueCredential({ occ: mockSha256Hex('event:91:occurrence:2026-08-25T18:00:00Z') });

    await expect(verifyMobileOfflineCredential(issued.credential, manifest()))
      .rejects.toThrow('credential_wrong_event');
  });

  it('rejects a credential issued by another community', async () => {
    const issued = issueCredential({ ten: TENANT_ID + 1 });

    await expect(verifyMobileOfflineCredential(issued.credential, manifest()))
      .rejects.toThrow('credential_invalid');
  });

  it('rejects a credential carrying any claim the format does not define', async () => {
    // The claim set is an allowlist. An unrecognised claim means either a format the
    // client does not understand or an attempt to smuggle something past it; both
    // are refusals.
    const issued = issueCredential({ role: 'admin' });

    await expect(verifyMobileOfflineCredential(issued.credential, manifest()))
      .rejects.toThrow('credential_invalid');
  });

  it.each([
    ['an unrecognised prefix', 'nqx1_abc.def'],
    ['no signature part', `nqx2_${Buffer.from('{}').toString('base64url')}`],
    ['an empty payload', 'nqx2_.'],
    ['arbitrary scanned text', 'https://example.com/not-a-credential'],
  ])('rejects %s without throwing anything other than credential_invalid', async (_label, value) => {
    // A barcode scanner will happily read a bus ticket. None of this may crash the
    // check-in screen.
    await expect(verifyMobileOfflineCredential(value, manifest()))
      .rejects.toThrow('credential_invalid');
  });
});

describe('queueing an attendance change while offline', () => {
  it('queues a check-in for a member who has not arrived yet', async () => {
    const issued = issueCredential();
    const active = session({ manifest: manifest([registration({ credential: issued })]) });

    const next = await enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null);

    expect(next.queue).toHaveLength(1);
    expect(next.queue[0]).toMatchObject({
      registrationId: 44,
      operation: 'check_in',
      state: 'pending',
      expectedAttendanceVersion: 0,
    });
  });

  it('REFUSES a second check-in for someone already queued as checked in', async () => {
    // The double-scan. A steward scanning the same person twice must not produce two
    // check-ins, because the server applies both and the member is credited twice.
    const issued = issueCredential();
    const other = issueCredential({ jti: 'credential-jti-2' });
    const active = session({ manifest: manifest([registration({ credential: issued })]) });

    const afterFirst = await enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null);
    // A different credential for the same registration, so this is the state machine
    // refusing, not the copied-credential guard.
    afterFirst.manifest.registrations[0]!.credential_verifier = other.hash;
    afterFirst.manifest.registrations[0]!.credential_fingerprint = other.fingerprint;

    await expect(enqueueMobileOfflineCredential(afterFirst, other.credential, 'check_in', null))
      .rejects.toThrow('transition_invalid');
  });

  it('refuses a check-out for someone who never checked in', async () => {
    const issued = issueCredential();
    const active = session({ manifest: manifest([registration({ credential: issued })]) });

    await expect(enqueueMobileOfflineCredential(active, issued.credential, 'check_out', null))
      .rejects.toThrow('transition_invalid');
  });

  it('accepts a check-out once the check-in is queued, and advances the expected version', async () => {
    // Optimistic concurrency: each queued operation claims the next attendance
    // version. If this count is wrong the server rejects the whole batch as
    // conflicted, and a hall full of check-ins has to be entered by hand.
    const first = issueCredential();
    const second = issueCredential({ jti: 'credential-jti-2' });
    const active = session({ manifest: manifest([registration({ credential: first })]) });

    const afterCheckIn = await enqueueMobileOfflineCredential(active, first.credential, 'check_in', null);
    afterCheckIn.manifest.registrations[0]!.credential_verifier = second.hash;
    afterCheckIn.manifest.registrations[0]!.credential_fingerprint = second.fingerprint;
    const afterCheckOut = await enqueueMobileOfflineCredential(afterCheckIn, second.credential, 'check_out', null);

    expect(afterCheckOut.queue.map((item) => item.operation)).toEqual(['check_in', 'check_out']);
    expect(afterCheckOut.queue.map((item) => item.expectedAttendanceVersion)).toEqual([0, 1]);
  });

  it('refuses the SAME credential presented twice for the same operation', async () => {
    // Distinct from the state machine above: this is a photographed or forwarded
    // pass being scanned again while the first scan is still unsent.
    const issued = issueCredential();
    const active = session({ manifest: manifest([registration({ credential: issued })]) });

    const afterFirst = await enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null);

    await expect(enqueueMobileOfflineCredential(afterFirst, issued.credential, 'check_in', null))
      .rejects.toThrow('credential_copied');
  });

  it('refuses a credential whose version the roster has moved past', async () => {
    // The member re-issued their pass after the manifest was downloaded. The old one
    // verifies perfectly and must still be refused.
    const issued = issueCredential({ ver: 1 });
    const active = session({
      manifest: manifest([registration({ credential: issued, credentialVersion: 2 })]),
    });

    await expect(enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null))
      .rejects.toThrow('credential_revoked_or_rotated');
  });

  it('refuses a credential for nobody on the roster', async () => {
    const issued = issueCredential();
    const stranger = issueCredential({ jti: 'credential-jti-stranger' });
    const active = session({ manifest: manifest([registration({ credential: issued })]) });

    await expect(enqueueMobileOfflineCredential(active, stranger.credential, 'check_in', null))
      .rejects.toThrow('credential_revoked_or_rotated');
  });

  it('requires a written reason before undoing an attendance decision', async () => {
    // An undo overwrites a record a member can see. It is the one operation that
    // demands an explanation, and whitespace is not one.
    const issued = issueCredential();
    const active = session({
      manifest: manifest([registration({ credential: issued, attendanceStatus: 'checked_in' })]),
    });

    await expect(enqueueMobileOfflineCredential(active, issued.credential, 'undo', '   '))
      .rejects.toThrow('reason_required');

    const undone = await enqueueMobileOfflineCredential(active, issued.credential, 'undo', '  scanned in error  ');
    expect(undone.queue[0]?.reason).toBe('scanned in error');
  });

  it('starts from the attendance status the roster already recorded', async () => {
    // Someone checked in on another device before the manifest was downloaded. A
    // check-in here would be a duplicate; a check-out is the valid move.
    const issued = issueCredential();
    const active = session({
      manifest: manifest([registration({ credential: issued, attendanceStatus: 'checked_in', attendanceVersion: 4 })]),
    });

    await expect(enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null))
      .rejects.toThrow('transition_invalid');

    const out = await enqueueMobileOfflineCredential(active, issued.credential, 'check_out', null);
    expect(out.queue[0]?.expectedAttendanceVersion).toBe(4);
  });

  it('stores the queue encrypted, with no member name in the written file', async () => {
    const issued = issueCredential();
    const active = session({
      manifest: manifest([registration({ credential: issued, displayName: 'Aoife Ní Bhriain' })]),
    });

    await enqueueMobileOfflineCredential(active, issued.credential, 'check_in', null);

    const written = [...mockFiles.values()].join('');
    expect(written).not.toContain('Aoife');
    expect(written).not.toContain('nxd1_device-secret');
  });
});

describe('syncing the queue when signal comes back', () => {
  async function queuedSession(): Promise<{ active: MobileOfflineSession; nonce: string }> {
    const issued = issueCredential();
    const active = await enqueueMobileOfflineCredential(
      session({ manifest: manifest([registration({ credential: issued })]) }),
      issued.credential,
      'check_in',
      null,
    );
    return { active, nonce: active.queue[0]!.clientNonce };
  }

  it('applies the server decision to the matching queued item', async () => {
    const { active, nonce } = await queuedSession();
    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: nonce, state: 'synced', decision_version: 1 }]));

    const { session: after } = await syncMobileOfflineSession(active);

    expect(after.queue[0]).toMatchObject({ state: 'synced', decisionVersion: 1, code: null });
    expect(after.activeBatchId).toBeNull();
  });

  it('records a conflict rather than dropping the item', async () => {
    // A conflict is a decision a human has to resolve, so it must survive in the
    // queue. Discarding it loses the fact that someone was at the door.
    const { active, nonce } = await queuedSession();
    mockSyncBatch.mockResolvedValue(batchResponse([
      { client_nonce: nonce, state: 'conflict', code: 'attendance_version_stale' },
    ]));

    const { session: after } = await syncMobileOfflineSession(active);

    expect(after.queue[0]).toMatchObject({ state: 'conflict', code: 'attendance_version_stale' });
  });

  it('🔴 keeps the SAME batch id after a network failure, so a retry cannot double-apply', async () => {
    // This is the most consequential branch in the file. The send may well have
    // reached the server and only the response been lost. Retrying under a fresh
    // batch id would present the same check-ins as new work, and the server's
    // idempotency key would not match. Everyone scanned gets credited twice.
    const { active, nonce } = await queuedSession();
    mockSyncBatch.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(syncMobileOfflineSession(active)).rejects.toThrow('Network request failed');

    const stored = await loadMobileOfflineSession(EVENT_ID, DEVICE_ID);
    expect(stored?.activeBatchId).toMatch(/^mobile-/);
    expect(stored?.activeBatchNonces).toEqual([nonce]);
    expect(stored?.queue[0]?.state).toBe('pending');

    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: nonce, state: 'synced' }]));
    await syncMobileOfflineSession(stored!);

    const firstBatchId = mockSyncBatch.mock.calls[0]?.[1]?.clientBatchId;
    const retryBatchId = mockSyncBatch.mock.calls[1]?.[1]?.clientBatchId;
    expect(retryBatchId).toBe(firstBatchId);
  });

  it('retries exactly the items the failed batch held, not anything queued since', async () => {
    // Adding the new scan to the in-flight batch would change the batch's contents
    // under a batch id the server may already have accepted.
    const first = issueCredential();
    const second = issueCredential({ jti: 'credential-jti-2' });
    const active = await enqueueMobileOfflineCredential(
      session({ manifest: manifest([registration({ credential: first })]) }),
      first.credential,
      'check_in',
      null,
    );
    const firstNonce = active.queue[0]!.clientNonce;

    mockSyncBatch.mockRejectedValueOnce(new Error('Network request failed'));
    await expect(syncMobileOfflineSession(active)).rejects.toThrow('Network request failed');
    const stalled = (await loadMobileOfflineSession(EVENT_ID, DEVICE_ID))!;

    // A second person is scanned while the first batch is stuck.
    stalled.manifest.registrations.push(registration({
      registrationId: 45,
      userId: 56,
      displayName: 'Second Member',
      credential: second,
    }));
    const withSecond = await enqueueMobileOfflineCredential(stalled, second.credential, 'check_in', null);
    expect(withSecond.queue).toHaveLength(2);

    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: firstNonce, state: 'synced' }]));
    await syncMobileOfflineSession(withSecond);

    const retriedNonces = mockSyncBatch.mock.calls[1]?.[1]?.items.map((item: { client_nonce: string }) => item.client_nonce);
    expect(retriedNonces).toEqual([firstNonce]);
  });

  it('rejects a check-in locally once it is older than the replay window, and never sends it', async () => {
    // The server would refuse it anyway. Rejecting it here means the steward is told
    // while they can still act, instead of the item sitting as "pending" for ever.
    const { active, nonce } = await queuedSession();
    const stale: MobileOfflineSession = {
      ...active,
      replayWindowMinutes: 30,
      queue: [{ ...active.queue[0]!, observedAt: new Date(Date.now() - 60 * 60_000).toISOString() }],
    };

    const { session: after, batch } = await syncMobileOfflineSession(stale);

    expect(after.queue[0]).toMatchObject({ state: 'rejected', code: 'replay_window_expired' });
    expect(after.queue[0]?.clientNonce).toBe(nonce);
    expect(batch).toBeNull();
    expect(mockSyncBatch).not.toHaveBeenCalled();
  });

  it('does not call the server when there is nothing pending', async () => {
    const { active, nonce } = await queuedSession();
    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: nonce, state: 'synced' }]));
    const { session: synced } = await syncMobileOfflineSession(active);
    mockSyncBatch.mockClear();

    const { batch } = await syncMobileOfflineSession(synced);

    expect(batch).toBeNull();
    expect(mockSyncBatch).not.toHaveBeenCalled();
  });

  it('sends the manifest version it queued against, so the server can spot a stale roster', async () => {
    const { active, nonce } = await queuedSession();
    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: nonce, state: 'synced' }]));

    await syncMobileOfflineSession(active);

    expect(mockSyncBatch.mock.calls[0]?.[1]).toMatchObject({ manifestVersion: 3, deviceSecret: 'nxd1_device-secret' });
  });

  it('never sends more items in one batch than the server allows', async () => {
    const issued = issueCredential();
    let active = session({
      manifest: manifest([registration({ credential: issued })]),
      batchMaxItems: 2,
    });
    // Three queued check-ins for three people, built directly because the state
    // machine deliberately forbids three check-ins for one person.
    active = {
      ...active,
      queue: [1, 2, 3].map((index) => ({
        clientNonce: `nonce-${index}`,
        registrationId: 40 + index,
        userId: 50 + index,
        displayName: `Member ${index}`,
        operation: 'check_in' as OfflineAttendanceOperation,
        observedAt: new Date().toISOString(),
        expectedAttendanceVersion: 0,
        credentialFingerprint: issued.fingerprint,
        credentialHashReference: `${index}`.repeat(64),
        reason: null,
        state: 'pending' as const,
        code: null,
        decisionVersion: null,
      })),
    };
    mockSyncBatch.mockResolvedValue(batchResponse([{ client_nonce: 'nonce-1', state: 'synced' }]));

    await syncMobileOfflineSession(active);

    expect(mockSyncBatch.mock.calls[0]?.[1]?.items).toHaveLength(2);
  });
});

describe('reading a stored session back', () => {
  it('returns null when this device holds nothing for the event', async () => {
    expect(await loadMobileOfflineSession(EVENT_ID, DEVICE_ID)).toBeNull();
  });

  it('destroys an unreadable record rather than leaving it on the device', async () => {
    // Unreadable means tampered with, or written under a key that is now gone. Either
    // way it cannot be trusted or recovered, and it is a roster of members' names, so
    // it does not stay on disk. The throw is what tells the screen to re-download.
    const issued = issueCredential();
    await enqueueMobileOfflineCredential(
      session({ manifest: manifest([registration({ credential: issued })]) }),
      issued.credential,
      'check_in',
      null,
    );
    expect(mockFiles.size).toBe(1);
    const path = [...mockFiles.keys()][0]!;
    mockFiles.set(path, 'not an encrypted envelope');

    await expect(loadMobileOfflineSession(EVENT_ID, DEVICE_ID)).rejects.toThrow('offline_ciphertext_invalid');
    expect(mockFiles.has(path)).toBe(false);
  });

  /**
   * 🔴 S4-19. An EXPIRED roster is not an unreadable one. The store used to purge on any
   * failure in `loadMobileOfflineSession`, so a steward who scanned members offline and
   * reopened the app after the manifest lapsed found every never-synced check-in deleted,
   * silently. The record must survive, be readable for review with its pending queue
   * intact, and only ever leave the device on an explicit purge.
   */
  it('keeps an expired session and its unsynced queue on the device, readable for review', async () => {
    // Same deterministic key the store derives from the mocked getRandomBytes.
    const key = Uint8Array.from({ length: nacl.secretbox.keyLength }, (_, index) => (index * 7 + 11) % 256);
    mockStorageMap.set('nexus_event_checkin_encryption_key_v1', Buffer.from(key).toString('base64'));
    const expired = session({
      manifest: { ...manifest(), expires_at: '2000-01-01T00:00:00Z' },
      queue: [{
        clientNonce: 'nonce-1',
        registrationId: 1,
        userId: 501,
        displayName: 'Ada',
        operation: 'check_in',
        observedAt: '2026-09-01T18:05:00Z',
        expectedAttendanceVersion: 1,
        credentialFingerprint: 'abcdef0123456789',
        credentialHashReference: 'a'.repeat(64),
        reason: null,
        state: 'pending',
        code: null,
        decisionVersion: null,
      }],
    });
    const path = `file:///documents/event-offline-checkin-v1/event-${EVENT_ID}-device-${DEVICE_ID}.nqx`;
    mockFiles.set(path, sealMobileOfflinePayload(JSON.stringify(expired), key));

    const review = await loadMobileOfflineSessionForReview(EVENT_ID, DEVICE_ID);
    expect(review.inactive).toBe('manifest_expired');
    expect(review.session?.queue.filter((item) => item.state === 'pending')).toHaveLength(1);
    // The strict loader still refuses to hand out an inactive session for queueing…
    await expect(loadMobileOfflineSession(EVENT_ID, DEVICE_ID)).rejects.toThrow('manifest_expired');
    // …but neither call destroyed the record.
    expect(mockFiles.has(path)).toBe(true);
  });
});

describe('starting and refreshing a device session', () => {
  function workspace(overrides: Record<string, unknown> = {}) {
    return {
      event_id: EVENT_ID,
      manifest_version: 3,
      limits: { replay_window_minutes: 720, batch_max_items: 100 },
      devices: [{ id: DEVICE_ID, status: 'active' }],
      ...overrides,
    } as unknown as Parameters<typeof activateMobileOfflineSession>[2];
  }

  it('activates a session and takes its limits from the server, not from defaults', async () => {
    const active = await activateMobileOfflineSession('nxd1_device-secret', manifest(), workspace());

    expect(active).toMatchObject({
      eventId: EVENT_ID,
      deviceId: DEVICE_ID,
      replayWindowMinutes: 720,
      batchMaxItems: 100,
      queue: [],
      activeBatchId: null,
    });
    // Written straight to disk: a session that only existed in memory would be lost
    // the moment the screen was closed, taking the roster with it.
    expect(mockFiles.size).toBe(1);
  });

  it('refuses to activate when the roster and the workspace disagree', async () => {
    // Two separate requests fetch these. If the manifest version moved between them
    // the roster is already out of date, and check-ins against it would conflict.
    await expect(activateMobileOfflineSession('nxd1_device-secret', manifest(), workspace({ manifest_version: 4 })))
      .rejects.toThrow('manifest_stale');
    expect(mockFiles.size).toBe(0);
  });

  it('takes a fresh roster for the same device', async () => {
    const active = await activateMobileOfflineSession('nxd1_device-secret', manifest(), workspace());
    const refreshedManifest = { ...manifest(), manifest_version: 5 };

    const next = await refreshMobileOfflineManifest(
      active,
      refreshedManifest,
      workspace({ manifest_version: 5, limits: { replay_window_minutes: 60, batch_max_items: 25 } }),
    );

    expect(next.manifest.manifest_version).toBe(5);
    expect(next.replayWindowMinutes).toBe(60);
    expect(next.batchMaxItems).toBe(25);
  });

  it('🔴 refuses a roster issued to a rotated device version', async () => {
    // Rotating or revoking a steward's device bumps its version. The old device may
    // still be running with a valid-looking session, and this is what stops it
    // adopting a new roster and carrying on checking people in.
    const active = await activateMobileOfflineSession('nxd1_device-secret', manifest(), workspace());
    const rotated = { ...manifest(), device: { id: DEVICE_ID, version: 2 } } as MobileOfflineManifest;

    await expect(refreshMobileOfflineManifest(active, rotated, workspace()))
      .rejects.toThrow('device_rotated');
  });

  it('refuses a roster belonging to another event entirely', async () => {
    const active = await activateMobileOfflineSession('nxd1_device-secret', manifest(), workspace());
    const wrongEvent = { ...manifest(), event_id: EVENT_ID + 1 } as MobileOfflineManifest;

    await expect(refreshMobileOfflineManifest(active, wrongEvent, workspace()))
      .rejects.toThrow('device_rotated');
  });
});
