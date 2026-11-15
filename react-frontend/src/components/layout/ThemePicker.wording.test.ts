// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The appearance picker in the top bar speaks the reader's language.
 *
 * Until 15 Nov 2026 its title and its "Light" / "Dark" / "System" names were
 * English in eight of the eleven languages, and the accent colours were read
 * out to screen readers by their English code names. The key-set checks could
 * not see either: every key was present, only the value was English.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS } from '@/lib/accentPresets';

const LOCALES = ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt'] as const;

type Wording = Record<string, Record<string, unknown>>;

function read(locale: string, namespace: string): Wording {
  return JSON.parse(readFileSync(`public/locales/${locale}/${namespace}.json`, 'utf8')) as Wording;
}

const english = read('en', 'common').theme_picker as Record<string, string>;

describe('appearance picker wording', () => {
  // "System" is left out on purpose: it is the same word in German.
  it.each(LOCALES)('%s: the title and the light and dark names are not left in English', (locale) => {
    const picker = read(locale, 'common').theme_picker as Record<string, string>;
    for (const key of ['title', 'scheme_light', 'scheme_dark']) {
      expect(picker[key], `${locale} ${key}`).toBeTruthy();
      expect(picker[key], `${locale} ${key}`).not.toBe(english[key]);
    }
    expect(picker.scheme_system, `${locale} scheme_system`).toBeTruthy();
  });

  it.each(['en', ...LOCALES])('%s: every accent colour has a name to read out', (locale) => {
    const names = (read(locale, 'settings').appearance_prefs?.color_names ?? {}) as Record<string, string>;
    expect(Object.keys(names).sort()).toEqual(ACCENT_PRESETS.map((preset) => preset.name).sort());
    for (const preset of ACCENT_PRESETS) {
      expect(names[preset.name]?.trim(), `${locale} ${preset.name}`).toBeTruthy();
    }
  });
});
