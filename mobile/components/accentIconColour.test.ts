// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An icon inside a primary button must not hardcode white.
 *
 * 🔴 The bug, which predated all the theming work. HeroUI Native resolves a button's label
 * from `--accent-foreground`, computed per community: white on a dark brand colour,
 * near-black ink on a pale one. 72 icons across 37 files hardcoded `#fff` instead, because
 * `lib/theme/nativeVectorIconStyling.test.ts` requires Ionicons to take a native `color`
 * prop and an icon therefore cannot read the CSS variable its own label uses.
 *
 * So a community whose brand colour is yellow, mint or pale blue already got an INK label
 * with a WHITE icon beside it — about 1.4:1 against the fill, effectively invisible, on the
 * primary action of every screen. Nobody had noticed because the two live palette colours
 * are both dark enough to take white, so the app looked fine for them.
 *
 * `components/ui/AccentIcon.tsx` resolves the same colour the label uses, including the
 * dark-mode lift. This check stops the hardcoded form coming back — and it matters more
 * than it looks, because the dark-mode accent lift is only safe while it holds: with the
 * lift in place, the default accent takes an ink label, so a white icon beside it would be
 * wrong for EVERY community rather than only the pale-branded ones.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/**
 * Spellings of white seen in this codebase — literal AND conditional.
 *
 * 🔴 The first version matched only `color="#fff"` / `color={'#fff'}`. The idiom on every
 * toggle and segmented button in the app is `color={selected ? '#fff' : primary}` inside
 * `variant={selected ? 'primary' : 'secondary'}`, and 33 such icons plus 9 labels sat
 * invisible to this check until the 2026-09-05 sweep (S6-03). A conditional variant has no
 * literal `variant="…"`, so it is treated as primary below — which is exactly the branch
 * where the white lands.
 */
const WHITE = /color=(?:"#fff"|"#ffffff"|"#FFF"|"#FFFFFF"|\{'#fff'\}|\{'#ffffff'\}|\{[^}]*'#(?:fff|ffffff)'[^}]*\})/i;
/** A label forced white: `style={{ color: … '#fff' … }}` or a `text-white` class. */
const WHITE_LABEL = /<HeroButton\.Label\b(?:[^>]|>(?=[^<]*<\/HeroButton\.Label>))*?(?:style=\{\{[^}]*'#(?:fff|ffffff)'[^}]*\}\}|className="[^"]*\btext-white\b)/i;

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

/** End index of the JSX opening tag beginning at `start`. Brace-aware — see below. */
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

      for (const match of src.matchAll(/<HeroButton\b[\s\S]*?<\/HeroButton>/g)) {
        const block = match[0];
        // 🔴 Brace-aware, because `<HeroButton …>` routinely contains `onPress={() => …}`
        // and the `>` of that arrow truncates a `[^>]*>` match. That mistake made an
        // earlier sweep find 44 of 79 sites.
        const tag = block.slice(0, endOfOpeningTag(block, 0));
        if (tag.startsWith('<HeroButton.')) continue;

        const variant = /variant="([a-z-]+)"/.exec(tag);
        if (variant && variant[1] !== 'primary') continue;

        for (const icon of block.matchAll(/<Ionicons\b[^>]*?\/>/g)) {
          if (!WHITE.test(icon[0])) continue;
          const absolute = match.index + icon.index;
          offenders.push({
            file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
            line: src.slice(0, absolute).split('\n').length,
          });
        }
        const label = WHITE_LABEL.exec(block);
        if (label) {
          offenders.push({
            file: path.relative(MOBILE_ROOT, file).split(path.sep).join('/'),
            line: src.slice(0, match.index + label.index).split('\n').length,
          });
        }
      }
    }
  }

  return offenders;
}

describe('icons inside primary buttons', () => {
  it('🔴 none hardcodes white', () => {
    const offenders = findOffenders();

    const OK = 'no icon inside a primary button hardcodes white';
    const actual = offenders.length === 0
      ? OK
      : [
          'These icons sit on the accent fill but hardcode white, while the label beside them',
          'comes from --accent-foreground. The two disagree whenever the accent is pale (an ink',
          'label) or lifted for dark mode. Use <AccentIcon> from components/ui/AccentIcon.tsx,',
          'which resolves the same colour the label uses:',
          ...offenders.map((o) => `  ${o.file}:${o.line}`),
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('AccentIcon exists and resolves its colour rather than taking one', () => {
    // If the wrapper stopped computing, every call site would silently render whatever the
    // default Ionicons colour is — black — and the check above would still pass.
    const source = fs.readFileSync(
      path.join(MOBILE_ROOT, 'components', 'ui', 'AccentIcon.tsx'), 'utf8'
    );

    expect(source).toContain('useAccentForeground');
    expect(source).toContain('color={accentForeground}');
    // It must NOT accept a colour prop, or a call site could reintroduce the bug through it.
    // Asserted as two separate substrings rather than one pattern: the generic argument is
    // `ComponentProps<typeof Ionicons>`, which contains `>` — and a `[^>]*` pattern
    // therefore stops early and never matches. That is the third time this session that a
    // `>`-terminated regex has quietly failed on JSX/TS generics.
    expect(source).toContain('Omit<');
    expect(source).toContain("'color'>");
  });

  it('is actually reading primary buttons, so a green result is not an empty search', () => {
    let iconsInPrimaryButtons = 0;

    for (const dir of SEARCH_DIRS) {
      for (const file of walk(path.join(MOBILE_ROOT, dir))) {
        const src = fs.readFileSync(file, 'utf8');
        for (const match of src.matchAll(/<HeroButton\b[\s\S]*?<\/HeroButton>/g)) {
          const block = match[0];
          const tag = block.slice(0, endOfOpeningTag(block, 0));
          if (tag.startsWith('<HeroButton.')) continue;
          const variant = /variant="([a-z-]+)"/.exec(tag);
          if (variant && variant[1] !== 'primary') continue;
          iconsInPrimaryButtons += (block.match(/<(?:Ionicons|AccentIcon)\b/g) ?? []).length;
        }
      }
    }

    expect(iconsInPrimaryButtons).toBeGreaterThan(50);
  });
});
