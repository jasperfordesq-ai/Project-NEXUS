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
 * Native SafeAreaView ignores a JavaScript inset-provider override. The shell reserves
 * the measured banner height as physical space around the navigator (DN-068), while
 * screens keep their normal safe-area handling. These structural checks complement
 * the Android large-text screenshots; they cannot prove native geometry themselves.
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
      Measure variable-height text, reserve that height around the navigator, and
      anchor the banner below the status area without adding that area twice.
    */
    expect(layoutSource).toContain('setOfflineBannerHeight(event.nativeEvent.layout.height)');
    expect(layoutSource).toMatch(/<View style=\{\{ flex: 1, paddingTop: offlineBannerHeight \}\}>\s*<RootNavigator\s*\/>/);
    expect(layoutSource).toContain("position: 'absolute', top: insets.top");
    expect(layoutSource).not.toContain('SafeAreaInsetsContext.Provider');
  });
});
