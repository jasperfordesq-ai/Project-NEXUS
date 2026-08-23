// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Journey 1.6. The load-bearing assertion in this file is the one about ENABLING: turning
 * the lock on without first passing the phone's own check would lock a member out of their
 * own session on the next start, with nothing but a reinstall to recover. Everything else
 * here is about never trapping the member.
 */

import * as LocalAuthentication from 'expo-local-authentication';

import {
  authenticate,
  biometricCapability,
  BIOMETRIC_LOCK_ENABLED_KEY,
  isBiometricLockEnabled,
  setBiometricLockEnabled,
} from './biometricLock';
import { storage } from './storage';

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  supportedAuthenticationTypesAsync: jest.fn(),
  authenticateAsync: jest.fn(),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

jest.mock('./storage', () => ({
  storage: { get: jest.fn(), set: jest.fn(), remove: jest.fn() },
}));

const auth = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;
const store = storage as jest.Mocked<typeof storage>;

function phoneWith({ hardware = true, enrolled = true, types = [1] } = {}) {
  auth.hasHardwareAsync.mockResolvedValue(hardware);
  auth.isEnrolledAsync.mockResolvedValue(enrolled);
  auth.supportedAuthenticationTypesAsync.mockResolvedValue(
    types as unknown as LocalAuthentication.AuthenticationType[],
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  store.get.mockResolvedValue(null);
});

describe('the key this preference is stored under', () => {
  it('is one expo-secure-store will actually accept', () => {
    // 🔴 SecureStore refuses anything outside [A-Za-z0-9._-] by throwing, and storage.set
    // swallows write errors — which is how offline event check-in was silently broken for
    // weeks. A colon here would fail exactly the same way.
    expect(BIOMETRIC_LOCK_ENABLED_KEY).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});

describe('biometricCapability', () => {
  it('is usable only when the phone has hardware AND something enrolled', async () => {
    phoneWith({ hardware: true, enrolled: false });
    expect((await biometricCapability()).usable).toBe(false);

    phoneWith({ hardware: false, enrolled: false });
    expect((await biometricCapability()).usable).toBe(false);

    phoneWith({ hardware: true, enrolled: true });
    expect((await biometricCapability()).usable).toBe(true);
  });

  it('names what the phone actually has, so a face-unlock phone is not told "fingerprint"', async () => {
    phoneWith({ types: [2] });
    expect((await biometricCapability()).kind).toBe('face');

    phoneWith({ types: [1] });
    expect((await biometricCapability()).kind).toBe('fingerprint');
  });

  it('reports unusable rather than throwing when the native call fails', async () => {
    auth.hasHardwareAsync.mockRejectedValue(new Error('no such module'));
    auth.isEnrolledAsync.mockResolvedValue(false);
    auth.supportedAuthenticationTypesAsync.mockResolvedValue([]);

    const capability = await biometricCapability();

    expect(capability.usable).toBe(false);
    expect(capability.kind).toBe('unknown');
  });
});

describe('turning the lock on', () => {
  it('🔴 refuses to store the preference unless the check passed first', async () => {
    phoneWith();
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' } as never);

    const result = await setBiometricLockEnabled(true, 'Unlock your account');

    expect(result).toEqual({ ok: false, reason: 'cancelled' });
    // The whole point: nothing was written, so the next app start is not locked.
    expect(store.set).not.toHaveBeenCalled();
  });

  it('stores the preference once the phone has authenticated', async () => {
    phoneWith();
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);

    const result = await setBiometricLockEnabled(true, 'Unlock your account');

    expect(result.ok).toBe(true);
    expect(store.set).toHaveBeenCalledWith(BIOMETRIC_LOCK_ENABLED_KEY, '1');
  });

  it('will not offer to lock a phone with nothing enrolled', async () => {
    phoneWith({ hardware: true, enrolled: false });

    const result = await setBiometricLockEnabled(true, 'Unlock your account');

    expect(result).toEqual({ ok: false, reason: 'not_enrolled' });
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();
  });

  it('turns off without asking for a fingerprint, because being locked out is the risk', async () => {
    const result = await setBiometricLockEnabled(false, 'Unlock your account');

    expect(result.ok).toBe(true);
    expect(auth.authenticateAsync).not.toHaveBeenCalled();
    expect(store.remove).toHaveBeenCalledWith(BIOMETRIC_LOCK_ENABLED_KEY);
  });
});

describe('reading the preference', () => {
  it('treats anything but the stored flag as off', async () => {
    store.get.mockResolvedValue(null);
    expect(await isBiometricLockEnabled()).toBe(false);

    store.get.mockResolvedValue('true');
    expect(await isBiometricLockEnabled()).toBe(false);

    store.get.mockResolvedValue('1');
    expect(await isBiometricLockEnabled()).toBe(true);
  });
});

describe('authenticate', () => {
  it('leaves the phone PIN available, so a finger that will not read is not a lockout', async () => {
    auth.authenticateAsync.mockResolvedValue({ success: true } as never);

    await authenticate('Unlock your account');

    expect(auth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  it('distinguishes a cancel, a lockout and a plain mismatch', async () => {
    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'user_cancel' } as never);
    expect((await authenticate('x')).reason).toBe('cancelled');

    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'lockout_permanent' } as never);
    expect((await authenticate('x')).reason).toBe('lockout');

    auth.authenticateAsync.mockResolvedValue({ success: false, error: 'authentication_failed' } as never);
    expect((await authenticate('x')).reason).toBe('failed');
  });

  it('reports unavailable when the native call throws', async () => {
    auth.authenticateAsync.mockRejectedValue(new Error('module missing'));

    expect(await authenticate('x')).toEqual({ ok: false, reason: 'unavailable' });
  });
});
