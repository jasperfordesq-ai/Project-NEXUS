// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A screen that fetches one record by an id from the URL must tell a REFUSAL apart from a
 * FAILURE, or be listed here with a reason it need not.
 *
 * 🔴 Why this keeps happening. The natural way to write a loader — `catch { setFailed(true) }`,
 * or `error ? <ErrorState onRetry={refresh} />` — throws the status away before anyone can
 * look at it. So a 403 ("you are not the organiser") and a 500 ("the database fell over")
 * render identically: "Couldn't load this — Try again". One of those buttons works. The
 * other gives the same answer for ever, and the member is left believing the app is broken
 * when the server understood them perfectly and said no.
 *
 * A record screen is the place it matters, because a record is the thing a member can be
 * refused: a group they were removed from, a course they are not enrolled on, an event that
 * was cancelled, a listing that is not theirs to edit, an opportunity that was withdrawn.
 * A LIST screen is different — route gating already covers a module a community has
 * switched off — which is why an earlier sweep's count of 56 over-reported so badly.
 *
 * `lib/api/refusal.ts` holds the one list of statuses. Screens must ask it rather than
 * writing `=== 403` inline, or the two answers drift.
 */

import fs from 'fs';
import path from 'path';

const appDir = __dirname;
const SCREEN_DIRS = ['(modals)', '(tabs)'];

/** Screen → why it does not need to tell a refusal from a failure. */
const NO_REFUSAL_BRANCH: Record<string, string> = {
  'marketplace-seller':
    'Its only Retry is the stale-data notice, which is shown solely when a profile is already on screen. A seller who cannot be loaded gets an empty state with no retry at all.',
  'marketplace-coupon-detail':
    'Its failure action is "Back to coupons", not a retry, so there is no button that cannot work.',
};

interface Screen {
  route: string;
  source: string;
}

function screenFiles(): Screen[] {
  return SCREEN_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(appDir, dir))
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx') && name !== '_layout.tsx')
      .map((name) => ({
        route: name.replace(/\.tsx$/, ''),
        source: fs.readFileSync(path.join(appDir, dir, name), 'utf8'),
      })),
  );
}

/** Fetches a record named by the URL, and offers a retry when that fetch fails. */
function recordScreensOfferingRetry(screens: Screen[]): Screen[] {
  return screens.filter(({ source }) =>
    /useLocalSearchParams<\{[^}]*\b(id|slug|showSlug|episodeSlug|token|orderId)\b/.test(source)
    && /\buseApi\(|\busePaginatedApi\(/.test(source)
    && /onRetry=|actionLabel=\{[^}]*retry|buttons\.retry/i.test(source));
}

describe('telling a refusal from a failure', () => {
  const screens = screenFiles();
  const records = recordScreensOfferingRetry(screens);

  it('finds the screens it is meant to police', () => {
    expect(records.length).toBeGreaterThan(15);
  });

  it('every record screen that offers a retry knows what a refusal is', () => {
    const blind = records
      .filter(({ route, source }) => !source.includes('@/lib/api/refusal') && !NO_REFUSAL_BRANCH[route])
      .map(({ route }) => route);

    expect(blind).toEqual([]);
  });

  it('only excuses screens that exist and really have no refusal branch', () => {
    const byRoute = new Map(screens.map((screen) => [screen.route, screen]));
    const wrong = Object.keys(NO_REFUSAL_BRANCH).filter((route) => {
      const screen = byRoute.get(route);
      return !screen || screen.source.includes('@/lib/api/refusal');
    });

    expect(wrong).toEqual([]);
  });

  /**
   * 🔴 The statuses live in one place. A screen that writes its own
   * `401 || 403 || 404` chain is a second opinion that can drift from the first — and 404
   * is the one most often left out, though it is how an owner-scoped endpoint usually says
   * "not yours". Six screens carried such a chain before this was written.
   *
   * A SINGLE comparison is fine and is deliberately not flagged: inside a branch that has
   * already decided this is a refusal, `errorStatus === 403` is how a screen chooses
   * between "not shared with you" and "no longer here", which is better wording, not a
   * second list.
   */
  it('nobody hand-writes the refusal status list', () => {
    const chain = /errorStatus\s*===\s*(?:401|403|404)\s*\|\|[\s\S]{0,80}?errorStatus\s*===\s*(?:401|403|404)/;
    const handRolled = screens.filter(({ source }) => chain.test(source)).map(({ route }) => route);

    expect(handRolled).toEqual([]);
  });
});
