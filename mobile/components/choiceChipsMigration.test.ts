// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Option pickers are `ChoiceChips`, never a `TagGroup`.
 *
 * Measured on a device on 2026-09-09: eleven screens (Create Job, Create Course, Podcast
 * Studio, Create Event, Create Group, Create Marketplace Listing, Edit Listing, the support
 * contact form, three marketplace filter bars) built their option pickers on HeroUI Native's
 * `TagGroup size="sm"`. Each tag rendered about 20dp tall — under the WCAG 2.2 AA minimum
 * target of 24dp and far under Android's 48dp — and the selected state was a pale tint over
 * which every screen painted `contrastText(primary)`, white on most communities, so the
 * chosen option was white on pale and invisible. The owner reported exactly this.
 *
 * `components/ui/ChoiceChips.tsx` is the replacement (HeroUI `Button`, 44dp, full accent
 * fill). This test keeps the count of `TagGroup` importers at ZERO so the small picker cannot
 * creep back in one screen at a time. If a genuine removable-tag list ever needs `TagGroup`
 * (its actual purpose: tags with an `ItemRemoveButton`), add that file to the allowlist WITH
 * the reason — a selection picker is never the reason.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..');
const SEARCH_DIRS = ['app', 'components'];

/** Files allowed to import TagGroup, each with the reason. None today. */
const ALLOWLIST: Record<string, string> = {};

function collectTsx(dir: string, out: string[] = []): string[] {
  const abs = path.join(MOBILE_ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      collectTsx(rel, out);
      continue;
    }
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;
    out.push(rel);
  }
  return out;
}

function importsTagGroup(source: string): boolean {
  const matches = source.matchAll(/import \{([^}]*)\} from 'heroui-native';/g);
  for (const match of matches) {
    const names = match[1].split(',').map((name) => name.trim().split(/\s+as\s+/)[0]);
    if (names.includes('TagGroup')) return true;
  }
  return false;
}

describe('option pickers use ChoiceChips, not TagGroup', () => {
  const files = SEARCH_DIRS.flatMap((dir) => collectTsx(dir));

  it('finds files to scan', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('has no TagGroup importer outside the allowlist', () => {
    const offenders = files
      .filter((file) => importsTagGroup(fs.readFileSync(path.join(MOBILE_ROOT, file), 'utf8')))
      .map((file) => file.replace(/\\/g, '/'))
      .filter((file) => !(file in ALLOWLIST));

    expect(offenders).toEqual([]);
  });

  it('keeps every allowlisted file on disk with a reason', () => {
    for (const [file, reason] of Object.entries(ALLOWLIST)) {
      expect(fs.existsSync(path.join(MOBILE_ROOT, file))).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
    }
  });
});
