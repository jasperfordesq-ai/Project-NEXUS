// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard against a silent, invisible-content bug in HeroUI Native's `Surface`.
 *
 * 🔴 `Surface`'s BASE class is `p-4 rounded-3xl shadow-surface overflow-hidden`
 * (`node_modules/heroui-native/src/components/surface/surface.styles.ts`). The 16dp
 * padding is not removed by giving the Surface a size, so a small fixed-size Surface
 * used as an icon badge has almost no room left for its child:
 *
 *     size-9  = 36dp  →  36 - (2 x 16) = 4dp of content box
 *
 * An 18dp icon inside that renders at ~4dp. It does not error, does not warn, and
 * does not disappear — it draws a few pixels wide, which on a device reads as an
 * empty circle. It shipped that way on every listing card in the Listings tab: the
 * forward arrow measured 10x12px on the emulator's view hierarchy against the
 * neighbouring heart button's correct 45x47px, and it was found by looking at a
 * screenshot, not by any test.
 *
 * A component test cannot catch this. The child renders, the tree is correct, and
 * Jest has no layout engine to notice that the box is 4dp wide — which is exactly
 * why this is a source scan instead.
 *
 * If a Surface legitimately needs its default padding AND a small fixed size,
 * declare the padding explicitly (`p-1`, `p-[2px]`, a `padding` style, …) and this
 * check accepts it. What it refuses is the silent case where padding was never
 * considered.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Boxes at or below 64dp (`size-16`) are the ones at risk: 32dp of padding leaves
 * them nothing. Larger containers are ordinary panels where `p-4` is the point.
 */
const SMALL_BOX_DP = 16;

interface Offender {
  file: string;
  line: number;
  className: string;
}

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

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];

  for (const dir of SEARCH_DIRS) {
    const root = path.join(MOBILE_ROOT, dir);
    if (!fs.existsSync(root)) continue;

    for (const file of walk(root)) {
      const source = fs.readFileSync(file, 'utf8');

      // Opening <Surface …> tags, which may span lines.
      for (const match of source.matchAll(/<Surface\b[^>]*>/gs)) {
        const tag = match[0];
        const className = /className="([^"]*)"/.exec(tag)?.[1] ?? '';

        const sizes = [...className.matchAll(/\b(?:size|[hw])-(\d+)\b/g)].map((m) => Number(m[1]));
        const isSmallFixedBox = sizes.some((n) => n <= SMALL_BOX_DP);
        // Any deliberate padding decision clears the check, including p-0.
        const declaresPadding = /\bp[xyltrbse]?-(?:\d+|\[)/.test(className) || /padding/.test(tag);

        // Only a Surface with CHILDREN can show the bug; a bare skeleton bar has
        // nothing to crush. Self-closing tags are therefore out of scope.
        const hasChildren = !tag.trimEnd().endsWith('/>');

        if (isSmallFixedBox && hasChildren && !declaresPadding) {
          offenders.push({
            file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
            line: source.slice(0, match.index).split('\n').length,
            className,
          });
        }
      }
    }
  }

  return offenders;
}

describe("HeroUI Native Surface's base p-4 padding", () => {
  it('is never left to crush the contents of a small fixed-size Surface', () => {
    const offenders = findOffenders();

    const report = offenders
      .map((o) => `  ${o.file}:${o.line}  className="${o.className}"`)
      .join('\n');

    // The failure message has to carry the fix, or the next person re-derives the
    // 4dp arithmetic from scratch. Jest's expect() accepts no message argument, so
    // the explanation is asserted AS the value rather than passed alongside it.
    const OK = 'every small fixed-size Surface states its padding';
    const actual = offenders.length === 0
      ? OK
      : [
          'Surface has `p-4` in its base class. These small fixed-size Surfaces have',
          'children but never state a padding, so the children are drawn into whatever',
          'few dp remain and look absent on a device:',
          report,
          'Add `p-0` (or an explicit padding) to the className.',
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('still notices the bug if the fix is reverted', () => {
    // Proves the check above is capable of failing rather than passing vacuously
    // over source it never matched. This mirrors the exact markup that shipped.
    const shipped = '<Surface variant="secondary" className="size-9 items-center justify-center rounded-full">';

    const className = /className="([^"]*)"/.exec(shipped)?.[1] ?? '';
    const sizes = [...className.matchAll(/\b(?:size|[hw])-(\d+)\b/g)].map((m) => Number(m[1]));

    expect(sizes.some((n) => n <= SMALL_BOX_DP)).toBe(true);
    expect(/\bp[xyltrbse]?-(?:\d+|\[)/.test(className)).toBe(false);
  });
});
