// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the soft glow behind the page never costs text its contrast.
 *
 * The member pages have a faint wash of the community's hue across the top
 * (`.page-wash`, styles/background.css — warmth plan P2). Text sits straight
 * on the page there, and two kinds of it have no room to spare on the light
 * theme: grey helper text (4.59:1 on the page) and community-coloured text,
 * which ThemeContext deepens to exactly 4.5:1 against the page colour. On the
 * dark theme, community-coloured text is lightened to 4.5:1 against a card
 * (#18181b), the lightest dark surface it sits on.
 *
 * So the wash takes only the HUE of the community colour and fixes its own
 * lightness: on the light theme it is never darker than the page, and on the
 * dark theme never lighter than a card. This test works that out for every
 * hue, whatever colour a community picks.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const CSS = fs.readFileSync(path.resolve(__dirname, '../styles/background.css'), 'utf8');

/** Relative luminance (WCAG) of an oklch colour, clipped into sRGB. */
function luminance(L: number, C: number, hueDegrees: number): number {
  const h = (hueDegrees * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return 0.2126 * clamp(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)
    + 0.7152 * clamp(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)
    + 0.0722 * clamp(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}

function hexLuminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function wash(selector: RegExp, what: string): { L: number; C: number } {
  const block = selector.exec(CSS);
  expect(block, `background.css sets the ${what} wash`).not.toBeNull();
  const values = [...block![0].matchAll(/oklch\(from var\(--(?:accent-color|companion)\) ([\d.]+) ([\d.]+) h\)/g)];
  expect(values.length, `${what}: one wash from the community colour, one from its companion`).toBe(2);
  expect(values[0]![1]).toBe(values[1]![1]);
  expect(values[0]![2]).toBe(values[1]![2]);
  return { L: Number(values[0]![1]), C: Number(values[0]![2]) };
}

const dark = () => wash(/\n {2}\.page-wash \{[^}]*\}/, 'dark');
const light = () => wash(/:root\[data-theme="light"\] \.page-wash \{[^}]*\}/, 'light');

const HUES = Array.from({ length: 72 }, (_, i) => i * 5);

describe('the soft glow behind the page', () => {
  it('is never darker than the light page, for any hue (page: #fafaf9)', () => {
    const { L, C } = light();
    const page = hexLuminance('#fafaf9');
    for (const hue of HUES) {
      expect(luminance(L, C, hue), `hue ${hue}`).toBeGreaterThanOrEqual(page);
    }
  });

  it('is never lighter than a dark card, for any hue (card: #18181b)', () => {
    const { L, C } = dark();
    const card = hexLuminance('#18181b');
    for (const hue of HUES) {
      expect(luminance(L, C, hue), `hue ${hue}`).toBeLessThanOrEqual(card);
    }
  });

  it('carries some colour', () => {
    expect(light().C).toBeGreaterThanOrEqual(0.015);
    expect(dark().C).toBeGreaterThanOrEqual(0.03);
  });

  it('is switched off in high-contrast mode, and absent where the browser cannot work it out', () => {
    expect(CSS).toMatch(/html\[data-high-contrast="true"\] \.page-wash\s*\{\s*background-image:\s*none/);
    expect(CSS).toMatch(/@supports \(color: oklch\(from red l c h\)\)\s*\{\s*\.page-wash \{/);
  });

  it('gives a conversation the same two fixed lightnesses, and none in high-contrast mode', () => {
    const { L: lightL, C: lightC } = light();
    const { L: darkL, C: darkC } = dark();
    expect(CSS).toContain(`:root[data-theme="light"] .chat-backdrop {
    background-color: oklch(from var(--accent-color) ${lightL} ${lightC} h);`);
    expect(CSS).toContain(`
  .chat-backdrop {
    background-color: oklch(from var(--accent-color) ${darkL} ${darkC} h);`);
    expect(CSS).toMatch(/html\[data-high-contrast="true"\] \.chat-backdrop\s*\{\s*background-color:\s*transparent/);
  });
});
