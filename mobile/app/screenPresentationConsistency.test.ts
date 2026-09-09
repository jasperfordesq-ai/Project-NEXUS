// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A screen that exists at two routes is always linked through one of them.
 *
 * 🔴 The defect this pins. Three screens live in `app/(tabs)/` and are ALSO re-exported from
 * `app/(modals)/` — `groups`, `members` and `search`. The two routes render the same
 * component but not in the same place: the `(tabs)` route renders inside the tab navigator,
 * so the tab bar is drawn with none of its five tabs highlighted, while the `(modals)` route
 * renders in the root stack as a sheet with no bar at all.
 *
 * Links were split between the two. Groups was reached by two `(tabs)` links and five
 * `(modals)` ones, members by one and six. So the same screen looked different depending on
 * which button the member had pressed, which reads as a glitch rather than a choice.
 * Audit 2026-09-09, item 12.
 *
 * 🔴 What is deliberately NOT done here. `events` and `explore` are also hidden from the tab
 * bar with `href: null` and also render with no tab highlighted, but they have no `(modals)`
 * twin and their deep links (`app/+native-intent.ts`) and route-gating entries name the
 * `(tabs)` form. Giving them one means moving files and rewriting those tables — a
 * navigation change that cannot be checked without a device, and one that overlaps the
 * owner's open decision about whether content screens should be sheets at all. Left alone on
 * purpose, and recorded rather than half-done.
 */

import fs from 'fs';
import path from 'path';

const APP_DIR = __dirname;

/** Screens whose `(modals)` file is a re-export of the `(tabs)` implementation. */
const DUPLICATED = ['groups', 'members', 'search'];

function sourceFiles(dir: string): { relative: string; source: string }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return [];
    return [{
      relative: path.relative(APP_DIR, full).split(path.sep).join('/'),
      source: fs.readFileSync(full, 'utf8'),
    }];
  });
}

const files = [
  ...sourceFiles(path.join(APP_DIR, '(modals)')),
  ...sourceFiles(path.join(APP_DIR, '(tabs)')),
  ...sourceFiles(path.join(APP_DIR, '..', 'components')),
];

describe('screens that exist at two routes', () => {
  it.each(DUPLICATED)('%s is still a re-export, not a second implementation', (route) => {
    const modalFile = fs.readFileSync(path.join(APP_DIR, '(modals)', `${route}.tsx`), 'utf8');
    // A real second copy would be the worse version of this problem: two screens to fix.
    expect(modalFile).toMatch(/export \{ default \} from|export default \w+;/);
    expect(modalFile.split('\n').length).toBeLessThan(20);
  });

  it.each(DUPLICATED)('nothing links to the (tabs) copy of %s', (route) => {
    const offenders = files
      .filter(({ source }) => source.includes(`'/(tabs)/${route}'`))
      .map(({ relative }) => relative);

    expect(offenders).toEqual([]);
  });

  it('the tab bar still hides every screen that is not one of its five', () => {
    // The `href: null` entries are what keep these out of the bar. Removing one without
    // moving its file out of (tabs) would silently add a sixth tab.
    const layout = fs.readFileSync(path.join(APP_DIR, '(tabs)', '_layout.tsx'), 'utf8');
    for (const route of ['explore', 'search', 'groups', 'members', 'events']) {
      expect(layout).toContain(`<Tabs.Screen name="${route}" options={{ href: null }} />`);
    }
  });
});
