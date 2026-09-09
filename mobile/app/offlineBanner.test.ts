// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The offline banner is mounted once, for the whole app.
 *
 * 🔴 It used to be mounted by hand, screen by screen: fourteen screens out of a hundred and
 * seventy had it. On the other hundred and fifty-six a lost connection was indistinguishable
 * from a server fault — the member was told "something went wrong" while the real answer was
 * "you have no signal", which is the one failure they can do something about. Audit
 * 2026-09-09, item 8.
 *
 * 🔴 The inset override is the part that must not be lost. Screens position their content
 * with `insets.top`, so a banner drawn over the window would sit on top of the back button
 * of every screen behind it. `ThemedShell` adds the banner's measured height to the top
 * inset it reports to everything below, so each screen starts underneath it — as if the
 * status bar had grown. Without that, this change would trade one defect for a worse one.
 */

import fs from 'fs';
import path from 'path';

const appDir = __dirname;
const SCREEN_DIRS = ['(modals)', '(tabs)', '(auth)'];
const layoutSource = fs.readFileSync(path.join(appDir, '_layout.tsx'), 'utf8');

function screenSources(): { route: string; source: string }[] {
  return SCREEN_DIRS.flatMap((dir) =>
    fs
      .readdirSync(path.join(appDir, dir))
      .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
      .map((name) => ({
        route: `${dir}/${name}`,
        source: fs.readFileSync(path.join(appDir, dir, name), 'utf8'),
      })),
  );
}

describe('offline banner', () => {
  it('is mounted once, in the app shell', () => {
    const mounts = layoutSource.match(/<OfflineBanner\s*\/>/g) ?? [];
    expect(mounts).toHaveLength(1);
  });

  it('is not mounted per screen any more', () => {
    const stillMounting = screenSources()
      .filter(({ source }) => source.includes('OfflineBanner'))
      .map(({ route }) => route);

    expect(stillMounting).toEqual([]);
  });

  it('pushes screens down instead of covering them', () => {
    /*
      Three things together, and all three are needed: the height is measured rather than
      assumed (the banner's text grows with the OS text-size setting), it is added to the
      top inset, and that inset is handed to the subtree through the safe-area context so
      every screen's own SafeAreaView picks it up.
    */
    expect(layoutSource).toContain('onLayout=');
    expect(layoutSource).toContain('setOfflineBannerHeight');
    expect(layoutSource).toContain('top: insets.top + offlineBannerHeight');
    expect(layoutSource).toMatch(/SafeAreaInsetsContext\.Provider value=\{shellInsets\}/);
  });
});
