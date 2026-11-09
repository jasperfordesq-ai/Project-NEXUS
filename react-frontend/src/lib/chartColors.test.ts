// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { CHART_COLORS, CHART_COLOR_MAP, CHART_TOKEN_COLORS, chartColorsFor, chartTokenColor } from './chartColors';

describe('CHART_COLORS', () => {
  it('is a non-empty array', () => {
    expect(Array.isArray(CHART_COLORS)).toBe(true);
    expect(CHART_COLORS.length).toBeGreaterThan(0);
  });

  it('contains only valid hex color strings', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i;
    for (const color of CHART_COLORS) {
      expect(color).toMatch(hexPattern);
    }
  });

  it('contains 8 colors', () => {
    expect(CHART_COLORS).toHaveLength(8);
  });

  it('has indigo as the first color', () => {
    expect(CHART_COLORS[0]).toBe('#6366f1');
  });
});

describe('CHART_COLOR_MAP', () => {
  it('contains all required semantic color keys', () => {
    const requiredKeys = ['primary', 'secondary', 'success', 'warning', 'danger', 'info'];
    for (const key of requiredKeys) {
      expect(CHART_COLOR_MAP).toHaveProperty(key);
    }
  });

  it('all values are valid hex strings', () => {
    const hexPattern = /^#[0-9a-f]{6}$/i;
    for (const value of Object.values(CHART_COLOR_MAP)) {
      expect(value).toMatch(hexPattern);
    }
  });

  it('primary color is indigo', () => {
    expect(CHART_COLOR_MAP.primary).toBe('#6366f1');
  });

  it('success color is emerald', () => {
    expect(CHART_COLOR_MAP.success).toBe('#10b981');
  });

  it('danger color is red', () => {
    expect(CHART_COLOR_MAP.danger).toBe('#ef4444');
  });
});

describe('CHART_TOKEN_COLORS', () => {
  it('contains all required theme token keys', () => {
    const requiredKeys = ['primary', 'secondary', 'accent', 'success', 'warning', 'danger', 'foreground', 'surface', 'border'];
    for (const key of requiredKeys) {
      expect(CHART_TOKEN_COLORS).toHaveProperty(key);
    }
  });

  it('uses project-owned CSS tokens instead of legacy HeroUI variables', () => {
    for (const value of Object.values(CHART_TOKEN_COLORS)) {
      expect(value).toContain('var(--');
      expect(value).not.toContain('--heroui');
    }
  });

  it('resolves token colors by name', () => {
    expect(chartTokenColor('primary')).toBe(CHART_TOKEN_COLORS.primary);
    expect(chartTokenColor('border')).toBe(CHART_TOKEN_COLORS.border);
  });
});

describe('chartColorsFor (charts in the community colour)', () => {
  const HEX = /^#[0-9a-f]{6}$/i;

  it('leads with the community colour itself', () => {
    expect(chartColorsFor('#a3195b').primary).toBe('#a3195b');
    expect(chartColorsFor('#a3195b').categorical[0]).toBe('#a3195b');
  });

  it('uses the standard colour when the community has none', () => {
    expect(chartColorsFor(null).primary).toBe('#5b5ede');
  });

  it('gives eight different colours for slices, all chart-ready hex', () => {
    const { categorical } = chartColorsFor('#15803d');
    expect(categorical).toHaveLength(8);
    expect(new Set(categorical).size).toBe(8);
    for (const colour of categorical) expect(colour).toMatch(HEX);
  });

  it('picks the companion colours from the community colour, so two communities differ', () => {
    expect(chartColorsFor('#15803d').categorical.slice(1)).not.toEqual(
      chartColorsFor('#a3195b').categorical.slice(1),
    );
  });

  it('offers a lighter partner of the main colour for gradients', () => {
    const { primary, primaryLight } = chartColorsFor('#a3195b');
    expect(primaryLight).toMatch(HEX);
    expect(primaryLight).not.toBe(primary);
  });
});
