// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The screenshot gate must stay sensitive enough to see a grey-on-white change.
 *
 * 🔴 Why. From its introduction until 2026-08-19 the comparison ran with
 * `{ threshold: 0.1, includeAA: false }` and could not see most of this app's UI
 * changing. Measured against a real, intended change (panel corner radii moving from
 * 24dp to 16dp on the wallet and profile screens):
 *
 *   threshold 0.1  includeAA false ->     40 px (0.002%)  <- gate reported "ok"
 *   threshold 0.05 includeAA true  ->  3,587 px (0.147%)
 *   threshold 0.02 includeAA true  ->  9,886 px (0.406%)  <- agrees with a hand count
 *
 * pixelmatch's `threshold` is a YIQ colour-distance tolerance, and this app is largely
 * light grey surfaces on white cards — about 14/255 per channel apart. At 0.1 that
 * whole class of difference sits inside the tolerance, so a tile could move, a radius
 * could change, or a surface could be swapped for a similar tone and the gate would
 * report "0 px" and pass. `docs/CURRENT_MOBILE_PRODUCTION_STATUS.md` read that as "3 screens
 * pixel-gated at 0px repeatability", which overstated the protection considerably.
 *
 * This is the same failure shape as the two other bugs found this week — an undefined
 * CSS class that emitted nothing, and a Surface whose padding crushed its icon to 4dp.
 * In all three the check or the code reported success while doing nothing. Hence the
 * habit this file exists to enforce: a gate has to be shown catching the thing it is
 * for, not merely configured.
 *
 * 0.02 is a floor rather than a preference. At 0.01 an UNTOUCHED login screen reports
 * 42,240 differing pixels (1.7%) from ordinary render noise, which would train
 * everyone to ignore the gate. At 0.02 that same screen reports exactly 0.
 */

import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = path.join(__dirname, 'screenshots.mjs');

function parseOptions(): { threshold: number; includeAA: boolean } {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  const block = /const PIXELMATCH_OPTIONS\s*=\s*Object\.freeze\(\{([^}]*)\}\)/.exec(source);
  if (!block) throw new Error('PIXELMATCH_OPTIONS not found in screenshots.mjs');

  const threshold = /threshold:\s*([\d.]+)/.exec(block[1]!);
  const includeAA = /includeAA:\s*(true|false)/.exec(block[1]!);
  if (!threshold || !includeAA) throw new Error('threshold/includeAA missing from PIXELMATCH_OPTIONS');

  return { threshold: Number(threshold[1]), includeAA: includeAA[1] === 'true' };
}

describe('screenshot comparison sensitivity', () => {
  it('keeps the threshold tight enough to see a light-grey-on-white change', () => {
    // 0.05 already misses two thirds of a real radius change (3,587 of 9,886 px), and
    // 0.1 misses effectively all of it. Anything above 0.02 is a regression in what
    // the gate can perceive.
    expect(parseOptions().threshold).toBeLessThanOrEqual(0.02);
  });

  it('does not go below the noise floor', () => {
    // At 0.01 an unchanged screen reports 1.7% difference. A gate that fires on
    // untouched screens gets ignored, which is worse than one that is too lenient.
    expect(parseOptions().threshold).toBeGreaterThanOrEqual(0.02);
  });

  it('counts anti-aliased pixels, because curve changes are made of them', () => {
    // `includeAA: false` asks pixelmatch to DISCARD anti-aliased pixels. A radius or
    // position change is largely anti-aliased edge, so discarding them discards the
    // evidence.
    expect(parseOptions().includeAA).toBe(true);
  });

  it('still fails a screen only above the noise ratio', () => {
    // The two settings work as a pair: a tight per-pixel threshold plus a whole-screen
    // ratio that tolerates a few stray pixels. Losing the ratio would make the gate
    // fire on single-pixel jitter.
    const source = fs.readFileSync(SCRIPT, 'utf8');
    const ratio = /const MAX_DIFF_RATIO\s*=\s*([\d.]+)/.exec(source);

    expect(ratio).not.toBeNull();
    expect(Number(ratio![1])).toBeGreaterThan(0);
    expect(Number(ratio![1])).toBeLessThanOrEqual(0.001);
  });

  it('uses one shared options object rather than inline settings', () => {
    // The original settings were written inline at the pixelmatch call site, where
    // nothing could assert on them. Keeping them in a named frozen constant is what
    // makes this test possible at all.
    const source = fs.readFileSync(SCRIPT, 'utf8');

    expect(source).toContain('pixelmatch(a.data, b.data, diff.data, a.width, a.height, PIXELMATCH_OPTIONS)');
    // No second, inline configuration drifting away from the shared one.
    expect(source).not.toMatch(/pixelmatch\([^)]*\{\s*threshold:/s);
  });

  it('pins every capture command to the explicitly requested emulator', () => {
    const source = fs.readFileSync(SCRIPT, 'utf8');

    expect(source).toContain("const requestedSerial = argValue('--serial', null);");
    expect(source).toMatch(/activeSerial\s*\?\s*\['-s', activeSerial, \.\.\.adbArgs\]/);
  });
});
