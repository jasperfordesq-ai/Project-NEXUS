// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * What the app is allowed to hide from itself.
 *
 * 🔴 `LogBox.ignoreLogs` in app/_layout.tsx is unusually load-bearing here, for a reason
 * written up in that file: a LogBox banner sits over the BOTTOM of the screen, on top of
 * the tab bar, and swallows the tap. On 2026-08-24 that cost four of the nine nightly
 * device flows while every unit test passed. So there is standing pressure to silence any
 * warning that appears — and that pressure is exactly what makes an entry here dangerous.
 *
 * Three entries were removed on 2026-09-09 and this test keeps them out:
 *
 *   'Each child in a list should have a unique'   — React's duplicate-key warning
 *   'Encountered two children with the same key'  — the same fault, second wording
 *   'VirtualizedLists should never be nested'
 *
 * The first two were the ONLY signal the platform gives for a duplicated row, and
 * `usePaginatedApi` appended pages without de-duplicating them, so cursor pagination over
 * a re-ordering list produced duplicate keys routinely. The warning was off, so it went
 * unnoticed. The hook now de-duplicates; if the warning fires again it is a real defect and
 * a member is seeing a row twice or losing one.
 *
 * The third was checked, not assumed: every ScrollView nested near a FlatList in this app
 * is horizontal inside a vertical list's header, which React Native does not warn about,
 * and the two vertical ones are inside bottom sheets rendering `.map()` output. Nothing in
 * the app can raise it.
 *
 * Adding an entry here is a decision to stop seeing a class of fault. Write down why.
 */

import fs from 'fs';
import path from 'path';

const layoutSource = fs.readFileSync(path.join(__dirname, '_layout.tsx'), 'utf8');

/** The substrings `LogBox.ignoreLogs([...])` is allowed to contain, and why each is there. */
const PERMITTED: Record<string, string> = {
  'expo-notifications': 'Known and accepted library warning, documented in _layout.tsx.',
  'Non-serializable values were found in the navigation state':
    'React Navigation warns about function params the app passes deliberately.',
  'Value being stored in SecureStore is larger than 2048 bytes':
    'The session payload genuinely exceeds the advisory size and stores fine; a real failure is reported to Sentry instead.',
};

/** Warnings that must never be suppressed again, and what each one would be hiding. */
const FORBIDDEN: Record<string, string> = {
  'Each child in a list should have a unique': 'a duplicated row in a paginated list',
  'Encountered two children with the same key': 'a duplicated row in a paginated list',
  'VirtualizedLists should never be nested': 'a list nested inside a scroll view of the same orientation',
};

function suppressedEntries(): string[] {
  const match = layoutSource.match(/LogBox\.ignoreLogs\(\[([\s\S]*?)\]\)/);
  if (!match) return [];
  // Comments inside the array explain individual entries and contain apostrophes of their
  // own, which would otherwise be read as string delimiters.
  const withoutComments = match[1].replace(/\/\/[^\n]*/g, '');
  return Array.from(withoutComments.matchAll(/'((?:[^'\\]|\\.)*)'/g)).map((entry) => entry[1]);
}

describe('LogBox suppressions', () => {
  it('finds the suppression list it is meant to police', () => {
    expect(suppressedEntries().length).toBeGreaterThan(0);
  });

  it('never silences a warning that would reveal a duplicated or nested list', () => {
    const entries = suppressedEntries();
    const reintroduced = Object.keys(FORBIDDEN).filter((warning) =>
      entries.some((entry) => entry.includes(warning) || warning.includes(entry)));

    expect(reintroduced).toEqual([]);
  });

  it('suppresses nothing that has not been written down here', () => {
    const undocumented = suppressedEntries().filter((entry) => !(entry in PERMITTED));

    expect(undocumented).toEqual([]);
  });

  it('does not silence every log outside the device-test harness', () => {
    // `ignoreAllLogs` is deliberate in the E2E harness and nowhere else.
    const ignoreAll = layoutSource.match(/LogBox\.ignoreAllLogs\([^)]*\)/g) ?? [];
    expect(ignoreAll).toHaveLength(1);
    expect(layoutSource).toMatch(/EXPO_PUBLIC_E2E === '1'[\s\S]{0,200}LogBox\.ignoreAllLogs/);
  });
});
