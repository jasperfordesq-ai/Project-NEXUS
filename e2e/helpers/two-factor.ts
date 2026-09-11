// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { APIRequestContext } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { totpCode } from './totp';

/**
 * Turn a two-factor login answer into a completed login.
 *
 * Since the MFA baseline (security register E-004) an administrator cannot
 * receive a credential from the password step alone. `/api/auth/login` answers
 * one of three ways for such an account:
 *
 *   - tokens straight away          → returned unchanged;
 *   - `requires_2fa_setup`           → the account has no second factor yet (a
 *     fresh CI database). Complete the enrolment the way the React setup page
 *     does: POST /v2/auth/2fa/setup → compute the code from the returned secret
 *     → POST /v2/auth/2fa/verify. The completion body carries the tokens under
 *     `data`. The secret is remembered (see below) so later logins in the same
 *     run can answer the challenge;
 *   - `requires_2fa`                 → the account is enrolled. Answer
 *     POST /totp/verify with a code from the remembered secret. The body
 *     carries the tokens at the top level, like a plain login.
 *
 * Secrets live in `e2e/fixtures/.auth/totp-secrets.json` (that directory is
 * gitignored and already holds the storage-state files), keyed by e-mail.
 * `E2E_ADMIN_TOTP_SECRET` is honoured as a fallback for a persistent local
 * database whose administrator was enrolled elsewhere.
 *
 * A code is single-use per 30-second step on the server. When two workers
 * answer the same challenge step at once the second is refused, so a refused
 * code is retried once the step has rolled over (three attempts, well inside
 * the five the challenge allows).
 */

export interface TwoFactorLoginContext {
  request: APIRequestContext;
  apiBaseUrl: string;
  tenantSlug: string;
  email: string;
}

const SECRETS_FILE = path.join(__dirname, '..', 'fixtures', '.auth', 'totp-secrets.json');

function readSecrets(): Record<string, string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(SECRETS_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function rememberTotpSecret(email: string, secret: string): void {
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  const secrets = readSecrets();
  secrets[email.toLowerCase()] = secret;
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(secrets, null, 2));
}

export function recallTotpSecret(email: string): string {
  return readSecrets()[email.toLowerCase()] || process.env.E2E_ADMIN_TOTP_SECRET || '';
}

async function untilNextStep(): Promise<void> {
  const period = 30_000;
  const wait = period - (Date.now() % period) + 1_000;
  await new Promise((resolve) => setTimeout(resolve, wait));
}

export async function completeTwoFactorIfChallenged(loginData: any, ctx: TwoFactorLoginContext): Promise<any> {
  const challenge = typeof loginData?.two_factor_token === 'string' ? loginData.two_factor_token : '';
  if (challenge === '') {
    return loginData;
  }
  const headers = { 'Content-Type': 'application/json', 'X-Tenant-Slug': ctx.tenantSlug };

  if (loginData?.requires_2fa_setup === true) {
    const setup = await ctx.request.post(`${ctx.apiBaseUrl}/api/v2/auth/2fa/setup`, {
      data: { two_factor_token: challenge },
      headers,
    });
    const setupBody = await setup.json();
    const secret = setupBody?.data?.secret;
    if (!setup.ok() || typeof secret !== 'string' || secret === '') {
      throw new Error(`Two-factor setup failed for ${ctx.email} (${setup.status()}): ${JSON.stringify(setupBody)}`);
    }
    const verify = await ctx.request.post(`${ctx.apiBaseUrl}/api/v2/auth/2fa/verify`, {
      data: { two_factor_token: challenge, code: totpCode(secret) },
      headers,
    });
    const verifyBody = await verify.json();
    if (!verify.ok() || verifyBody?.data?.login_complete !== true) {
      throw new Error(`Two-factor enrolment failed for ${ctx.email} (${verify.status()}): ${JSON.stringify(verifyBody)}`);
    }
    rememberTotpSecret(ctx.email, secret);
    return verifyBody;
  }

  if (loginData?.requires_2fa === true) {
    const secret = recallTotpSecret(ctx.email);
    if (secret === '') {
      throw new Error(
        `Login for ${ctx.email} asked for a two-factor code but no secret is known for that account. ` +
          'It was enrolled outside this run: export E2E_ADMIN_TOTP_SECRET or reset its second factor.'
      );
    }
    let lastBody: any = null;
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const verify = await ctx.request.post(`${ctx.apiBaseUrl}/api/totp/verify`, {
        data: { two_factor_token: challenge, code: totpCode(secret) },
        headers,
      });
      lastBody = await verify.json();
      lastStatus = verify.status();
      if (verify.ok() && lastBody?.success === true) {
        return lastBody;
      }
      const code = lastBody?.code ?? lastBody?.errors?.[0]?.code;
      if (code !== 'AUTH_2FA_INVALID' || attempt === 3) {
        break;
      }
      // Most likely another worker spent this step's code; try the next step.
      await untilNextStep();
    }
    throw new Error(`Two-factor challenge failed for ${ctx.email} (${lastStatus}): ${JSON.stringify(lastBody)}`);
  }

  return loginData;
}
