// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { THEME_ICON_KEYS, THEME_ICONS, guessThemeIconKey, themeIconFor } from './themeIcons';

describe('theme pictures', () => {
  it('offers exactly the pictures the server accepts', () => {
    const php = readFileSync(resolve(__dirname, '../../../app/Support/Categories/ThemeIcons.php'), 'utf8');
    const block = php.slice(php.indexOf('ALLOWED = ['), php.indexOf('];', php.indexOf('ALLOWED = [')));
    const serverKeys = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(serverKeys.length).toBeGreaterThan(10);
    expect([...THEME_ICON_KEYS].sort()).toEqual([...serverKeys].sort());
    for (const key of THEME_ICON_KEYS) expect(THEME_ICONS[key]).toBeTruthy();
  });

  it("guesses a picture from a theme's name", () => {
    expect(guessThemeIconKey('Gardening')).toBe('garden');
    expect(guessThemeIconKey('lifts-and-transport')).toBe('transport');
    expect(guessThemeIconKey('Cooking & Baking')).toBe('food');
    expect(guessThemeIconKey('Computer help')).toBe('technology');
    expect(guessThemeIconKey('Pet sitting')).toBe('pets');
    expect(guessThemeIconKey('DIY and home repairs')).toBe('repairs');
    expect(guessThemeIconKey('Tutoring')).toBe('learning');
  });

  it('gives the themes in the local copy of hOUR Timebank a picture', () => {
    expect(guessThemeIconKey('community')).toBe('care');
    expect(guessThemeIconKey('creative-arts')).toBe('arts');
    expect(guessThemeIconKey('education-and-tutoring')).toBe('learning');
    expect(guessThemeIconKey('health-and-wellbeing')).toBe('care');
    expect(guessThemeIconKey('home-and-garden')).toBe('garden');
    expect(guessThemeIconKey('professional-services')).toBe('office');
    expect(guessThemeIconKey('technology-support')).toBe('technology');
    expect(guessThemeIconKey('transport')).toBe('transport');
  });

  it('matches whole words, not letters inside other words', () => {
    // "art" must not match "party" or "start"; "car" must not match "care".
    expect(guessThemeIconKey('Party planning')).not.toBe('arts');
    expect(guessThemeIconKey('Care and companionship')).not.toBe('transport');
  });

  it('guesses nothing for a name it does not recognise', () => {
    expect(guessThemeIconKey('Miscellaneous')).toBeNull();
    expect(guessThemeIconKey('')).toBeNull();
    expect(guessThemeIconKey(null)).toBeNull();
  });

  it("uses the administrator's choice before any guess", () => {
    expect(themeIconFor({ icon: 'music', slug: 'gardening', name: 'Gardening' })).toBe(THEME_ICONS.music);
  });

  it('guesses from the slug, which stays the same in every language', () => {
    expect(themeIconFor({ icon: null, slug: 'gardening', name: 'Jardinería' })).toBe(THEME_ICONS.garden);
  });

  it('ignores a choice that is not one of the pictures', () => {
    expect(themeIconFor({ icon: 'rocket', slug: 'gardening', name: 'Gardening' })).toBe(THEME_ICONS.garden);
    expect(themeIconFor({ icon: 'rocket', slug: 'misc', name: 'Misc' })).toBeNull();
  });
});
