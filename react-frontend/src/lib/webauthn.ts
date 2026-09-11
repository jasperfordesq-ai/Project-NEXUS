// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WebAuthn/Biometric Authentication helpers
 *
 * Wraps @simplewebauthn/browser to work with our PHP backend.
 * The PHP API returns its own challenge format, so we map it to
 * SimpleWebAuthn's expected JSON types.
 */

import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  platformAuthenticatorIsAvailable,
  WebAuthnAbortService,
} from '@simplewebauthn/browser';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/browser';
import { api } from '@/lib/api';

// ─────────────────────────────────────────────────────────────────────────────
// Feature Detection
// ─────────────────────────────────────────────────────────────────────────────

/** Check if WebAuthn is supported at all (for login page passkey button) */
export function isWebAuthnSupported(): boolean {
  return browserSupportsWebAuthn();
}

/** Check if a platform authenticator is available (Windows Hello, Touch ID, etc.) */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  return platformAuthenticatorIsAvailable();
}

/**
 * Backwards-compatible passkey capability check.
 *
 * A platform authenticator is only one way to use a passkey. Security keys,
 * synced passkeys, and hybrid phone flows remain valid when the local device
 * has no enrolled platform authenticator, so management UI must be gated on
 * browser WebAuthn support instead.
 */
