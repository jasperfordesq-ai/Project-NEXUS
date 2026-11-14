// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One way to say a member's level (B1 walk 7.3, 13 Nov 2026).
 *
 * The members list said "Lv. 2" (common.level_short) and the profile said
 * "Lvl 2" (profile.level) — two spellings of the same thing. Both chips now
 * say it the same way, in the language's plain word, in all eleven languages.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LANGS = ['ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'];

function load(lang: string, ns: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(__dirname, `../../../public/locales/${lang}/${ns}.json`), 'utf8'));
}

describe('level wording', () => {
  it.each(LANGS)('the members list and the profile say a level the same way (%s)', (lang) => {
    const members = load(lang, 'common').level_short;
    const profile = load(lang, 'profile').level;
    expect(typeof members).toBe('string');
    expect(members).toBe(profile);
    expect(members).toContain('{{level}}');
  });

  it('uses the plain word in English, not an abbreviation', () => {
    expect(load('en', 'common').level_short).toBe('Level {{level}}');
  });
});
