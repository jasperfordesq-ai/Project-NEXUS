// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Unlocking the app with a fingerprint — journey 1.6.
 *
 * 🔴 What this is, and what it deliberately is NOT. This is a lock on the session already
 * stored on this phone: the member signs in with their password once, and after that the
 * phone's own fingerprint, face or PIN is what lets the app back in. It is not a passkey
 * and it does not talk to the server.
 *
 * The website's passkey support (`react-frontend/src/lib/webauthn.ts`) is a different
 * thing — a WebAuthn credential the server verifies. Bringing that to Android needs
 * Credential Manager, a Digital Asset Links file published under the API's domain, and the
 * app's release signing certificate — and the signing keystore is still an open owner
 * decision. So the server-verified half stays recorded and unbuilt, and this half, which
 * is what members mean by "fingerprint sign-in", is built now.
 *
 * Two honest limits, both stated in the settings copy rather than hidden:
 *   - Anyone the member has enrolled on the phone can open the app. That is the phone's
 *     security model, not ours.
 *   - It protects a session that is ALREADY on the device. It cannot protect a first
 *     sign-in, and it is not a second factor for the server.
 */

import * as LocalAuthentication from 'expo-local-authentication';

import { storage } from '@/lib/storage';

/**
 * 🔴 Underscores, no colons. `expo-secure-store` REFUSES a key outside
 * `[A-Za-z0-9._-]` by throwing, and `storage.set` swallows write errors by design — which
 * is exactly how offline event check-in was broken for weeks. `lib/secureStoreKeys.test.ts`
 * scans for this, and only sees keys declared as constants like this one.
 */
export const BIOMETRIC_LOCK_ENABLED_KEY = 'nexus_biometric_lock_enabled_v1';

export type BiometricKind = 'fingerprint' | 'face' | 'iris' | 'passcode' | 'unknown';

export interface BiometricCapability {
  /** The phone has the hardware and something is enrolled — the only case worth offering. */
  usable: boolean;
  hasHardware: boolean;
  isEnrolled: boolean;
  /** What to call it in the interface, so a face-unlock phone is not told "fingerprint". */
  kind: BiometricKind;
}

const UNUSABLE: BiometricCapability = {
  usable: false,
  hasHardware: false,
  isEnrolled: false,
  kind: 'unknown',
};

function kindFrom(types: LocalAuthentication.AuthenticationType[]): BiometricKind {
  if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'face';
  if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
  if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
  return 'unknown';
}

/**
 * What this phone can actually do. Every call is wrapped: these are native calls, and a
 * phone with no biometric hardware, a work profile policy, or an OEM that answers oddly
 * must leave the member with the app working and the option simply absent.
 */
export async function biometricCapability(): Promise<BiometricCapability> {
  try {
    const [hasHardware, isEnrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    return {
      usable: hasHardware && isEnrolled,
      hasHardware,
      isEnrolled,
      kind: hasHardware ? kindFrom(types ?? []) : 'unknown',
    };
  } catch {
    return UNUSABLE;
  }
}

/** Has the member turned this on? Absent, unreadable or anything but "1" means no. */
export async function isBiometricLockEnabled(): Promise<boolean> {
  return (await storage.get(BIOMETRIC_LOCK_ENABLED_KEY)) === '1';
}

/**
 * Turn the lock on or off.
 *
 * 🔴 Turning it ON requires passing the check first, and that ordering is the whole
 * safety of the feature: enabling it without proving the phone can authenticate would
 * lock the member out of their own session on the next start. The caller cannot skip this
 * because the check happens here, not in the screen.
 */
export async function setBiometricLockEnabled(
  enabled: boolean,
  promptMessage: string,
): Promise<{ ok: boolean; reason?: BiometricFailure }> {
  if (!enabled) {
    await storage.remove(BIOMETRIC_LOCK_ENABLED_KEY);
    return { ok: true };
  }

  const capability = await biometricCapability();
  if (!capability.usable) {
    return { ok: false, reason: capability.hasHardware ? 'not_enrolled' : 'no_hardware' };
  }

  const result = await authenticate(promptMessage);
  if (!result.ok) return result;

  await storage.set(BIOMETRIC_LOCK_ENABLED_KEY, '1');
  return { ok: true };
}

export type BiometricFailure =
  | 'no_hardware'
  | 'not_enrolled'
  | 'cancelled'
  | 'lockout'
  | 'failed'
  | 'unavailable';

function failureFrom(error: string | undefined): BiometricFailure {
  switch (error) {
    case 'user_cancel':
    case 'app_cancel':
    case 'system_cancel':
      return 'cancelled';
    case 'lockout':
    case 'lockout_permanent':
      return 'lockout';
    case 'not_enrolled':
      return 'not_enrolled';
    case 'not_available':
    case 'no_hardware':
      return 'no_hardware';
    default:
      return 'failed';
  }
}

/**
 * Ask the phone to prove it is the member.
 *
 * `disableDeviceFallback` is deliberately false: a member whose finger will not read on a
 * cold morning must still be able to use their PIN rather than be shut out of their own
 * account. `cancelLabel` is not set, so the platform's own wording is used and stays
 * translated by the phone.
 */
export async function authenticate(
  promptMessage: string,
): Promise<{ ok: boolean; reason?: BiometricFailure }> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: false,
    });
    if (result.success) return { ok: true };
    return { ok: false, reason: failureFrom((result as { error?: string }).error) };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}
