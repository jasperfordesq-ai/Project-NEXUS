// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Screens announce their title as a heading.
 *
 * 🔴 Why it matters. TalkBack and VoiceOver both let someone move by heading — it is the
 * main way a screen-reader member skips past furniture to the part they came for. The app
 * had twenty `accessibilityRole="header"` in total, and the screen TITLE was not one of
 * them anywhere: every screen read as an undifferentiated run of text, so there was nothing
 * to jump to and no way to tell where you had landed. Audit 2026-09-09, item 14.
 *
 * One line in `AppTopBar` fixes 134 screens at once, which is why that is the assertion
 * that matters here. The two section headings are the app's main menu and the feed, the
 * two screens with enough rows for jumping to be worth anything.
 */

import fs from 'fs';
import path from 'path';

const MOBILE_ROOT = path.join(__dirname, '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(MOBILE_ROOT, relative), 'utf8');
}

describe('heading semantics', () => {
  it('the shared top bar announces the screen title as a heading', () => {
    const source = read('components/ui/AppTopBar.tsx');
    // Same element that carries the title text, not a decorative sibling.
    expect(source).toMatch(/accessibilityRole="header"[\s\S]{0,300}\{title\}/);
  });

  it('the top bar is what nearly every screen uses, so one line covers them', () => {
    const screens = ['(modals)', '(tabs)'].flatMap((dir) =>
      fs
        .readdirSync(path.join(MOBILE_ROOT, 'app', dir))
        .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx') && name !== '_layout.tsx')
        .map((name) => read(path.join('app', dir, name))));

    const withTopBar = screens.filter((source) => source.includes('AppTopBar')).length;
    expect(withTopBar).toBeGreaterThan(120);
  });

  it('the main menu groups its rows under headings', () => {
    expect(read('app/(tabs)/profile.tsx')).toMatch(/accessibilityRole="header"[\s\S]{0,200}\{title\}/);
  });

  it('the feed announces its own heading', () => {
    expect(read('app/(tabs)/home.tsx')).toMatch(/accessibilityRole="header"[\s\S]{0,200}feed\.title/);
  });
});
