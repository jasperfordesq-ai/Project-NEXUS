// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every screen that loads data into a scrollable view can be pulled down to reload it, or
 * is recorded here with a reason it cannot.
 *
 * 🔴 Why a scan and not a per-screen test. About twenty screens shipped without the
 * gesture — course detail, the course player, all five ideation screens, job detail, the
 * job pipeline, a help article, the marketplace seller tools — and none of them was a
 * deliberate decision. Nobody omitted pull-to-refresh; the question was simply never asked
 * when the screen was written, because nothing asked it. Seventy-five other screens had it,
 * which is exactly why the gap was invisible: the app looked consistent from any one screen.
 *
 * A member on a train reads a job detail page, comes out of a tunnel, and pulls down. On
 * these screens nothing happened at all — no gesture, no spinner, no fresh data — and the
 * only way to see the current state was to leave the screen and come back.
 *
 * The allowlist below is for screens where the gesture would be WRONG, not for screens
 * nobody has got to yet. Every entry is a form: a pull would refetch the server's copy over
 * what the member is part-way through typing.
 */

import fs from 'fs';
import path from 'path';

const appDir = __dirname;
const SCREEN_DIRS = ['(modals)', '(tabs)'];

/** Screen file name → why a pull-to-refresh gesture is wrong on it. */
const NO_PULL_TO_REFRESH: Record<string, string> = {
  'edit-exchange': 'A form. Refetching would overwrite half-finished edits with the server copy.',
  'group-invite': 'One card and one button, vertically centred. There is nothing to bring up to date.',
  'match-preferences': 'A form of toggles and sliders; a pull would discard unsaved choices.',
  'new-exchange': 'A form. Nothing on it comes from the server after the first load.',
  'new-volunteering': 'A form. Same reason.',
  settings: 'A form of toggles bound to unsaved local state; a pull would revert them.',
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

/** Screens that fetch from the API AND render something scrollable. */
function dataScreens(screens: Screen[]): Screen[] {
  return screens.filter(({ source }) =>
    /\buseApi\(|\busePaginatedApi\(/.test(source) && /<(ScrollView|FlatList|SectionList)\b/.test(source));
}

describe('pull to refresh', () => {
  const screens = screenFiles();
  const data = dataScreens(screens);

  it('finds the screens it is meant to police', () => {
    expect(data.length).toBeGreaterThan(60);
  });

  it('every data screen can be pulled down, or says why it cannot', () => {
    const missing = data
      .filter(({ route, source }) => !source.includes('refreshControl') && !NO_PULL_TO_REFRESH[route])
      .map(({ route }) => route);

    expect(missing).toEqual([]);
  });

  it('only excuses screens that exist and really have no refresh control', () => {
    const byRoute = new Map(screens.map((screen) => [screen.route, screen]));
    const wrong = Object.keys(NO_PULL_TO_REFRESH).filter((route) => {
      const screen = byRoute.get(route);
      // A stale entry, or one that has since grown the gesture and should be removed.
      return !screen || screen.source.includes('refreshControl');
    });

    expect(wrong).toEqual([]);
  });

  /**
   * 🔴 `useApi.refresh()` sets `isLoading` back to true. A screen whose loading branch reads
   * `isLoading ?` rather than `isLoading && <nothing loaded yet>` therefore throws its
   * content away for a full-page spinner on every pull, and scrolls the member back to the
   * top of a screen they were reading.
   *
   * This check is deliberately narrow: it only looks at a guard sitting at the START of a
   * screen's body, immediately after the top bar, which is the shape that blanks a page. A
   * section-level `{isLoading ? <Spinner/> : …}` inside a card is correct and common, and an
   * earlier, cruder version of this test flagged twenty-six of those. A test that reports
   * correct code and broken code identically is worse than no test.
   */
  it('never blanks a whole screen to a spinner during a pull', () => {
    const blanking: string[] = [];
    for (const { route, source } of data) {
      if (!source.includes('refreshControl')) continue;
      // "…</AppTopBar-ish line/>" then, within a few lines, a bare isLoading ternary.
      const afterTopBar = source.split(/<AppTopBar[\s\S]*?\/>/)[1];
      if (!afterTopBar) continue;
      const head = afterTopBar.slice(0, 400);
      if (/\{\s*[A-Za-z]*\.?[iI]sLoading\s*\?/.test(head)) blanking.push(route);
    }

    expect(blanking).toEqual([]);
  });
});
