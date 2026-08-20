// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The shape of the Android certificate-pinning config, checked offline.
 *
 * 🔴 Why an offline test alongside `scripts/check-cert-pins.mjs`. That script compares the
 * pins against the LIVE chain, which needs the network, so it cannot sit in the blocking
 * path — a network blip would turn a release gate red and teach everyone to ignore it.
 * These assertions need no network and encode the DECISIONS instead, so the reasoning
 * cannot be undone by someone who does not know why it was made.
 *
 * The decisions come from a real incident. On 2026-08-20 the pinned leaf certificate
 * matched nothing in the live chain: the leaf has a 90-day lifetime (measured: 2026-08-10
 * → 2026-11-08) and had rotated about five weeks earlier, while the config still said
 * "Pins last verified: 2026-07-14". Every gate was green throughout. The app kept working
 * only because Android trusts a chain when ANY certificate matches ANY pin, so the
 * intermediate backup carried it alone — one pin deep, no spare, which is the state that
 * bricks an app the moment a CA rotates.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE = path.join(MOBILE_ROOT, 'android-network-security-config.xml');
const GENERATED = path.join(
  MOBILE_ROOT, 'android', 'app', 'src', 'main', 'res', 'xml', 'network_security_config.xml'
);

/** The known-stale leaf pin from before the 2026-08-20 refresh. */
const RETIRED_LEAF_PIN = 'Owkg3TiAdb9cU+XKSXkJfvD2tCx+supL5btxtXNJaJE=';

function pinsIn(file: string): string[] {
  const text = fs.readFileSync(file, 'utf8');
  return [...text.matchAll(/<pin\s+digest="SHA-256">([^<]+)<\/pin>/g)].map((m) => m[1].trim());
}

describe('android certificate pinning', () => {
  it('🔴 pins at least TWO certificates, so one rotation cannot brick the app', () => {
    // The state found on 2026-08-20 was effectively one pin deep. Two pins at different
    // chain depths is the whole safety argument.
    expect(pinsIn(SOURCE).length).toBeGreaterThanOrEqual(2);
  });

  it('🔴 does not pin the retired leaf certificate again', () => {
    // Re-adding it would recreate the exact stale state, and buy nothing: with the
    // intermediate pinned, the effective constraint is already "issued by GTS WE1".
    expect(pinsIn(SOURCE)).not.toContain(RETIRED_LEAF_PIN);
  });

  it('records WHY the leaf is not pinned, so the reasoning survives this session', () => {
    // A pin removed without an explanation gets helpfully "restored" by the next person.
    const text = fs.readFileSync(SOURCE, 'utf8');

    expect(text).toMatch(/90-DAY|90 day/i);
    expect(text).toMatch(/intermediate/i);
  });

  it('keeps an expiry far enough out for the release gate', () => {
    // verify:release fails once fewer than 90 days remain. This asserts the same
    // invariant offline, so an edit that shortens the window is caught by the suite
    // rather than only by the gate.
    const text = fs.readFileSync(SOURCE, 'utf8');
    const expiry = text.match(/<pin-set expiration="([0-9-]+)"/)?.[1];

    expect(expiry).toBeTruthy();
    expect(Date.parse(expiry!)).toBeGreaterThan(Date.now() + 90 * 86_400_000);
  });

  it('never permits cleartext traffic in the production config', () => {
    expect(fs.readFileSync(SOURCE, 'utf8')).not.toMatch(/cleartextTrafficPermitted="true"/);
  });

  it('🔴 a local prebuilt project has not drifted from the source', () => {
    // 🔴 Which file is authoritative, stated precisely, because getting this backwards
    // sends someone hunting for a file that is not in the repository.
    //
    // `mobile/android/` is GITIGNORED (mobile/.gitignore:8 `android/`, 0 tracked files),
    // exactly like the Capacitor project. So the file committed here — the SOURCE — is
    // the single source of truth, and `plugins/with-android-network-security.js` copies
    // it into the native project at prebuild on whichever machine builds. Editing the
    // source alone is therefore correct and sufficient; the generated file must NOT be
    // committed, and git refuses it.
    //
    // What this assertion is for is the opposite hazard: a STALE local prebuild. A build
    // from this machine uses the generated copy, so if it predates a source edit, the
    // binary carries the old pins while the repository looks correct.
    if (!fs.existsSync(GENERATED)) {
      // No prebuilt project here — the normal state for a fresh clone. The source
      // assertions above are the ones that matter and have already run.
      return;
    }

    expect(fs.readFileSync(GENERATED, 'utf8')).toBe(fs.readFileSync(SOURCE, 'utf8'));
  });
});
