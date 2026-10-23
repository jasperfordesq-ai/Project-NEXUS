// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';

/**
 * "Trust this device": the opaque tokens the server issues when a member ticks
 * the box at the two-factor step, kept in secure storage (Keychain/Keystore).
 *
 * One per account (community + email), so trusting a second account on this
 * phone never replaces the first. Signing out keeps them, like the website: a
 * remembered device is about the phone, not the session. The server can
 * revoke any of them, after which it is simply ignored at the next sign-in.
 */
const KEY = 'nexus_trusted_devices';
const TOKEN = /^[a-f0-9]{64}$/;
const MAX_ACCOUNTS = 10;

type Entry = { token: string; savedAt: number };
type Store = Record<string, Entry>;

export function trustedDeviceAccountKey(tenantSlug: string | null | undefined, email: string): string {
  return `${(tenantSlug ?? '').trim().toLowerCase()}|${email.trim().toLowerCase()}`;
}

async function read(): Promise<Store> {
  try {
    const parsed: unknown = JSON.parse((await storage.get(KEY)) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Store = {};
    for (const [account, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const e = entry as Partial<Entry> | null;
      if (e && typeof e.token === 'string' && TOKEN.test(e.token)) {
        out[account] = { token: e.token, savedAt: Number(e.savedAt) || 0 };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** The token this phone holds for the account, or null. */
export async function trustedDeviceTokenFor(accountKey: string): Promise<string | null> {
  return (await read())[accountKey]?.token ?? null;
}

/** Keep a newly issued token, newest accounts first, at most MAX_ACCOUNTS. */
export async function rememberTrustedDevice(accountKey: string, token: string | null | undefined): Promise<void> {
  if (!token || !TOKEN.test(token)) return;
  const store = await read();
  store[accountKey] = { token, savedAt: Date.now() };
  const kept = Object.entries(store)
    .sort(([, a], [, b]) => b.savedAt - a.savedAt)
    .slice(0, MAX_ACCOUNTS);
  try {
    await storage.set(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Not remembering is safe: the next sign-in asks for a code again.
  }
}

/** Forget this account's token (after "forget my devices" or turning 2FA off). */
export async function forgetTrustedDevice(accountKey: string): Promise<void> {
  const store = await read();
  if (!(accountKey in store)) return;
  delete store[accountKey];
  try {
    await storage.set(KEY, JSON.stringify(store));
  } catch {
    // A stale token is harmless: the server has already revoked it.
  }
}
