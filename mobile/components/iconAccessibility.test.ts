// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every screen imports `Ionicons` from the wrapper, not from `@expo/vector-icons`.
 *
 * 🔴 A screen reader was announcing the raw icon glyph before every label. Icons render as
 * a `<Text>` containing a private-use codepoint, Android puts that in the accessibility
 * tree, and a parent control's name is composed from its children — so the Feed's tab read
 * `content-desc="\uf58d, For You"` and a screen-reader user heard an unmapped symbol
 * before every label. Measured with TalkBack on 2026-08-23; after the change the same four
 * screens reported zero glyphs in any accessible name.
 *
 * One import line per file fixes every icon in it, which is why this is enforced at the
 * import rather than on each element. `components/ui/Icon.tsx` is the only file allowed to
 * import from `@expo/vector-icons`.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components', 'lib'];
const WRAPPER = path.normalize('components/ui/Icon.tsx');

function collectSources(dir: string, out: string[] = []): string[] {
  const abs = path.join(MOBILE_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectSources(rel, out);
      continue;
    }
    if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
    if (entry.name.includes('.test.')) continue;
    out.push(rel);
  }
  return out;
}

describe('decorative icons stay out of the accessibility tree', () => {
  const files = SEARCH_DIRS.flatMap((dir) => collectSources(dir));

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it('routes every Ionicons import through the wrapper', () => {
    const offenders = files
      .filter((file) => path.normalize(file) !== WRAPPER)
      .filter((file) =>
        fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8').includes("from '@expo/vector-icons'"),
      );

    expect(offenders).toEqual([]);
  });

  it('keeps the wrapper hiding icons by default', () => {
    const source = fs.readFileSync(path.join(MOBILE_ROOT, WRAPPER), 'utf8');
    expect(source).toContain('accessible={false}');
    expect(source).toContain('importantForAccessibility="no"');
    // Props spread AFTER the defaults, so a meaningful icon can still opt back in.
    expect(source).toMatch(/importantForAccessibility="no"\s*\{\.\.\.props\}/);
  });
});
