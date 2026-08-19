// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every custom `rounded-*` utility the app uses must actually be defined.
 *
 * 🔴 The bug this exists for. `rounded-panel` and `rounded-panel-inner` were used
 * **625 times across 99 files** while being defined nowhere — not in `global.css`, not
 * in `tailwind.config.js` (which contains only a `content` array), not in
 * `heroui-native`, and not at any point in this repository's git history. The classes
 * were written against a convention that was never created. Tailwind v4 emits no CSS
 * for an unknown utility and reports nothing, so all 625 were silently inert.
 *
 * Why it went unnoticed for so long: nothing fails. There is no build error, no
 * warning, and no test asserted on these class names. The visible result was also
 * mostly subtle rather than dramatic, because HeroUI's Surface, Card and Button carry
 * `rounded-3xl` in their own base classes, so an inert class still left a rounded
 * corner. Measured at the point of the fix:
 *
 *   - 382 uses were on a component already at 24px asking for 24px → no defect
 *   - 171 asked for the smaller inner radius and got 24px → 8px too round
 *   -  69 sat on a plain View / Image / NativePressable → genuinely square
 *
 * So the honest scale is "69 square corners and 171 wrong ones", not "625 broken
 * corners" — a distinction worth keeping in the record, because an inflated number
 * invites someone to rip out the whole convention rather than define it.
 *
 * This test is deliberately a CSS-source assertion rather than a rendering test:
 * Tailwind resolves these at build time, so a component test would render the same
 * either way and prove nothing.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const GLOBAL_CSS = path.join(MOBILE_ROOT, 'global.css');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Utilities Tailwind ships itself, plus the arbitrary-value form. Anything else in a
 * `rounded-…` class has to be declared in `@theme` or it does nothing.
 */
const TAILWIND_BUILT_IN_RADII = new Set([
  'none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full',
  // Directional variants (`rounded-t-lg`) are split before lookup, so the side
  // keywords appear as their own token.
  't', 'r', 'b', 'l', 'tl', 'tr', 'br', 'bl', 's', 'e', 'ss', 'se', 'es', 'ee',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!entry.name.startsWith('.')) walk(full, out);
    } else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

/** Radius names used in className strings across the app, e.g. `panel`, `panel-inner`. */
function customRadiiInUse(): Map<string, string> {
  const firstSeen = new Map<string, string>();

  for (const dir of SEARCH_DIRS) {
    const root = path.join(MOBILE_ROOT, dir);
    if (!fs.existsSync(root)) continue;

    for (const file of walk(root)) {
      const source = fs.readFileSync(file, 'utf8');

      // 🔴 Only look inside class-name attribute VALUES, not the whole file. Scanning
      // raw source matched the word `rounded-button` inside a code comment that
      // explains why that very utility was removed, so the check reported a utility the
      // app no longer uses. A class only takes effect from a class attribute, so this
      // is the correct scope as well as the robust one.
      const classText = [
        ...source.matchAll(
          /\b(?:className|backgroundClassName|contentContainerClassName|indicatorClassName)="([^"]*)"/g
        ),
      ]
        .map((attr) => attr[1]!)
        .join(' ');

      for (const match of classText.matchAll(/\brounded-([a-z0-9-]+)/g)) {
        const suffix = match[1]!;
        // Arbitrary values (`rounded-[6px]`) never reach the theme.
        if (suffix.startsWith('[')) continue;
        // A directional prefix leaves the size after it: `t-lg` → `lg`. What remains
        // can legitimately be empty or an arbitrary value — `rounded-t-[30px]` strips
        // to '' — and neither is a theme token. Missing these two cases made the first
        // version of this scan report a phantom utility named ''.
        const size = suffix.replace(/^(t|r|b|l|tl|tr|br|bl|s|e|ss|se|es|ee)-/, '');
        if (size === '' || size.startsWith('[')) continue;
        if (TAILWIND_BUILT_IN_RADII.has(size)) continue;
        if (firstSeen.has(size)) continue;

        // The offset is into the joined attribute text, so the file is reported rather
        // than a line number that would point at the wrong place.
        firstSeen.set(size, path.relative(MOBILE_ROOT, file).split(path.sep).join('/'));
      }
    }
  }

  return firstSeen;
}

describe('custom rounded-* utilities', () => {
  const css = fs.readFileSync(GLOBAL_CSS, 'utf8');

  it('defines --radius-panel and --radius-panel-inner', () => {
    // Named explicitly, not just swept, because these two are the ones that shipped
    // undefined and each is worth failing by name.
    expect(css).toMatch(/--radius-panel:\s*[^;]+;/);
    expect(css).toMatch(/--radius-panel-inner:\s*[^;]+;/);
  });

  it('gives panel-inner a SMALLER radius than panel', () => {
    // The whole point of the pair: inner content nests inside a panel, so an inner
    // radius that is equal or larger reads as a mistake and undoes the distinction.
    const panel = /--radius-panel:\s*([\d.]+)rem/.exec(css);
    const inner = /--radius-panel-inner:\s*([\d.]+)rem/.exec(css);

    expect(panel).not.toBeNull();
    expect(inner).not.toBeNull();
    expect(Number(inner![1])).toBeLessThan(Number(panel![1]));
  });

  it('keeps --radius-panel at HeroUI\'s own surface radius', () => {
    // 1.5rem is `rounded-3xl`, which HeroUI's Surface/Card/Button base classes already
    // apply. Matching it means the 382 already-correct-by-accident uses keep rendering
    // exactly as they do today, so defining the token is not itself a visual change
    // for them.
    expect(css).toMatch(/--radius-panel:\s*1\.5rem/);
  });

  it('🔴 has every custom radius the app uses actually defined', () => {
    const inUse = customRadiiInUse();

    // Proof the scan works: if this ever finds nothing, the regex has drifted and a
    // green result would mean "checked nothing".
    expect(inUse.size).toBeGreaterThan(0);
    expect([...inUse.keys()]).toContain('panel');

    const undefined_: string[] = [];
    for (const [name, where] of inUse) {
      if (!new RegExp(`--radius-${name}\\s*:`).test(css)) {
        undefined_.push(`  rounded-${name}  (first used in ${where})`);
      }
    }

    const OK = 'every custom rounded-* utility is defined in global.css';
    const actual = undefined_.length === 0
      ? OK
      : [
          'These rounded-* utilities are used in the app but defined nowhere. Tailwind',
          'v4 emits no CSS for an unknown utility and reports nothing, so each one is',
          'silently inert — the corner simply does not round:',
          ...undefined_,
          'Define them in the @theme block of global.css.',
        ].join('\n');

    expect(actual).toBe(OK);
  });
});
