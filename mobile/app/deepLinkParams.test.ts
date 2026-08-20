// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A deep link that routes correctly and then renders "not found".
 *
 * `+native-intent.coverage.test.ts` already proves every deep link maps to a screen that
 * exists. That is not enough: a link can hand the right screen a parameter under the wrong
 * NAME, and the result is a perfectly healthy navigation into an empty page. Nothing
 * fails, nothing logs, and the screen looks broken rather than mis-addressed.
 *
 * Found on a device on 2026-08-20, walking a two-account volunteering journey:
 *
 *   - `nexus://volunteering/org/109` supplied `orgId`; the dashboard reads `id`. Every
 *     deep link to an organisation dashboard rendered "Organisation not found." — for an
 *     organisation the signed-in member owned. In-app navigation had always passed `id`,
 *     so tapping around the app could never reveal it.
 *   - `nexus://marketplace/category/<slug>` supplied `slug`; the screen read a numeric
 *     `id`. Fixed by resolving the slug, because a slug is what the outside world holds —
 *     it is what appears in a shared web link.
 *   - `nexus://blog/<slug>` supplied `slug`; blog-post.tsx reads `id` and treats its value
 *     as a slug. The parameter name was the only thing wrong.
 *
 * This test compares what each mapping SUPPLIES against what the target screen READS.
 *
 * 🔴 Two traps it must avoid, both hit while writing it:
 *   1. A screen file may be a re-export (`edit-marketplace-listing.tsx` is one line:
 *      `export { default } from './new-marketplace-listing'`). Following it is required or
 *      the test reports a defect that does not exist.
 *   2. A screen using untyped `useLocalSearchParams()` declares no names, so nothing can
 *      be concluded. Those are skipped rather than flagged.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname);

/**
 * Mappings whose extra parameter is deliberately advisory — the screen does not read it
 * and does not need to. Each entry needs a reason, so this cannot become a dumping ground.
 */
const ALLOWED_UNREAD: Record<string, string> = {
  // `/jobs/alerts` opens the jobs screen; the tab it should land on is not wired up yet.
  // Recorded rather than silently accepted — see PRODUCTION_READINESS.md §9.8.
  '/(modals)/jobs:view': 'jobs.tsx has no tab parameter yet; the link opens the default tab',
};

function readIntent(): string {
  return fs.readFileSync(path.join(APP_ROOT, '+native-intent.ts'), 'utf8');
}

/** Resolve a route to its screen source, following single-line re-exports. */
function screenSource(route: string, depth = 0): string | null {
  if (depth > 3) return null;
  const rel = route.replace(/^\//, '');
  for (const candidate of [
    path.join(APP_ROOT, `${rel}.tsx`),
    path.join(APP_ROOT, rel, 'index.tsx'),
  ]) {
    if (!fs.existsSync(candidate)) continue;
    const src = fs.readFileSync(candidate, 'utf8');
    const reExport = src.match(/export\s*\{\s*default\s*\}\s*from\s*'([^']+)'/);
    if (reExport) {
      const target = path.posix.join(path.posix.dirname(rel), reExport[1].replace(/^\.\//, ''));
      return screenSource(`/${target}`, depth + 1);
    }
    return src;
  }
  return null;
}

function paramsRead(src: string): { names: Set<string>; untyped: boolean } {
  const names = new Set<string>();
  for (const block of src.matchAll(/useLocalSearchParams<\{([^}]*)\}>/g)) {
    for (const name of block[1].matchAll(/(\w+)\s*\??\s*:/g)) names.add(name[1]);
  }
  return { names, untyped: /useLocalSearchParams\(\s*\)/.test(src) };
}

describe('deep links hand screens parameters they actually read', () => {
  const mappings = [...readIntent().matchAll(/appendParams\(\s*'([^']+)'\s*,\s*(\{[^}]*\}|params)\s*\)/g)];

  it('finds the mappings at all, so a silent zero cannot pass', () => {
    expect(mappings.length).toBeGreaterThan(50);
  });

  it('supplies no parameter name the target screen ignores', () => {
    const problems: string[] = [];

    for (const [, route, arg] of mappings) {
      if (arg === 'params') continue;
      const supplied = [...arg.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).filter((n) => n !== 'params');
      if (!supplied.length) continue;

      const src = screenSource(route);
      if (src === null) {
        problems.push(`${route} — no screen source found`);
        continue;
      }

      const { names, untyped } = paramsRead(src);
      if (untyped) continue;

      for (const name of supplied) {
        if (names.has(name)) continue;
        if (ALLOWED_UNREAD[`${route}:${name}`]) continue;
        problems.push(`${route} supplies "${name}" but the screen reads [${[...names].sort().join(', ')}]`);
      }
    }

    expect(problems).toEqual([]);
  });
});
