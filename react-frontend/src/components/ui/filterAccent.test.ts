// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { FILTER_ACCENT_CLASSES, filterAccentClasses, type FilterAccent } from './filterAccent';

// Every accent a page already passes to PublicPageHero must exist here, plus the
// theme accent used by the Feed and 'violet'.
const REQUIRED: FilterAccent[] = ['accent', 'emerald', 'amber', 'blue', 'indigo', 'rose', 'violet'];

describe('filterAccent', () => {
  it('covers every accent the directory pages use', () => {
    for (const accent of REQUIRED) {
      expect(FILTER_ACCENT_CLASSES[accent]).toBeDefined();
    }
  });

  it('defaults to the theme accent', () => {
    expect(filterAccentClasses()).toBe(FILTER_ACCENT_CLASSES.accent);
    expect(filterAccentClasses('accent').applyButton).toContain('bg-accent');
  });

  it('keeps indigo an alias of the theme accent (PublicPageHero does the same)', () => {
    expect(filterAccentClasses('indigo')).toBe(FILTER_ACCENT_CLASSES.accent);
  });

  it('keeps Listings emerald and does not unify it with the theme accent', () => {
    const emerald = filterAccentClasses('emerald');
    expect(emerald.filtersButtonActive).toBe('bg-emerald-600 text-white shadow-sm');
    expect(emerald.chip).toContain('data-[selected=true]:bg-emerald-600');
    expect(emerald.applyButton).toBe('bg-emerald-600 text-white shadow-sm hover:bg-emerald-700');
    expect(emerald.appliedChip).toContain('bg-emerald-500/15');
    expect(emerald).not.toEqual(FILTER_ACCENT_CLASSES.accent);
  });

  it('exposes a complete literal class string for every slot (Tailwind cannot build names at runtime)', () => {
    for (const accent of REQUIRED) {
      const tone = FILTER_ACCENT_CLASSES[accent];
      for (const [slot, value] of Object.entries(tone)) {
        expect(value, `${accent}.${slot}`).toBeTruthy();
        expect(value, `${accent}.${slot} must not be interpolated`).not.toMatch(/\$\{|undefined/);
      }
    }
  });

  it('keeps applied chips on the AA-safe -800 light shade', () => {
    for (const accent of REQUIRED) {
      const { appliedChip } = FILTER_ACCENT_CLASSES[accent];
      if (appliedChip.includes('text-accent')) continue; // theme accent token
      expect(appliedChip, accent).toMatch(/text-[a-z]+-800/);
      expect(appliedChip, accent).toMatch(/dark:text-[a-z]+-300/);
    }
  });
});
