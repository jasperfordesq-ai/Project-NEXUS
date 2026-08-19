// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every modal screen must be declared in the root navigator.
 *
 * 🔴 Nine were not. `app/(modals)/` held nine files with no `<Stack.Screen>` entry in
 * `app/_layout.tsx`: achievements, feed-hashtag, feed-hashtags, feed-item-detail,
 * leaderboard, nexus-score, settings-blocked-users, settings-data-export,
 * settings-translation.
 *
 * Expo Router still renders an undeclared file — that is why nobody noticed. What it does
 * NOT do is apply the options its siblings declare, so those nine opened as plain stack
 * pushes: sliding in from the side instead of up, with no modal dismissal and no title.
 * Three of them (`settings-blocked-users`, `settings-data-export`, `settings-translation`)
 * were being pushed from the Settings screen the whole time.
 *
 * It got worse rather than better: when deep linking was extended, `app/+native-intent.ts`
 * began routing EXTERNAL links into six of the nine. A member tapping a link from an email
 * landed on a screen presented the wrong way round.
 *
 * A rendering test cannot catch this — the screen renders either way. Only the absence of a
 * declaration is observable, so this reads the source. Same approach as
 * `app/+native-intent.coverage.test.ts`.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(__dirname);
const MODALS_DIR = path.join(APP_DIR, '(modals)');
const ROOT_LAYOUT = path.join(APP_DIR, '_layout.tsx');

/** Modal route names that `_layout.tsx` declares. */
function declaredModals(): Set<string> {
  const source = fs.readFileSync(ROOT_LAYOUT, 'utf8');
  return new Set(
    [...source.matchAll(/name="\(modals\)\/([a-z0-9-]+)"/g)].map((m) => m[1]!)
  );
}

/** Modal screen files that exist on disk. */
function modalFiles(): string[] {
  return fs
    .readdirSync(MODALS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.tsx') && !e.name.includes('.test.'))
    .map((e) => e.name.replace(/\.tsx$/, ''))
    .sort();
}

describe('modal screen declarations', () => {
  it('🔴 declares every file in app/(modals)', () => {
    const declared = declaredModals();
    const files = modalFiles();

    const undeclared = files.filter((name) => !declared.has(name));

    const OK = 'every modal screen is declared in app/_layout.tsx';
    const actual = undeclared.length === 0
      ? OK
      : [
          'These modal screens exist but have no <Stack.Screen> entry in app/_layout.tsx.',
          'Expo Router will still render them, so nothing errors — they simply open as a',
          'plain stack push instead of a modal, with none of the options their siblings get.',
          'Add a declaration alongside the others:',
          ...undeclared.map((name) => `  (modals)/${name}`),
        ].join('\n');

    expect(actual).toBe(OK);
  });

  it('does not declare a screen that no longer exists', () => {
    // The other direction: a declaration whose file was deleted or renamed is dead config
    // that reads as coverage. Aliased entry points are real files, so they belong on disk.
    const files = new Set(modalFiles());
    const orphans = [...declaredModals()].filter((name) => !files.has(name)).sort();

    expect(orphans).toEqual([]);
  });

  it('reads a realistic number of screens, so a green result is not an empty search', () => {
    // If either scan silently matched nothing — a renamed directory, a changed attribute
    // spelling — both assertions above would pass while checking nothing.
    expect(modalFiles().length).toBeGreaterThan(100);
    expect(declaredModals().size).toBeGreaterThan(100);
  });

  it('🔴 declares every modal that a deep link can route into', () => {
    // The specific reason this matters now. `+native-intent.ts` maps external URLs onto
    // `/(modals)/…` paths; any target it names must be declared, or an emailed link opens a
    // wrongly-presented screen. Derived from the mapper's own source so the two cannot
    // drift apart.
    const intent = fs.readFileSync(path.join(APP_DIR, '+native-intent.ts'), 'utf8');
    const targets = new Set(
      [...intent.matchAll(/['"`]\/\(modals\)\/([a-z0-9-]+)/g)].map((m) => m[1]!)
    );
    expect(targets.size).toBeGreaterThan(10);

    const declared = declaredModals();
    const undeclaredTargets = [...targets].filter((name) => !declared.has(name)).sort();

    expect(undeclaredTargets).toEqual([]);
  });
});
