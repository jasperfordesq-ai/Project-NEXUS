#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * BLOCKING: status colours used as TEXT must come from the theme tokens.
 *
 * Why this exists
 * ---------------
 * `text-emerald-500`, `text-amber-600`, `text-rose-500` and friends FAIL WCAG AA
 * when used as text. Measured against the 4.5:1 minimum, on a /10 tint of their
 * own hue they come out at 2.7–3.9; on plain white amber-600 is 3.19 and
 * emerald-600 is 3.67. Going one step darker is NOT a general fix either — on a
 * /20 tint, amber-700 is 4.32, emerald-700 4.44 and green-700 4.13.
 *
 * The real-browser accessibility gate found four of these on the Wallet page in
 * August 2026, and only found them because an unrelated fix let it reach that
 * page for the first time. This check is the compensating control: it catches
 * them at the source rather than relying on one audited route.
 *
 * Use instead:
 *   text-theme-success   text-theme-warning   text-theme-danger   text-theme-info
 * defined in src/index.css from tokens in src/styles/tokens.css, contrast-checked
 * in BOTH light and dark mode.
 *
 * 🔴 What this deliberately does NOT flag, so nobody reads a pass as "all clear":
 *   - DECORATIVE ICONS. No contrast minimum applies to them, so a palette class
 *     on an icon is fine. Detected as a className carrying h-N/w-N sizing.
 *   - LIGHT shades (-100 … -400). Those are for text on DARK or solid coloured
 *     surfaces, where the requirement runs the other way.
 *   - Variant-prefixed classes (`hover:`, `dark:`, `data-[…]:`). `dark:` needs
 *     LIGHTER text, and a hover state needs its own judgement.
 *   - Class strings built in colour MAPS, ternaries or template literals, where
 *     the colour and its background are decided in different places. Roughly 200
 *     of those exist; each needs reading individually and a blanket rule would be
 *     guesswork.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = ['react-frontend/src/pages', 'react-frontend/src/components'];

const SUGGEST = {
  emerald: 'text-theme-success', green: 'text-theme-success',
  amber: 'text-theme-warning', yellow: 'text-theme-warning',
  rose: 'text-theme-danger', red: 'text-theme-danger',
  blue: 'text-theme-info',
};
const FAMILIES = Object.keys(SUGGEST).join('|');
const BAD = new RegExp(`^text-(${FAMILIES})-(500|600)$`);

/**
 * 🔴 Measured, not assumed. Contrast of each shade as text (oklch -> sRGB ->
 * WCAG relative luminance), so the check does not flag colours that are fine:
 *
 *   on plain white:  amber-500 2.15  amber-600 3.19   emerald-500 2.46
 *                    emerald-600 3.67  green-500 2.22  green-600 3.22
 *                    rose-500 3.76   red-500 3.82     blue-500 3.76
 *                    ── all below 4.5, so ALWAYS a violation ──
 *                    rose-600 4.51   red-600 4.76     blue-600 5.26
 *                    ── these PASS on white; only a tint sinks them ──
 *
 *   on a /10 tint of their own hue: rose-600 3.89, red-600 4.13  -> fail
 *   blue-600 survives /10 at 4.67 and only fails at /20 (4.13).
 *
 * So a shade that passes on white is reported only when the same className also
 * carries a same-family tint strong enough to push it under.
 */
const PASSES_ON_WHITE = { rose: 600, red: 600, blue: 600 };
const MIN_TINT_THAT_FAILS = { rose: 10, red: 10, blue: 15 };
const TEXTISH = /\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl)\b|\bfont-(medium|semibold|bold)\b/;
const ICONISH = /\b[hw]-\d/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test.')) out.push(full);
  }
  return out;
}

const violations = [];
let scanned = 0;

for (const rel of SCAN) {
  for (const file of walk(path.join(ROOT, rel))) {
    scanned += 1;
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/className="([^"]*)"/g)) {
        const cls = m[1];
        if (!TEXTISH.test(cls) || ICONISH.test(cls)) continue;
        for (const token of cls.split(/\s+/)) {
          const bad = BAD.exec(token);
          if (!bad) continue;                       // variants never match: they carry a prefix
          const [, family, shadeStr] = bad;
          const shade = Number(shadeStr);

          // Shades that clear 4.5 on a plain background are a problem only when
          // this element also sits on a tint of its own hue.
          if (PASSES_ON_WHITE[family] === shade) {
            const tints = [...cls.matchAll(new RegExp(`bg-${family}-500/(\\d+)`, 'g'))]
              .map((t) => Number(t[1]));
            const strongest = tints.length ? Math.max(...tints) : 0;
            if (strongest < MIN_TINT_THAT_FAILS[family]) continue;
          }

          violations.push({
            file: path.relative(ROOT, file).replace(/\\/g, '/'),
            line: i + 1,
            token,
            suggest: SUGGEST[family],
          });
        }
      }
    });
  }
}

console.log('='.repeat(60));
console.log('  Status Colour Token Check (text only)');
console.log('='.repeat(60));
console.log(`  Files scanned: ${scanned}`);
console.log(`  Violations:    ${violations.length}`);

if (violations.length > 0) {
  console.log('');
  for (const v of violations) {
    console.log(`${v.file}:${v.line}  ${v.token}  ->  ${v.suggest}`);
  }
  console.log('');
  console.log('FAIL: these palette shades do not meet WCAG AA as text.');
  console.log('Use the theme token instead, or — if this is a decorative icon —');
  console.log('give it icon sizing (h-N/w-N) so it is correctly treated as exempt.');
  process.exit(1);
}

console.log('');
console.log('OK — no raw status-palette shades used as text.');
console.log('NOTE: icons, light shades (-100..-400), variant-prefixed classes and');
console.log('class strings built in colour maps are out of scope by design.');
