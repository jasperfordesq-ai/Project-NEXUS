// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for map-styles
 */

import { describe, it, expect, afterEach } from 'vitest';
import Gift from 'lucide-react/icons/gift';
import MapPin from 'lucide-react/icons/map-pin';
import { COMMUNITY_PIN_COLOUR, DARK_MAP_STYLES, pinStyleFor, resolveCssColour } from './map-styles';

describe('map-styles', () => {
  it('exports DARK_MAP_STYLES as an array', () => {
    expect(Array.isArray(DARK_MAP_STYLES)).toBe(true);
  });

  it('has at least one style entry', () => {
    expect(DARK_MAP_STYLES.length).toBeGreaterThan(0);
  });

  it('each entry has stylers array', () => {
    for (const style of DARK_MAP_STYLES) {
      expect(Array.isArray(style.stylers)).toBe(true);
      expect(style.stylers.length).toBeGreaterThan(0);
    }
  });

  it('contains geometry and water styles', () => {
    const elementTypes = DARK_MAP_STYLES
      .filter((s) => !s.featureType)
      .map((s) => s.elementType);
    expect(elementTypes).toContain('geometry');

    const waterStyles = DARK_MAP_STYLES.filter((s) => s.featureType === 'water');
    expect(waterStyles.length).toBeGreaterThan(0);
  });
});

describe('map pins in the site colours (warmth plan C3)', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty('--accent-strong');
  });

  it('gives each kind its own colour and picture', () => {
    expect(pinStyleFor('offer')).toEqual({ colour: '#059669', icon: Gift });
    expect(pinStyleFor('request').colour).toBe('#d97706');
    expect(pinStyleFor('member').colour).toBe('#e11d48');
    expect(new Set(['offer', 'request', 'group', 'member'].map((k) => pinStyleFor(k).colour)).size).toBe(4);
  });

  it('falls back to the community colour for anything without a kind', () => {
    expect(pinStyleFor(undefined)).toEqual({ colour: COMMUNITY_PIN_COLOUR, icon: MapPin });
    expect(pinStyleFor('no-such-kind').colour).toBe(COMMUNITY_PIN_COLOUR);
  });

  it('resolves a colour token for libraries that need a plain colour', () => {
    document.documentElement.style.setProperty('--accent-strong', '#123456');
    expect(resolveCssColour('var(--accent-strong)')).toBe('#123456');
    expect(resolveCssColour('#abcdef')).toBe('#abcdef');
    expect(resolveCssColour('var(--not-set)', '#000000')).toBe('#000000');
  });
});
