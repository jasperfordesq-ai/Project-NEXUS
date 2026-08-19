// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The two implementations of "what colour goes on the accent" must agree.
 *
 * 🔴 There are unavoidably two. `scripts/generate-tenant-themes.mjs` decides
 * `--accent-foreground` at BUILD time for the label, because HeroUI reads it from CSS.
 * `lib/theme/accentForeground.ts` decides the same thing at RUNTIME for icons, because
 * `lib/theme/nativeVectorIconStyling.test.ts` requires Ionicons to take a native `color`
 * prop and an icon therefore cannot read a CSS variable.
 *
 * Two copies of one decision is exactly the sort of thing that drifts silently and then
 * shows up as a white icon beside dark text on the primary button of every screen. So they
 * are compared here across a spread of brand colours, by running the REAL generator as a
 * subprocess rather than re-deriving its arithmetic — the same approach as
 * accentForeground.test.ts, and for the same reason: a re-derivation only proves the copy
 * agrees with itself.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { accentForegroundFor, ACCENT_FOREGROUND_DARK, ACCENT_FOREGROUND_LIGHT } from './accentForeground';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const GENERATOR = path.join(MOBILE_ROOT, 'scripts', 'generate-tenant-themes.mjs');

/** The generated CSS writes these two, and only these two. */
const CSS_WHITE = 'oklch(1 0 0)';
const CSS_INK = 'oklch(0.21 0.03 256)';

let workDir: string;

beforeAll(() => {
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'accent-parity-'));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

/** What the BUILD-time generator chooses for this accent, as a hex colour. */
function generatorChoice(hex: string): string {
  const stamp = hex.replace('#', '');
  const palettePath = path.join(workDir, `p-${stamp}.json`);
  const outPath = path.join(workDir, `o-${stamp}.css`);

  fs.writeFileSync(palettePath, JSON.stringify({ tenants: { fixture: { accent: hex } } }), 'utf8');
  execFileSync(process.execPath, [GENERATOR, '--palette', palettePath, '--out', outPath], {
    cwd: MOBILE_ROOT,
    stdio: 'pipe',
  });

  const css = fs.readFileSync(outPath, 'utf8');
  const block = /@variant t-fixture-light \{([\s\S]*?)\n {4}\}/.exec(css);
  if (!block) throw new Error(`no light theme generated for ${hex}`);

  const declared = /--accent-foreground:\s*([^;]+);/.exec(block[1]!);
  if (!declared) throw new Error(`no --accent-foreground generated for ${hex}`);

  const value = declared[1]!.trim();
  if (value === CSS_WHITE) return ACCENT_FOREGROUND_LIGHT;
  if (value === CSS_INK) return ACCENT_FOREGROUND_DARK;
  throw new Error(`the generator emitted an unrecognised foreground "${value}" — the runtime copy in accentForeground.ts knows only white and ink, so it can no longer match`);
}

describe('build-time label colour vs runtime icon colour', () => {
  it.each([
    ['NEXUS blue', '#006fee'],
    ['agoris teal', '#0f766e'],
    ['a yellow brand', '#ffd400'],
    ['a mint brand', '#7ef0c0'],
    ['a pale sky brand', '#9ecbff'],
    ['a lime brand', '#bef264'],
    ['a deep purple brand', '#4c1d95'],
    ['a maroon brand', '#7f1d1d'],
    ['mid grey', '#808080'],
    ['the crossover violet', '#8b5cf6'],
  ])('agree on %s', (_name, hex) => {
    expect(accentForegroundFor(hex)).toBe(generatorChoice(hex));
  });

  it('agree on the lightened form of an accent too', () => {
    // If the dark-mode lift is ever reinstated, the generator computes the label for the
    // LIFTED colour while an icon would be computing it from `usePrimaryColor()` — the
    // un-lifted one. This is the case that broke before, so it is pinned: the two agree on
    // a colour and disagree on its lifted form, which is precisely why lifting requires the
    // icon sweep to have happened first.
    const base = '#006fee';
    const lifted = '#4d9af3';

    expect(accentForegroundFor(base)).toBe(ACCENT_FOREGROUND_LIGHT);
    expect(accentForegroundFor(lifted)).toBe(ACCENT_FOREGROUND_DARK);
    expect(accentForegroundFor(base)).not.toBe(accentForegroundFor(lifted));
  });

  it('falls back to white rather than NaN on a malformed colour', () => {
    // An unparseable value yields luminance NaN, and every NaN comparison is false — which
    // would quietly pick ink for everything. Guarded because a bad `primary_color` in the
    // database is entirely possible.
    expect(accentForegroundFor('not-a-colour')).toBe(ACCENT_FOREGROUND_LIGHT);
    expect(accentForegroundFor('')).toBe(ACCENT_FOREGROUND_LIGHT);
  });

  it('accepts the shorthand hex form the API might return', () => {
    expect(accentForegroundFor('#fd0')).toBe(ACCENT_FOREGROUND_DARK);
    expect(accentForegroundFor('#00f')).toBe(ACCENT_FOREGROUND_LIGHT);
  });
});
