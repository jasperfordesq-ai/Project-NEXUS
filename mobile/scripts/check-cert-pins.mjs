// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-cert-pins.mjs — do the pins in the Android config still match the LIVE chain?
 *
 * 🔴 Why this exists. On 2026-08-20 the pinned leaf certificate was found to match
 * nothing in the live chain: it had rotated (90-day certificate) roughly five weeks
 * earlier, while the config still said "Pins last verified: 2026-07-14". Nothing
 * noticed, because nothing checked.
 *
 * What the existing gates do and do not cover:
 *
 *   verify:network-security  — that pinning EXISTS and cleartext is refused. It does
 *                              not know what the pins should be.
 *   verify:release           — that the pin-set expiry is more than 90 days away. It
 *                              does not know whether the pins are correct.
 *
 * So a pin could be stale, or plain wrong, for months with every gate green. The app
 * survived only because Android trusts a chain when ANY certificate in it matches ANY
 * pin, and the intermediate backup carried it alone.
 *
 * 🔴 Deliberately NOT in the blocking CI path. It makes a real TLS connection to
 * production, so in CI it would fail on a network blip and teach everyone to ignore a
 * red gate — the opposite of useful. Run it by hand after a certificate change, and
 * from the nightly sweep where a transient failure is visible without blocking a
 * release.
 *
 * Usage:
 *   node scripts/check-cert-pins.mjs
 *   node scripts/check-cert-pins.mjs --host api.project-nexus.ie
 *
 * Exit codes: 0 pins match · 1 no pin matches (the app would be BRICKED) · 2 could
 * not check (network, openssl) — never reported as a pass.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const CONFIG = path.join(MOBILE_ROOT, 'android-network-security-config.xml');

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const host = flag('host', 'api.project-nexus.ie');
const port = flag('port', '443');

/** Pins declared in the Android config. */
function declaredPins() {
  const text = fs.readFileSync(CONFIG, 'utf8');
  return [...text.matchAll(/<pin\s+digest="SHA-256">([^<]+)<\/pin>/g)].map((m) => m[1].trim());
}

/** SHA-256 SPKI pins of every certificate the server actually serves, leaf first. */
function livePins() {
  const chain = execFileSync(
    'openssl',
    ['s_client', '-servername', host, '-connect', `${host}:${port}`, '-showcerts'],
    { input: '', encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 20_000 }
  );

  const certs = [...chain.matchAll(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)]
    .map((m) => m[0]);
  if (certs.length === 0) throw new Error(`no certificates served by ${host}:${port}`);

  return certs.map((pem) => {
    const der = execFileSync('openssl', ['x509', '-pubkey', '-noout'], { input: pem, encoding: 'utf8' });
    // No `encoding` — execFileSync returns a Buffer, which is what DER and a raw
    // digest are. Passing encoding:'buffer' is not a thing and throws
    // "Unknown encoding: buffer"; passing 'utf8' would corrupt the bytes.
    const spki = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'DER'], { input: der });
    const digest = execFileSync('openssl', ['dgst', '-sha256', '-binary'], { input: spki });
    const subject = execFileSync('openssl', ['x509', '-noout', '-subject'], {
      input: pem,
      encoding: 'utf8',
    }).replace(/^subject=/, '').trim();

    return { pin: digest.toString('base64'), subject };
  });
}

const declared = declaredPins();
if (declared.length === 0) {
  console.error('cert pins: FAIL the Android config declares no pins at all.');
  process.exit(1);
}

let live;
try {
  live = livePins();
} catch (e) {
  // 🔴 Exit 2, never 0. "Could not check" must never read as "checked and fine" —
  // that is the shape of failure this whole script was written to end.
  console.error(`cert pins: UNAVAILABLE could not read the live chain for ${host}: ${e.message}`);
  console.error('cert pins: this is NOT a pass — the pins remain unverified.');
  process.exit(2);
}

const liveSet = new Set(live.map((c) => c.pin));
const matching = declared.filter((p) => liveSet.has(p));

console.log(`cert pins: ${declared.length} declared, ${live.length} served by ${host}`);
for (const cert of live) {
  const mark = declared.includes(cert.pin) ? 'PINNED' : '      ';
  console.log(`cert pins:   ${mark} ${cert.pin}  ${cert.subject}`);
}

const stale = declared.filter((p) => !liveSet.has(p));
for (const p of stale) {
  console.log(`cert pins:   STALE  ${p}  (matches nothing in the live chain)`);
}

if (matching.length === 0) {
  console.error('');
  console.error('cert pins: FAIL no declared pin matches the live chain.');
  console.error('cert pins: an app built with this config CANNOT CONNECT to the API.');
  console.error('cert pins: run `bash scripts/get-cert-pins.sh` and update');
  console.error('cert pins: android-network-security-config.xml (and re-run prebuild).');
  process.exit(1);
}

if (matching.length === 1) {
  console.error('');
  console.error('cert pins: FAIL only ONE declared pin matches the live chain.');
  console.error('cert pins: the app works today, but a single CA rotation would brick it.');
  console.error('cert pins: pin a second certificate at a different depth (intermediate + root).');
  process.exit(1);
}

if (stale.length > 0) {
  console.log('');
  console.log(`cert pins: ${stale.length} declared pin(s) match nothing served today.`);
  console.log('cert pins: not fatal while others match, but they are dead weight — a stale');
  console.log('cert pins: pin invites false confidence in a "last verified" date.');
}

console.log('');
console.log(`cert pins: OK — ${matching.length} pins match, at different chain depths.`);
