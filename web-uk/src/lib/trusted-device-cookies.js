// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// "Trust this device" for the accessible frontend.
//
// Laravel remembers a device with one cookie PER ACCOUNT
// (`__Host-nexus_td_<24 hex>`), so a browser that trusts two accounts keeps
// both. This server talks to Laravel from its own address, so it captures that
// cookie from Laravel's response, keeps it in the member's browser as its own
// signed cookie (`nexus_trusted_<24 hex>`), and hands every one back to Laravel
// at the next sign-in. Laravel picks the one that belongs to the account.
//
// Until 23 Oct 2026 there was a single `nexus_trusted_device` cookie, and a
// second account trusted in the same browser overwrote the first. It is still
// read and forwarded so devices trusted before then stay trusted.

const LARAVEL_PREFIX = '__Host-nexus_td_';
const LOCAL_PREFIX = 'nexus_trusted_';
const LEGACY_NAME = 'nexus_trusted_device';
const SUFFIX = /^[a-f0-9]{24}$/;
const VALUE = /^[A-Za-z0-9%._~+/=-]{1,4096}$/;
// A browser shared by more accounts than this is not worth forwarding for.
const MAX_FORWARDED = 20;

function setCookieLines(headers) {
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') {
    const lines = headers.getSetCookie();
    if (Array.isArray(lines) && lines.length) return lines;
  }
  const joined = typeof headers.get === 'function' ? headers.get('set-cookie') : null;
  return joined ? [joined] : [];
}

/**
 * The trusted-device cookie Laravel set on a successful two-factor sign-in, or
 * null. `name` is Laravel's own cookie name; `value` is the opaque token.
 */
function captureTrustedDeviceCookie(headers) {
  for (const line of setCookieLines(headers)) {
    const match = line.match(/(?:^|,\s*)(__Host-nexus_td_[a-f0-9]{24}|nexus_trusted_device)=([A-Za-z0-9%._~+/=-]{1,4096})(?:;|$)/);
    if (match) return { name: match[1], value: match[2] };
  }
  return null;
}

/** This server's cookie name for a captured Laravel cookie. */
function localNameFor(laravelName) {
  if (laravelName === LEGACY_NAME) return LEGACY_NAME;
  const suffix = String(laravelName || '').slice(LARAVEL_PREFIX.length);
  return laravelName.startsWith(LARAVEL_PREFIX) && SUFFIX.test(suffix) ? LOCAL_PREFIX + suffix : null;
}

function cookieOptions(days) {
  return {
    path: '/',
    httpOnly: true,
    signed: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: Math.min(365, Math.max(1, Number(days) || 30)) * 86400000
  };
}

function isTrustedName(name) {
  return name === LEGACY_NAME || (name.startsWith(LOCAL_PREFIX) && SUFFIX.test(name.slice(LOCAL_PREFIX.length)));
}

/** Keep a captured Laravel cookie in the member's browser. */
function rememberTrustedDevice(res, captured, days) {
  const localName = captured ? localNameFor(captured.name) : null;
  if (!localName || !VALUE.test(captured.value)) return false;
  res.cookie(localName, captured.value, cookieOptions(days));
  return true;
}

/** Every remembered device this browser holds, under Laravel's cookie names. */
function trustedDeviceCookiesFrom(req) {
  const signed = req?.signedCookies || {};
  const out = [];
  for (const [name, value] of Object.entries(signed)) {
    if (out.length >= MAX_FORWARDED) break;
    if (typeof value !== 'string' || !VALUE.test(value) || !isTrustedName(name)) continue;
    out.push({
      name: name === LEGACY_NAME ? LEGACY_NAME : LARAVEL_PREFIX + name.slice(LOCAL_PREFIX.length),
      value
    });
  }
  return out;
}

/** The Cookie header that hands those devices back to Laravel, or ''. */
function trustedDeviceCookieHeader(cookies) {
  return (Array.isArray(cookies) ? cookies : [])
    .filter((c) => c && typeof c.name === 'string' && typeof c.value === 'string'
      && (c.name === LEGACY_NAME || (c.name.startsWith(LARAVEL_PREFIX) && SUFFIX.test(c.name.slice(LARAVEL_PREFIX.length))))
      && VALUE.test(c.value))
    .slice(0, MAX_FORWARDED)
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

/**
 * Forget every remembered device in this browser. Laravel has already revoked
 * the account's devices; this removes the now-useless cookies. Cleared with
 * the same attributes they were set with, or a production browser keeps them.
 */
function clearTrustedDeviceCookies(req, res) {
  const names = new Set([LEGACY_NAME]);
  for (const name of Object.keys(req?.signedCookies || {})) {
    if (isTrustedName(name)) names.add(name);
  }
  for (const name of Object.keys(req?.cookies || {})) {
    if (isTrustedName(name)) names.add(name);
  }
  const options = cookieOptions(1);
  delete options.maxAge;
  for (const name of names) res.clearCookie(name, options);
}

module.exports = {
  captureTrustedDeviceCookie,
  rememberTrustedDevice,
  trustedDeviceCookiesFrom,
  trustedDeviceCookieHeader,
  clearTrustedDeviceCookies
};
