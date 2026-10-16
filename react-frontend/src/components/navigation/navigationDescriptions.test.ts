// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import en from '../../../public/locales/en/common.json';
import { NAVIGATION_DESTINATIONS, MORE_DESKTOP_SECTIONS } from './navigationRegistry';

const MAX = 45;

describe('More menu descriptions', () => {
  it('keeps every More-group description at or under 45 characters in English', () => {
    const offenders: string[] = [];
    for (const d of NAVIGATION_DESTINATIONS) {
      const desktop = (d.placements as { desktop?: readonly { section: string }[] }).desktop ?? [];
      if (!desktop.some(p => (MORE_DESKTOP_SECTIONS as readonly string[]).includes(p.section))) continue;
      if (!('descriptionKey' in d) || !d.descriptionKey) continue;
      const key = d.descriptionKey.replace(/^nav_desc\./, '');
      const text = (en.nav_desc as Record<string, string>)[key] ?? '';
      if (text.length > MAX) offenders.push(`${d.id}: "${text}" (${text.length})`);
    }
    expect(offenders).toEqual([]);
  });
});
