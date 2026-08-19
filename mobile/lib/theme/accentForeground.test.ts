// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The label colour chosen for a community's accent must be readable ON that accent.
 *
 * 🔴 This file exists to correct a claim of my own. When per-community colours were
 * built I wrote that the contrast arithmetic "already mattered — in dark mode the teal
 * button uses dark text, because white would have failed". That was true only while the
 * generator lightened each accent 30% for dark mode. That lift was removed — it broke 142
 * buttons whose background is the UN-lifted colour — and with it went the only palette
 * entry that chose dark ink. Both colours in the palette today take white.
 *
 * Which leaves a real risk. The ink branch is no longer reached by any committed palette
 * entry, and an unexercised branch is an unproven one. This area has already produced
 * several faults of exactly that shape this week: an undefined CSS class that emitted
 * nothing, a Surface that crushed its icon to 4dp, a screenshot gate that compared images
 * and saw nothing, and a verification command that printed "OK" unconditionally. So the
 * branch is tested here rather than assumed.
 *
 * The consequence if it silently stops working: a community picks a yellow or mint brand
 * colour, every primary button in their app gets a white label on a pale fill, and it is
 * unreadable — shipped to one community, and therefore easy to miss.
 *
 * 🔴 It drives the REAL generator as a subprocess against fixture palettes rather than
 * re-implementing the arithmetic. Jest cannot import the `.mjs` generator under the
 * jest-expo preset, and a test that re-derived the maths would only prove the copy works.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(MOBILE_ROOT, 'scripts', 'generate-tenant-themes.mjs');

const WHITE = 'oklch(1 0 0)';
const INK = 'oklch(0.21 0.03 256)';

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accent-fg-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/**
 * Runs the generator against a one-tenant palette and returns the light theme's accent
 * and label declarations.
 */
