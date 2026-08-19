// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A primary button must not paint its own background.
 *
 * 🔴 This is the guard that makes the dark-mode accent lift safe, and it exists because
 * that lift had to be added, removed and restored before the reason became clear.
 *
 * 79 HeroButtons across 46 files carried `style={{ backgroundColor: primary }}`. That was
 * a workaround from before the theme knew the community's colour: it forced the fill to the
 * right colour while the LABEL still came from `--accent-foreground`. The two agreed only
 * as long as `--accent` and `usePrimaryColor()` happened to be the same value.
 *
 * The moment the accent was lightened for dark mode they stopped agreeing: the fill stayed
 * at the community's un-lifted colour while the label became the ink computed for the
 * lifted one — dark ink on #006FEE at 3.83:1, down from white's 4.66:1. A contrast
 * regression produced by a change intended to improve the colours, and invisible in every
 * unit test because it is a rendering result, not a value.
 *
 * The overrides were swept away, so fill and label now always come from the same pair
 * (`--accent` and `--accent-foreground`) and cannot disagree by construction. If one comes
 * back, the lift silently breaks its label again — which is exactly the kind of quiet
 * failure this codebase has produced four times this week. Hence a check rather than a
 * comment.
 *
 * What is still allowed, deliberately:
 *   - Any non-button element painting itself with the tenant colour. Accent bars, avatar
 *     tiles and icon chips were never part of the clash.
 *   - `withAlpha(primary, x)` anywhere, including on a button: a soft tint is a different
 *     colour from the accent, not a duplicate of it.
 *   - A non-primary variant with an explicit background, which is a deliberate departure
 *     rather than a workaround.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

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

/**
 * End index of the JSX opening tag starting at `start`.
 *
 * 🔴 A brace-aware scan, not a regex. `<HeroButton …>` routinely contains
 * `onPress={() => …}`, and the `>` of that arrow function truncates a `[^>]*>` match — which
 * is how the first version of the sweep script found only 44 of the 79 sites.
 */
function endOfOpeningTag(src: string, start: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let i = start; i < src.length; i += 1) {
    const c = src[i]!;
    if (quote) {
      if (c === quote && src[i - 1] !== '\\') quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue; }
    if (c === '{') { depth += 1; continue; }
    if (c === '}') { depth -= 1; continue; }
    if (c === '>' && depth === 0) return i + 1;
  }
  return -1;
}

interface Offender {
  file: string;
  line: number;
}

function findOffenders(): Offender[] {
  const offenders: Offender[] = [];

  for (const dir of SEARCH_DIRS) {
    const root = path.join(MOBILE_ROOT, dir);
    if (!fs.existsSync(root)) continue;

    for (const file of walk(root)) {
      const src = fs.readFileSync(file, 'utf8');

      let idx = src.indexOf('<HeroButton');
      while (idx !== -1) {
        const end = endOfOpeningTag(src, idx);
        if (end === -1) break;
        const tag = src.slice(idx, end);

        // A solid `backgroundColor: primary`, not an alpha tint, and not `primary` used as
        // a CONDITION.
        //
        // 🔴 That last exclusion is a real false positive this check produced.
        // `app/(modals)/support.tsx` has a component with a boolean prop also called
        // `primary`, and writes `backgroundColor: primary ? tone : withAlpha(tone, 0.12)` —
        // where the colour is `tone` and `primary` is merely the test. Flagging it would
        // have sent someone to "fix" correct code, which is how a noisy check gets
        // switched off. The value must be `primary` itself, terminated by a comma, a
        // closing brace, or the end of the line.
        const solid = /backgroundColor:\s*primary\s*(?:,|\}|$)/m.test(tag)
          && !/backgroundColor:\s*withAlpha\(primary/.test(tag);
        const variant = /variant="([a-z-]+)"/.exec(tag);
        const isPrimary = !variant || variant[1] === 'primary';

        if (solid && isPrimary) {
          offenders.push({
            file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
            line: src.slice(0, idx).split('\n').length,
          });
        }

        idx = src.indexOf('<HeroButton', end);
      }
    }
  }

  return offenders;
}

describe('primary buttons and the accent', () => {
  it('🔴 none paints its own background with the tenant colour', () => {
    const offenders = findOffenders();

    const OK = 'no primary HeroButton overrides its own background';
    const actual = offenders.length === 0
      ? OK
      : [
          'These primary buttons set their own background to the tenant colour while their',
          'label still comes from --accent-foreground. The two agree only while --accent and',
          'usePrimaryColor() are the same value, and they are NOT: the accent is lightened',
          'for dark mode. Remove the style prop — the theme already paints this button the',
          "community's colour, and its label will match:",
          ...offenders.map((o) => `  ${o.file}:${o.line}`),
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('finds real HeroButtons, so a green result is not an empty search', () => {
    // The scan is only meaningful if it is actually reading buttons. Without this, a broken
    // path or a renamed import would make the check pass by examining nothing — the exact
    // failure mode this file was written to prevent elsewhere.
    let buttons = 0;
    for (const dir of SEARCH_DIRS) {
      for (const file of walk(path.join(MOBILE_ROOT, dir))) {
        buttons += (fs.readFileSync(file, 'utf8').match(/<HeroButton\b/g) ?? []).length;
      }
    }
    expect(buttons).toBeGreaterThan(300);
  });

  it('still permits a soft alpha tint on a button', () => {
    // Proves the rule is targeted rather than a blanket ban: `withAlpha(primary, 0.12)` is a
    // pale wash used for secondary affordances, and it is not the accent.
    const sample = '<HeroButton style={{ backgroundColor: withAlpha(primary, 0.12) }} onPress={() => go()}>';
    const solid = /backgroundColor:\s*primary\b/.test(sample)
      && !/backgroundColor:\s*withAlpha\(primary/.test(sample);

    expect(solid).toBe(false);
  });
});
