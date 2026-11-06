// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turning on two-factor authentication from a signed-in session, by choice.
 *
 * Until November 2026 the app could only do the FORCED set-up that happens during sign-in
 * (`beginMfaSetup` / `verifyMfa` in `./auth`, which use a `two_factor_token` challenge and
 * no session). These helpers are the other path: a member who is already signed in and
 * chooses to protect their account, from Settings or from the "Protect your account" step
 * of the welcome wizard.
 *
 * 🔴 Security finding F-170. The server refuses `setup` and `verify` from a session unless
 * they carry a FRESH security confirmation, obtained by re-entering the password at
 * `/api/webauthn/security-confirm` (valid five minutes). Never try to skip it, cache it
 * beyond the screen, or store it: it lives in the enrolment component's memory only.
 */

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface TwoFactorStatus {
  enabled: boolean;
  /** False when the community has two-factor switched off and nothing requires it. */
  enrollment_allowed: boolean;
  enforcement_required: boolean;
  setup_required: boolean;
  backup_codes_remaining: number;
}

export interface TwoFactorSetup {
  secret: string;
  /** An SVG data URI of the QR code. The app draws its own QR instead (see buildOtpAuthUri). */
  qr_code_url?: string;
}

export interface TwoFactorVerifyResult {
  backup_codes: string[];
}

/**
 * The issuer `app/Services/TotpService.php` writes into its provisioning URI
 * (`TotpService::ISSUER`). Kept identical so an account added from the phone's
 * "Open in authenticator app" button looks the same as one scanned from the website.
 */
export const TOTP_ISSUER = 'Project NEXUS';

type DataEnvelope<T> = T | { data: T };

function unwrap<T>(response: DataEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

export async function getTwoFactorStatus(): Promise<TwoFactorStatus> {
  return unwrap(await api.get<DataEnvelope<TwoFactorStatus>>(`${API_V2}/auth/2fa/status`));
}

/** Re-enter the password; returns the short-lived security confirmation token. */
export async function confirmSecurityWithPassword(currentPassword: string): Promise<string> {
  const result = unwrap(await api.post<DataEnvelope<{ security_confirmation_token?: string }>>(
    '/api/webauthn/security-confirm',
    { current_password: currentPassword },
  ));
  const token = result?.security_confirmation_token;
  if (typeof token !== 'string' || token === '') {
    throw new Error('Security confirmation missing from response');
  }
  return token;
}

export async function beginTwoFactorSetupFromSession(securityConfirmationToken: string): Promise<TwoFactorSetup> {
  return unwrap(await api.post<DataEnvelope<TwoFactorSetup>>(
    `${API_V2}/auth/2fa/setup`,
    { security_confirmation_token: securityConfirmationToken },
  ));
}

export async function verifyTwoFactorSetupFromSession(
  code: string,
  securityConfirmationToken: string,
): Promise<TwoFactorVerifyResult> {
  const result = unwrap(await api.post<DataEnvelope<Partial<TwoFactorVerifyResult>>>(
    `${API_V2}/auth/2fa/verify`,
    { code, security_confirmation_token: securityConfirmationToken },
  ));
  return { backup_codes: Array.isArray(result?.backup_codes) ? result.backup_codes : [] };
}

/**
 * The `otpauth://` link an authenticator app understands, built the way the server's
 * OTPHP library builds it: the label is `issuer:account`, percent-encoded as one path
 * segment, and the issuer is repeated as a query parameter.
 */
export function buildOtpAuthUri(secret: string, accountLabel?: string | null, issuer: string = TOTP_ISSUER): string {
  const account = accountLabel?.trim() ?? '';
  const label = account ? `${issuer}:${account}` : issuer;
  const cleanSecret = secret.replace(/\s+/g, '').toUpperCase();
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${encodeURIComponent(cleanSecret)}&issuer=${encodeURIComponent(issuer)}`;
}

/** The key in groups of four, which is how authenticator apps ask for it to be typed. */
export function formatSetupKey(secret: string): string {
  return secret.replace(/\s+/g, '').toUpperCase().replace(/(.{4})/g, '$1 ').trim();
}
