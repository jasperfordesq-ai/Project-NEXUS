// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 A screen that reads `?tab=` must honour every tab it has.
 *
 * `volunteering.tsx` accepted a `tab` parameter and compared it against ONE value:
 *
 *   const initialTab = params.tab === 'organisations' ? 'organisations' : 'opportunities';
 *
 * It has nine tabs. So eight of them — including `hours`, where a volunteer records the
 * time they gave — silently landed on Opportunities. Verified on a device on 2026-08-20:
 * `nexus://volunteering?tab=hours` opened the wrong tab and said nothing.
 *
 * This is the same family as the parameter-name mismatches in `deepLinkParams.test.ts`:
 * the link is accepted, the navigation succeeds, and the destination is wrong. Nothing
 * throws, so only looking finds it.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname);

function read(rel: string): string {
  return fs.readFileSync(path.join(APP_ROOT, rel), 'utf8');
}

describe('the volunteering hub honours every tab a link can name', () => {
  const source = read('(modals)/volunteering.tsx');

  it('declares its tab keys as a value, not only as a type', () => {
    expect(source).toMatch(/const TAB_KEYS: readonly TabKey\[\] = \[/);
  });

  it('keeps the type and the key list in step', () => {
    const typeLine = source.match(/type TabKey = ([^;]+);/);
    expect(typeLine).not.toBeNull();
    const fromType = [...typeLine![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    const listBlock = source.match(/const TAB_KEYS: readonly TabKey\[\] = \[([\s\S]*?)\];/);
    expect(listBlock).not.toBeNull();
    const fromList = [...listBlock![1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();

    // A tab in the type but not the list is a tab no link can reach.
    expect(fromList).toEqual(fromType);
    expect(fromType.length).toBeGreaterThanOrEqual(9);
  });

  it('validates the incoming tab against the whole list, not one value', () => {
    // 🔴 The exact shape of the original bug: a single === comparison against one tab.
    expect(source).not.toMatch(/params\.tab === '[a-z]+' \? '[a-z]+' : 'opportunities'/);
    expect(source).toMatch(/TAB_KEYS\.includes\(params\.tab as TabKey\)/);
  });
});
