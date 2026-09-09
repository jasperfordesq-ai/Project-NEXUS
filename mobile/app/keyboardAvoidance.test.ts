// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every screen with a text field either keeps that field above the iOS keyboard, or is
 * recorded here with a reason it does not need to.
 *
 * 🔴 Why a scan, and why iOS specifically. Android is covered for free: the generated
 * manifest sets `android:windowSoftInputMode="adjustResize"` on the single activity, so the
 * window shrinks and the focused field stays visible on every screen in the app. iOS has no
 * equivalent — the keyboard is drawn OVER the window and each scroll view has to make room
 * for it. About a dozen screens therefore worked perfectly on the test devices, which are
 * Android, and hid the field the member was typing into on an iPhone. The wallet's transfer
 * amount and the marketplace offer amount were among them: the member could not see the
 * number they were entering before sending credits or money.
 *
 * This is exactly the shape of the pull-to-refresh gap (`pullToRefresh.test.ts`): nobody
 * decided to omit it, the question was simply never asked, and the app looked consistent
 * from any one screen because most screens happened to have it.
 *
 * Three things count as handling it:
 *   - `KeyboardAvoidingView`, the explicit wrapper (auth screens, chat, composers);
 *   - `automaticallyAdjustKeyboardInsets`, the iOS scroll-view prop that does the same job
 *     for a screen that already scrolls — inert on Android, so it is safe to add anywhere;
 *   - `BottomSheet`, which sets `keyboardBehavior="extend"` for the fields inside it.
 *
 * The allowlist is for screens where the fields genuinely cannot be covered, NOT for
 * screens nobody has got to yet. Adding an entry means writing down which field and why.
 */

import fs from 'fs';
import path from 'path';

const appDir = __dirname;
const SCREEN_DIRS = ['(modals)', '(tabs)', '(auth)'];

/** Screen file name → why the iOS keyboard cannot cover a field on it. */
const NO_KEYBOARD_AVOIDANCE: Record<string, string> = {
  chat: 'Wraps its composer in KeyboardAvoidingView already; the match below is on the inverted list, not a form.',
  messages: 'One search field, pinned at the top of the screen above every list row. The keyboard opens below it.',
  search: 'Same: a single search field at the top of the screen.',
  'marketplace-search': 'Same: a single search field at the top of the screen.',
  'marketplace-category': 'Same: a single search field at the top of the screen.',
  'marketplace-collections': 'Same: a single search field at the top of the screen.',
  'marketplace-map': 'Same: a single search field at the top of the screen.',
  'marketplace-tools': 'Every field is inside a BottomSheet, which extends for the keyboard.',
  'marketplace-orders': 'Every field is inside a BottomSheet, which extends for the keyboard.',
  'marketplace-shipping-options': 'Its one field is inside a BottomSheet.',
  'volunteering-detail': 'Its one field is inside a BottomSheet.',
  reviews: 'Its one field is inside a BottomSheet.',
  endorsements: 'Its fields are inside a BottomSheet.',
  'member-profile': 'Its fields are inside a BottomSheet.',
  'exchange-request-detail': 'Its fields are inside a BottomSheet.',
  'exchange-detail': 'Its fields are inside a BottomSheet.',
  'group-detail': 'Its composers are inside a BottomSheet.',
  volunteering: 'Its fields are inside a BottomSheet.',
  'profile-collections': 'Its one field is inside a BottomSheet.',
  resources: 'One search field at the top of the screen.',
  jobs: 'Search field at the top; the alert form carries automaticallyAdjustKeyboardInsets.',
  members: 'Re-export of the members tab.',
  groups: 'Re-export of the groups tab.',
  blog: 'One search field, pinned at the top of the screen above the list.',
  clubs: 'One search field, pinned at the top of the screen above the list.',
  courses: 'One search field, pinned at the top of the screen above the list.',
  'help-faqs': 'One search field, pinned at the top of the screen above the list.',
  organisations: 'One search field, pinned at the top of the screen above the list.',
  podcasts: 'One search field, pinned at the top of the screen above the list.',
  exchanges: 'One search field, pinned at the top of the screen above the list.',
  'event-attendance': 'One search field, pinned at the top of the attendee list.',
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

/** Screens that render at least one text field of their own. */
function formScreens(screens: Screen[]): Screen[] {
  return screens.filter(({ source }) => /<(Input|TextArea|TextInput|SearchInput|HeroInput)\b/.test(source));
}

function handlesKeyboard(source: string): boolean {
  return /KeyboardAvoidingView|automaticallyAdjustKeyboardInsets|<BottomSheet\b/.test(source);
}

describe('iOS keyboard avoidance', () => {
  const screens = screenFiles();
  const forms = formScreens(screens);

  it('finds the screens it is meant to police', () => {
    expect(forms.length).toBeGreaterThan(40);
  });

  it('every screen with a text field keeps it above the keyboard, or says why it need not', () => {
    const missing = forms
      .filter(({ route, source }) => !handlesKeyboard(source) && !NO_KEYBOARD_AVOIDANCE[route])
      .map(({ route }) => route);

    expect(missing).toEqual([]);
  });

  it('carries no allowlist entry for a screen that has since been fixed or deleted', () => {
    const routes = new Set(screens.map((screen) => screen.route));
    const stale = Object.keys(NO_KEYBOARD_AVOIDANCE).filter((route) => !routes.has(route));

    expect(stale).toEqual([]);
  });
});