export async function isBiometricAvailable(): Promise<boolean> {
  return browserSupportsWebAuthn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface WebAuthnCredential {
  credential_id: string;
  device_name: string | null;
  authenticator_type: string | null;
  created_at: string;
  last_used_at: string | null;
  rp_id?: string | null;
  backup_eligible?: boolean | null;
  backup_state?: boolean | null;
  user_verified?: boolean | null;
  credential_discoverable?: boolean | null;
}

export interface WebAuthnStatus {
  registered: boolean;
  count: number;
  authentication_allowed?: boolean;
  enrollment_allowed?: boolean;
  current_rp_id?: string | null;
  max_credentials?: number;
  confirmation_methods?: {
    password?: boolean;
    passkey?: boolean;
    totp?: boolean;
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Error Classification
// ─────────────────────────────────────────────────────────────────────────────

/** Stable failure codes the UI can map to translated messages. */
export type WebAuthnFailureCode =
  | 'cancelled'
  | 'domain_not_allowed'
  | 'unknown'
  | 'FEATURE_DISABLED'
  | 'AUTH_WEBAUTHN_ORIGIN_NOT_ALLOWED'
  | 'AUTH_WEBAUTHN_UNAVAILABLE'
  | 'AUTH_WEBAUTHN_CHALLENGE_EXPIRED'
  | 'AUTH_WEBAUTHN_CHALLENGE_INVALID'
  | 'AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND'
  | 'AUTH_WEBAUTHN_FAILED'
  | 'SECURITY_CONFIRMATION_REQUIRED'
  | 'WEBAUTHN_CREDENTIAL_LIMIT'
  | 'WEBAUTHN_CREDENTIAL_EXISTS';

type LocalWebAuthnFailureCode = 'cancelled' | 'domain_not_allowed' | 'unknown';

/**
 * Classify a ceremony exception into a stable code.
 *
 * SimpleWebAuthn wraps DOMExceptions in a WebAuthnError carrying a structured
 * `code` (e.g. ERROR_INVALID_RP_ID when the server's RP ID isn't valid for the
 * page's domain). Duck-type on `code` rather than `instanceof` so unit-test
 * mocks of the library don't break classification.
 */
function classifyWebAuthnError(err: unknown): { code: LocalWebAuthnFailureCode; message: string } {
  const message = err instanceof Error ? err.message : '';
  const libraryCode = (err as { code?: string } | null | undefined)?.code;
  const errorName = (err as { name?: unknown } | null | undefined)?.name;

  if (libraryCode === 'ERROR_INVALID_RP_ID' || libraryCode === 'ERROR_INVALID_DOMAIN') {
    return { code: 'domain_not_allowed', message };
  }

  // Error.cause via index access — the project's TS lib target predates it.
  const cause = (err as { cause?: { name?: unknown } } | null | undefined)?.cause;
  const causeName = typeof cause?.name === 'string' ? cause.name : undefined;
  if (
    libraryCode === 'ERROR_CEREMONY_ABORTED' ||
    errorName === 'NotAllowedError' ||
    errorName === 'AbortError' ||
    causeName === 'NotAllowedError' ||
    message.includes('NotAllowedError') ||
    message.includes('cancelled') ||
    message.includes('denied')
  ) {
    return { code: 'cancelled', message };
  }

  return { code: 'unknown', message };
}

interface CeremonyOwner {
  id: symbol;
  kind: 'conditional' | 'authentication' | 'registration';
}

let activeCeremonyOwner: CeremonyOwner | null = null;

function claimCeremony(kind: CeremonyOwner['kind']): CeremonyOwner {
  const owner = { id: Symbol(kind), kind };
  activeCeremonyOwner = owner;
  return owner;
}

function releaseCeremony(owner: CeremonyOwner): void {
  if (activeCeremonyOwner?.id === owner.id) {
    activeCeremonyOwner = null;
  }
}

function cancelOwnedCeremony(owner: CeremonyOwner): void {
  if (activeCeremonyOwner?.id !== owner.id) return;
  activeCeremonyOwner = null;
  WebAuthnAbortService.cancelCeremony();
}

/** Cancel autofill without allowing its later cleanup to cancel a newer modal ceremony. */
function cancelConditionalCeremony(): void {
  if (activeCeremonyOwner?.kind !== 'conditional') return;
  activeCeremonyOwner = null;
  WebAuthnAbortService.cancelCeremony();
}

// ─────────────────────────────────────────────────────────────────────────────
// Device / Platform Detection
// ─────────────────────────────────────────────────────────────────────────────

export type DevicePlatform = 'windows' | 'mac' | 'iphone' | 'ipad' | 'android' | 'linux' | 'unknown';

export function detectPlatform(): DevicePlatform {
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone/.test(ua)) return 'iphone';
  if (/ipad/.test(ua) || (/macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/android/.test(ua)) return 'android';
  if (/windows/.test(ua)) return 'windows';
  if (/macintosh|mac os/.test(ua)) return 'mac';
  if (/linux/.test(ua)) return 'linux';
  return 'unknown';
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration (Enroll a new biometric credential)
// ─────────────────────────────────────────────────────────────────────────────

export type AuthenticatorAttachment = 'platform' | 'cross-platform' | undefined;

export async function registerBiometric(
  deviceName?: string,
  attachment?: AuthenticatorAttachment,
  securityConfirmationToken?: string,
): Promise<{ success: boolean; error?: string; errorCode?: WebAuthnFailureCode }> {
  try {
    // Registration supersedes passkey autofill before any network wait.
    cancelConditionalCeremony();

    // Step 1: Get registration challenge from server
    const challengeRes = await api.post<{
      challenge: string;
      challenge_id: string;
      rp: { name: string; id: string };
      user: { id: string; name: string; displayName: string };
      pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
      authenticatorSelection: {
        authenticatorAttachment?: string;
        userVerification?: string;
        residentKey?: string;
      };
      timeout: number;
      attestation: string;
      excludeCredentials: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
    }>('/webauthn/register-challenge', {
      ...(securityConfirmationToken ? { security_confirmation_token: securityConfirmationToken } : {}),
    });

    if (!challengeRes.success || !challengeRes.data) {
      return {
        success: false,
        error: challengeRes.error || 'Failed to get registration challenge',
        errorCode: challengeRes.code as WebAuthnFailureCode | undefined,
      };
    }

    const serverOptions = challengeRes.data;

    // Step 2: Map server response to SimpleWebAuthn format
    // Allow frontend to override authenticatorAttachment for "this device" vs "other device"
    const authSelection = {
      ...serverOptions.authenticatorSelection,
      ...(attachment ? { authenticatorAttachment: attachment } : {}),
    };

    // WebAuthn Level 3 "hints" tell the browser which UI to prioritize:
    // 'client-device' = Windows Hello / Touch ID / platform authenticator
    // 'hybrid' = phone/tablet via QR code
    // 'security-key' = USB security key
    let hints: Array<'client-device' | 'hybrid' | 'security-key'> | undefined;
    if (attachment === 'platform') {
      hints = ['client-device'];
    } else if (attachment === 'cross-platform') {
      hints = ['hybrid', 'security-key'];
    }

    const optionsJSON: PublicKeyCredentialCreationOptionsJSON = {
      challenge: serverOptions.challenge,
      rp: serverOptions.rp,
      user: serverOptions.user,
      pubKeyCredParams: serverOptions.pubKeyCredParams,
      authenticatorSelection: authSelection as PublicKeyCredentialCreationOptionsJSON['authenticatorSelection'],
      timeout: serverOptions.timeout,
      attestation: serverOptions.attestation as PublicKeyCredentialCreationOptionsJSON['attestation'],
      excludeCredentials: (serverOptions.excludeCredentials ?? []) as PublicKeyCredentialCreationOptionsJSON['excludeCredentials'],
      ...(hints ? { hints } : {}),
    };

    // Step 3: Trigger browser biometric prompt
    // NotAllowedError also means the member cancelled. Respect it and let
    // them explicitly choose another device instead of reopening the prompt.
    let credential: RegistrationResponseJSON;
    const ceremonyOwner = claimCeremony('registration');
    try {
      credential = await startRegistration({ optionsJSON });
    } finally {
      releaseCeremony(ceremonyOwner);
    }

    // Step 4: Send credential to server for verification + storage
    const verifyRes = await api.post('/webauthn/register-verify', {
      challenge_id: serverOptions.challenge_id,
      id: credential.id,
      rawId: credential.rawId,
      type: credential.type,
      response: credential.response,
      authenticatorAttachment: credential.authenticatorAttachment,
      ...(deviceName ? { device_name: deviceName } : {}),
      ...(securityConfirmationToken ? { security_confirmation_token: securityConfirmationToken } : {}),
    });

    if (!verifyRes.success) {
      return {
        success: false,
        error: verifyRes.error || 'Failed to verify registration',
        errorCode: verifyRes.code as WebAuthnFailureCode | undefined,
      };
    }

    return { success: true };
  } catch (err: unknown) {
    const { code, message } = classifyWebAuthnError(err);
    if (code === 'cancelled') {
      return { success: false, error: 'Biometric registration was cancelled.', errorCode: code };
    }
    return { success: false, error: message || 'Biometric registration failed', errorCode: code };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication (Login with biometric)
// ─────────────────────────────────────────────────────────────────────────────

export async function authenticateWithBiometric(
  _email?: string,
  abortSignal?: AbortSignal,
): Promise<{
  success: boolean;
  data?: {
    user: { id: number; first_name: string; last_name: string; email: string };
    access_token: string;
    refresh_token: string;
    expires_in: number;
    security_confirmation_token?: string;
    security_confirmation_expires_in?: number;
  };
  error?: string;
  errorCode?: WebAuthnFailureCode;
}> {
  try {
    // Cancel autofill before the challenge fetch. Ownership tokens prevent
    // stale autofill cleanup from cancelling this user-initiated request.
    cancelConditionalCeremony();
    if (abortSignal?.aborted) {
      return { success: false, errorCode: 'cancelled' };
    }

    // Step 1: Get authentication challenge from server
    // Always request a discoverable-credential ceremony. Sending an email here
    // would require the public API to reveal or pad account-bound credential
    // descriptors, which creates an account-enumeration timing surface.
    const challengeRes = await api.post<{
      challenge: string;
      challenge_id: string;
      rpId: string;
      timeout: number;
      userVerification: string;
      allowCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
    }>('/webauthn/auth-challenge', {}, { skipAuth: true });

    if (abortSignal?.aborted) {
      return { success: false, errorCode: 'cancelled' };
    }

    if (!challengeRes.success || !challengeRes.data) {
      return {
        success: false,
        error: challengeRes.error || 'Failed to get authentication challenge',
        errorCode: challengeRes.code as WebAuthnFailureCode | undefined,
      };
    }

    const serverOptions = challengeRes.data;

    // Step 2: Map to SimpleWebAuthn format
    // No hints restriction — let the browser show all available options
    // (platform authenticator, cross-device/phone, security key)
    const optionsJSON: PublicKeyCredentialRequestOptionsJSON = {
      challenge: serverOptions.challenge,
      rpId: serverOptions.rpId,
      timeout: serverOptions.timeout,
      userVerification: serverOptions.userVerification as PublicKeyCredentialRequestOptionsJSON['userVerification'],
      allowCredentials: serverOptions.allowCredentials?.map(c => ({
        id: c.id,
        type: c.type,
        ...(c.transports ? { transports: c.transports } : {}),
      })) as PublicKeyCredentialRequestOptionsJSON['allowCredentials'],
    };

    // Step 3: Trigger browser passkey prompt
    const ceremonyOwner = claimCeremony('authentication');
    const cancelOnAbort = () => cancelOwnedCeremony(ceremonyOwner);
    abortSignal?.addEventListener('abort', cancelOnAbort, { once: true });

    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await startAuthentication({ optionsJSON });
    } finally {
      releaseCeremony(ceremonyOwner);
      abortSignal?.removeEventListener('abort', cancelOnAbort);
    }

    if (abortSignal?.aborted) {
      return { success: false, errorCode: 'cancelled' };
    }

    // Step 4: Send assertion to server for verification
    const verifyRes = await api.post<{
      success: boolean;
      user: { id: number; first_name: string; last_name: string; email: string };
      access_token: string;
      refresh_token: string;
      expires_in: number;
      security_confirmation_token?: string;
      security_confirmation_expires_in?: number;
    }>('/webauthn/auth-verify', {
      challenge_id: serverOptions.challenge_id,
      id: assertion.id,
      rawId: assertion.rawId,
      type: assertion.type,
      response: assertion.response,
      authenticatorAttachment: assertion.authenticatorAttachment,
    }, { skipAuth: true });

    if (abortSignal?.aborted) {
      return { success: false, errorCode: 'cancelled' };
    }

    if (!verifyRes.success || !verifyRes.data) {
      return {
        success: false,
        error: verifyRes.error || 'Biometric authentication failed',
        errorCode: verifyRes.code as WebAuthnFailureCode | undefined,
      };
    }

    return { success: true, data: verifyRes.data };
  } catch (err: unknown) {
    const { code, message } = classifyWebAuthnError(err);
    if (code === 'cancelled') {
      return { success: false, error: 'Biometric login was cancelled.', errorCode: code };
    }
    return { success: false, error: message || 'Biometric authentication failed', errorCode: code };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Conditional Mediation (Passkey Autofill)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if conditional mediation (passkey autofill) is supported.
 * Requires: autocomplete="username webauthn" on the email/username input.
 */
export async function isConditionalMediationAvailable(): Promise<boolean> {
  if (!browserSupportsWebAuthn()) return false;
  if (typeof PublicKeyCredential === 'undefined') return false;
  if (typeof PublicKeyCredential.isConditionalMediationAvailable !== 'function') return false;
  try {
    return await PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

/**
 * Start conditional mediation — browser will show passkey suggestions
 * in the username field's autofill dropdown. Call on page load.
 *
 * Returns the auth result if a passkey is selected, or null if aborted/unavailable.
 * The caller should pass an AbortController signal to cancel when unmounting.
 */
export async function startConditionalAuthentication(
  abortSignal?: AbortSignal,
): Promise<{
  success: boolean;
  data?: {
    user: { id: number; first_name: string; last_name: string; email: string };
    access_token: string;
    refresh_token: string;
    expires_in: number;
    security_confirmation_token?: string;
    security_confirmation_expires_in?: number;
  };
  error?: string;
  errorCode?: WebAuthnFailureCode;
} | null> {
  try {
    if (abortSignal?.aborted) return null;

    // Get challenge from server (no email — discoverable credential flow)
    const challengeRes = await api.post<{
      challenge: string;
      challenge_id: string;
      rpId: string;
      timeout: number;
      userVerification: string;
      allowCredentials?: Array<{ type: 'public-key'; id: string; transports?: string[] }>;
    }>('/webauthn/auth-challenge', {}, { skipAuth: true });

    if (abortSignal?.aborted) return null;

    if (!challengeRes.success || !challengeRes.data) {
      return null;
    }

    // The caller may have unmounted while the challenge was in flight —
    // never start a credential request its AbortController can't reach.
    const serverOptions = challengeRes.data;

    const optionsJSON: PublicKeyCredentialRequestOptionsJSON = {
      challenge: serverOptions.challenge,
      rpId: serverOptions.rpId,
      timeout: serverOptions.timeout,
      userVerification: serverOptions.userVerification as PublicKeyCredentialRequestOptionsJSON['userVerification'],
      // Empty allowCredentials for discoverable credential flow
    };

    // startAuthentication doesn't accept an external signal — it registers its
    // own with the WebAuthnAbortService singleton. Bridge the caller's signal
    // to cancelCeremony() so unmount/re-render actually cancels the pending
    // navigator.credentials.get() instead of leaking it for the life of the
    // document (leaked OS-mediated requests are what popped native passkey
    // dialogs while login pages sat idle).
    cancelConditionalCeremony();
    const ceremonyOwner = claimCeremony('conditional');
    const cancelOnAbort = () => {
      cancelOwnedCeremony(ceremonyOwner);
    };
    abortSignal?.addEventListener('abort', cancelOnAbort, { once: true });

    // Start conditional authentication — this waits for user to interact
    // with the autofill dropdown
    let assertion: AuthenticationResponseJSON;
    try {
      assertion = await startAuthentication({
        optionsJSON,
        useBrowserAutofill: true,
      });
    } finally {
      releaseCeremony(ceremonyOwner);
      abortSignal?.removeEventListener('abort', cancelOnAbort);
    }

    // If we got here and the signal was aborted, bail
    if (abortSignal?.aborted) return null;

    // Verify with server
    const verifyRes = await api.post<{
      success: boolean;
      user: { id: number; first_name: string; last_name: string; email: string };
      access_token: string;
      refresh_token: string;
      expires_in: number;
      security_confirmation_token?: string;
      security_confirmation_expires_in?: number;
    }>('/webauthn/auth-verify', {
      challenge_id: serverOptions.challenge_id,
      id: assertion.id,
      rawId: assertion.rawId,
      type: assertion.type,
      response: assertion.response,
      authenticatorAttachment: assertion.authenticatorAttachment,
    }, { skipAuth: true });

    if (abortSignal?.aborted) return null;

    if (!verifyRes.success || !verifyRes.data) {
      return {
        success: false,
        error: verifyRes.error || 'Passkey authentication failed',
        errorCode: verifyRes.code as WebAuthnFailureCode | undefined,
      };
    }

    return { success: true, data: verifyRes.data };
  } catch (err: unknown) {
    // AbortError is expected when component unmounts or user navigates away
    if (err instanceof Error && err.name === 'AbortError') return null;
    const message = err instanceof Error ? err.message : '';
    if (message.includes('NotAllowedError') || message.includes('cancelled')) return null;
    // Conditional mediation failures are not user-facing errors
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Management (list / remove credentials)
// ─────────────────────────────────────────────────────────────────────────────

export async function getWebAuthnStatus(): Promise<WebAuthnStatus> {
  const res = await api.get<WebAuthnStatus>('/webauthn/status');
  if (!res.success) {
    throw new Error(res.code || res.error || 'Failed to load passkey status');
  }
  return res.data ?? { registered: false, count: 0 };
}

export async function getWebAuthnCredentials(): Promise<WebAuthnCredential[]> {
  const res = await api.get<{ credentials: WebAuthnCredential[]; count: number }>('/webauthn/credentials');
  if (!res.success) {
    throw new Error(res.code || res.error || 'Failed to load passkeys');
  }
  return res.data?.credentials ?? [];
}

export interface WebAuthnRemovalResult {
  success: boolean;
  sessionsRevoked?: boolean;
  errorCode?: string;
  error?: string;
}

export type WebAuthnSecurityConfirmationInput =
  | Record<string, never>
  | { current_password: string }
  | { totp_code: string }
  | { backup_code: string };

export interface WebAuthnSecurityConfirmationResult {
  success: boolean;
  securityConfirmationToken?: string;
  expiresIn?: number;
  errorCode?: string;
  error?: string;
}

export async function confirmWebAuthnSecurity(
  input: WebAuthnSecurityConfirmationInput = {},
): Promise<WebAuthnSecurityConfirmationResult> {
  const res = await api.post<{ security_confirmation_token: string; expires_in: number }>(
    '/webauthn/security-confirm',
    input,
  );
  return {
    success: res.success,
    securityConfirmationToken: res.data?.security_confirmation_token,
    expiresIn: res.data?.expires_in,
    errorCode: res.code,
    error: res.error,
  };
}

export async function removeWebAuthnCredential(
  credentialId: string,
  securityConfirmationToken?: string,
): Promise<WebAuthnRemovalResult> {
  const res = await api.post<{ sessions_revoked?: boolean }>('/webauthn/remove', {
    credential_id: credentialId,
    ...(securityConfirmationToken ? { security_confirmation_token: securityConfirmationToken } : {}),
  });
  return {
    success: res.success,
    ...(res.data?.sessions_revoked !== undefined ? { sessionsRevoked: res.data.sessions_revoked } : {}),
    errorCode: res.code,
    error: res.error,
  };
}

export async function renameWebAuthnCredential(
  credentialId: string,
  deviceName: string,
  securityConfirmationToken?: string,
): Promise<WebAuthnRemovalResult> {
  const res = await api.post('/webauthn/rename', {
    credential_id: credentialId,
    device_name: deviceName,
    ...(securityConfirmationToken ? { security_confirmation_token: securityConfirmationToken } : {}),
  });
  return {
    success: res.success,
    errorCode: res.code,
    error: res.error,
  };
}

export async function removeAllWebAuthnCredentials(
  securityConfirmationToken?: string,
): Promise<WebAuthnRemovalResult & { removedCount: number }> {
  const res = await api.post<{ removed_count: number; sessions_revoked?: boolean }>('/webauthn/remove-all', {
    ...(securityConfirmationToken ? { security_confirmation_token: securityConfirmationToken } : {}),
  });
  return {
    success: res.success,
    removedCount: res.data?.removed_count ?? 0,
    ...(res.data?.sessions_revoked !== undefined ? { sessionsRevoked: res.data.sessions_revoked } : {}),
    errorCode: res.code,
    error: res.error,
  };
}