function generateFor(hex: string): { accent: string; foreground: string } {
  const stamp = hex.replace('#', '');
  const palettePath = path.join(workDir, `palette-${stamp}.json`);
  const outPath = path.join(workDir, `themes-${stamp}.css`);

  fs.writeFileSync(
    palettePath,
    JSON.stringify({ tenants: { fixture: { accent: hex } } }),
    'utf8'
  );

  execFileSync(process.execPath, [GENERATOR, '--palette', palettePath, '--out', outPath], {
    cwd: MOBILE_ROOT,
    stdio: 'pipe',
  });

  const css = fs.readFileSync(outPath, 'utf8');
  const block = /@variant t-fixture-light \{([\s\S]*?)\n {4}\}/.exec(css);
  if (!block) throw new Error(`the generator produced no light theme for ${hex}`);

  const accent = /--accent:\s*(rgb\([^)]+\));/.exec(block[1]!);
  const foreground = /--accent-foreground:\s*([^;]+);/.exec(block[1]!);
  if (!accent || !foreground) throw new Error(`accent declarations missing for ${hex}`);

  return { accent: accent[1]!, foreground: foreground[1]!.trim() };
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminanceOfRgbString(value: string): number {
  const [r, g, b] = value.match(/\d+/g)!.map(Number).map(toLinear);
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function luminanceOfLabel(css: string): number {
  // The generator emits exactly two label colours.
  return css === WHITE ? 1 : luminanceOfRgbString('rgb(15 23 42)');
}

function ratio(accentRgb: string, labelCss: string): number {
  const [hi, lo] = [luminanceOfRgbString(accentRgb), luminanceOfLabel(labelCss)]
    .sort((a, b) => b - a);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('the label colour the generator picks', () => {
  it.each([
    ['NEXUS blue', '#006fee'],
    ['agoris teal', '#0f766e'],
    ['a deep purple brand', '#4c1d95'],
    ['a maroon brand', '#7f1d1d'],
  ])('is WHITE on the dark accent %s', (_name, hex) => {
    const { accent, foreground } = generateFor(hex);

    expect(foreground).toBe(WHITE);
    expect(ratio(accent, foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    ['a yellow brand', '#ffd400'],
    ['a mint brand', '#7ef0c0'],
    ['a pale sky brand', '#9ecbff'],
    ['a lime brand', '#bef264'],
  ])('🔴 is INK on the pale accent %s, where white would be unreadable', (_name, hex) => {
    // The branch no committed palette entry currently reaches.
    const { accent, foreground } = generateFor(hex);

    expect(foreground).toBe(INK);
    expect(ratio(accent, foreground)).toBeGreaterThanOrEqual(4.5);
  });

  it('always clears the 3:1 floor, across a spread of plausible brand colours', () => {
    // 3:1 rather than 4.5:1, and that is a deliberate, documented limit rather than a
    // lowered bar. A mid-lightness accent sits at the crossover where NEITHER white nor
    // ink reaches 4.5 — #8b5cf6 measures 4.23 on white and 4.22 on ink. No label colour
    // fixes that; it needs a different button treatment, which is a design decision.
    // What the generator must guarantee is the 3:1 floor that applies to UI text, and
    // that it never silently ships worse.
    const failures: string[] = [];

    for (const hex of [
      '#808080', '#8b5cf6', '#0ea5e9', '#14b8a6', '#a855f7',
      '#e11d48', '#f97316', '#eab308', '#22c55e', '#64748b',
    ]) {
      const { accent, foreground } = generateFor(hex);
      const r = ratio(accent, foreground);
      if (r < 3) {
        failures.push(`  ${hex} -> ${foreground === WHITE ? 'white' : 'ink'} at ${r.toFixed(2)}:1`);
      }
    }

    const OK = 'every sampled brand colour gets a label at 3:1 or better';
    const actual = failures.length === 0
      ? OK
      : [
          'These brand colours get a label below even the 3:1 UI floor, which is unusable:',
          ...failures,
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('picks the BETTER of the two labels, not white-by-default', () => {
    // At the crossover, "white unless it fails 4.5" would pick white on a colour where ink
    // is marginally better. The rule is the larger ratio, so this checks a colour on each
    // side of the crossover rather than trusting the ordering of the conditions.
    expect(generateFor('#a855f7').foreground).toBe(INK);   // white 3.96 vs ink 4.51
    expect(generateFor('#e11d48').foreground).toBe(WHITE); // white 4.70 vs ink 3.80
  });

  it('🔴 REPORTS an accent that cannot reach 4.5:1 rather than shipping it quietly', () => {
    // The compromise above must be visible at generate time. A silent compromise is how
    // the WCAG-failing colours found earlier this week got into the app in the first
    // place, so the generator prints a warning naming the theme.
    const palettePath = path.join(workDir, 'palette-warn.json');
    const outPath = path.join(workDir, 'themes-warn.css');
    fs.writeFileSync(
      palettePath,
      JSON.stringify({ tenants: { crossover: { accent: '#8b5cf6' } } }),
      'utf8'
    );

    const output = execFileSync(
      process.execPath,
      [GENERATOR, '--palette', palettePath, '--out', outPath],
      { cwd: MOBILE_ROOT, encoding: 'utf8', stdio: 'pipe' }
    );

    expect(output).toContain('below 4.5:1');
    expect(output).toContain('crossover');
  });

  it('says nothing about contrast when every accent is comfortable', () => {
    // The counterpart: a warning that fires for everything is noise nobody reads.
    const palettePath = path.join(workDir, 'palette-quiet.json');
    const outPath = path.join(workDir, 'themes-quiet.css');
    fs.writeFileSync(
      palettePath,
      JSON.stringify({ tenants: { comfortable: { accent: '#0f766e' } } }),
      'utf8'
    );

    const output = execFileSync(
      process.execPath,
      [GENERATOR, '--palette', palettePath, '--out', outPath],
      { cwd: MOBILE_ROOT, encoding: 'utf8', stdio: 'pipe' }
    );

    expect(output).not.toContain('below 4.5:1');
  });
});
