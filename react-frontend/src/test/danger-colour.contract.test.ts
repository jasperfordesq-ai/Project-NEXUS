// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the site's red ("danger") reads at WCAG AA, as text and as a fill.
 *
 * Measured on 10 Nov 2026 (warmth plan W4, axe in a browser): HeroUI's red was
 * #ff383c on the light theme — 3.5:1 as text (the notifications page's
 * "Delete all", and `text-danger` in about 535 places) and 3.6:1 under white
 * text — and #db3b3e on the dark theme, 3.1:1 as text on a raised surface and
 * 4.46:1 under white. The broker panel already fixed this for itself on
 * 3 Oct 2026; the member site now has its own values in tokens.css. On the
 * dark theme the red is lightened to read as text, so fills carry dark text.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const TOKENS = fs.readFileSync(path.join(SRC, 'styles/tokens.css'), 'utf8');

type Rgb = [number, number, number];

function oklchToRgb(L: number, C: number, hueDegrees: number): Rgb {
  const H = (hueDegrees * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return linear.map((v) => Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055) * 255)) as Rgb;
}

const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const [R, G, B] = [r, g, b].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R! + 0.7152 * G! + 0.0722 * B!;
}

function contrast(x: Rgb, y: Rgb): number {
  const [high, low] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (high! + 0.05) / (low! + 0.05);
}

/** `share` of `over` laid on `under` — a soft tint such as HeroUI's danger-soft (15%). */
const tint = (under: Rgb, over: Rgb, share: number): Rgb => under.map((v, i) => Math.round(v * (1 - share) + over[i]! * share)) as Rgb;

function block(selector: string): string {
  const start = TOKENS.indexOf(`${selector} {`);
  expect(start, `tokens.css has a ${selector} block`).toBeGreaterThanOrEqual(0);
  return TOKENS.slice(start, TOKENS.indexOf('}', start));
}

function danger(selector: string): Rgb {
  const m = /--danger:\s*oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/.exec(block(selector));
  expect(m, `${selector} sets --danger as oklch()`).not.toBeNull();
  return oklchToRgb(Number(m![1]), Number(m![2]), Number(m![3]));
}

const LIGHT = ':root[data-theme="light"]:not([data-panel="broker"])';
const DARK = ':root[data-theme="dark"]:not([data-panel="broker"])';
const WHITE = hex('#ffffff');
const ECLIPSE = oklchToRgb(0.2103, 0.0059, 285.89); // HeroUI --eclipse

describe('the red (danger) on the member site', () => {
  it('reads as text on the light theme: the page, cards and its own soft tint', () => {
    const red = danger(LIGHT);
    expect(contrast(red, hex('#fafaf9'))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(red, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(red, tint(WHITE, red, 0.15))).toBeGreaterThanOrEqual(4.5);
  });

  it('carries white text as a fill on the light theme', () => {
    expect(contrast(WHITE, danger(LIGHT))).toBeGreaterThanOrEqual(4.5);
  });

  it('reads as text on the dark theme: the page, cards, raised surfaces and its soft tint', () => {
    const red = danger(DARK);
    for (const surface of ['#0c0a09', '#18181b', '#27272a', '#332c17', '#321d1c']) {
      expect(contrast(red, hex(surface)), `on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(red, tint(hex('#18181b'), red, 0.15))).toBeGreaterThanOrEqual(4.5);
  });

  it('carries dark text as a fill on the dark theme', () => {
    expect(block(DARK)).toMatch(/--danger-foreground:\s*var\(--eclipse\)/);
    expect(contrast(ECLIPSE, danger(DARK))).toBeGreaterThanOrEqual(4.5);
  });

  it('never forces white text onto the red fill (it is light on the dark theme)', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
            if (/(?:^|[\s"'`])bg-danger(?=[\s"'`])/.test(line) && /(?:^|[\s"'`])text-white(?=[\s"'`])/.test(line)) {
              offenders.push(`${path.relative(SRC, full).split(path.sep).join('/')}:${index + 1}`);
            }
          });
        }
      }
    };
    walk(SRC);
    expect(offenders, 'use text-danger-foreground on bg-danger').toEqual([]);
  });
});
