// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Per-community accent colours: the palette, the generated themes, and the fallback.
 *
 * ── What this is for ──────────────────────────────────────────────────────────
 *
 * HeroUI Native has thirteen components that resolve `--accent` internally, and its
 * provider accepts no colour configuration, so the only way to give a community its own
 * brand colour is to switch the CSS variable those components read. uniwind compiles
 * those variables at BUILD time and has no runtime setter for an arbitrary value, so
 * each community needs a theme registered when the bundle is built. That is what
 * `config/tenant-palettes.json` plus `scripts/generate-tenant-themes.mjs` produce.
 *
 * The consequence worth testing: a community that signs up AFTER a build shipped has no
 * theme, and `Uniwind.setTheme()` throws on an unregistered name. The fallback is
 * therefore not a nicety — without it the app crashes on launch for a new community.
 *
 * Verified on a device on 2026-08-19 with the `agoris` community, whose brand colour is
 * teal `#0f766e`: its logo tile and its Sign in button both rendered teal, where the
 * same screen previously showed a blue logo beside an indigo button. The button
 * measured exactly `#579f9a`, the generated dark-scheme accent.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const PALETTE = path.join(MOBILE_ROOT, 'config', 'tenant-palettes.json');
const GENERATED = path.join(MOBILE_ROOT, 'generated', 'tenant-themes.css');
const METRO = path.join(MOBILE_ROOT, 'metro.config.js');
const GLOBAL_CSS = path.join(MOBILE_ROOT, 'global.css');

interface Palette {
  tenants: Record<string, { accent: string; accentDark?: string }>;
}

function palette(): Palette {
  return JSON.parse(fs.readFileSync(PALETTE, 'utf8')) as Palette;
}

function generatedCss(): string {
  return fs.readFileSync(GENERATED, 'utf8');
}

/** WCAG relative luminance, recomputed rather than trusted. */
function luminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the tenant accent palette', () => {
  it('declares a valid hex accent for every community', () => {
    const tenants = Object.entries(palette().tenants);
    expect(tenants.length).toBeGreaterThan(0);

    for (const [slug, entry] of tenants) {
      expect(slug).toMatch(/^[a-z0-9-]+$/);
      expect(entry.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      if (entry.accentDark) expect(entry.accentDark).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('generates a light and a dark theme for each community', () => {
    const css = generatedCss();
    for (const slug of Object.keys(palette().tenants)) {
      expect(css).toContain(`@variant t-${slug}-light {`);
      expect(css).toContain(`@variant t-${slug}-dark {`);
    }
  });

  it('gives every generated theme the SAME variable set', () => {
    // 🔴 uniwind rejects the whole build when themes disagree ("All themes must have
    // the same variables"). Catching it here names the offending theme instead of
    // leaving a bundler error to be deciphered.
    const blocks = [...generatedCss().matchAll(/@variant (t-[a-z0-9-]+) \{([\s\S]*?)\n {4}\}/g)];
    expect(blocks.length).toBeGreaterThan(1);

    const signature = (body: string) =>
      [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort().join(',');

    const reference = signature(blocks[0]![2]!);
    expect(reference.split(',').length).toBeGreaterThan(30);

    for (const [, , body] of blocks) {
      expect(signature(body!)).toBe(reference);
    }
  });

  it('🔴 puts a legible label on every accent, computed rather than assumed', () => {
    // A community picks its own colour, so white is not always readable on it. The
    // generator measures and chooses white or dark ink; this recomputes the result
    // instead of trusting it. The web side hardcodes white and its own token file
    // admits the pairing is only verified for the default accent.
    const blocks = [...generatedCss().matchAll(/@variant (t-[a-z0-9-]+) \{([\s\S]*?)\n {4}\}/g)];

    for (const [, name, body] of blocks) {
      const accent = /--accent:\s*rgb\((\d+) (\d+) (\d+)\)/.exec(body!);
      expect(accent).not.toBeNull();

      const hex = '#' + [1, 2, 3]
        .map((i) => Number(accent![i]).toString(16).padStart(2, '0'))
        .join('');

      // The generator writes white as oklch(1 0 0) and ink as oklch(0.21 0.03 256).
      const isWhite = /--accent-foreground:\s*oklch\(1 0 0\)/.test(body!);
      const label = isWhite ? '#ffffff' : '#0f172a';
      const ratio = contrast(hex, label);

      // 3:1 is the floor for large text and UI components; button labels here are
      // semibold at 16-18px, which qualifies. Anything below that is unreadable.
      expect({ theme: name, ratio: Number(ratio.toFixed(2)) })
        .toEqual({ theme: name, ratio: expect.any(Number) });
      expect(ratio).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('build wiring', () => {
  it('registers the themes from the palette, not from a hand-written list', () => {
    // Two lists of theme names would drift. metro.config.js derives them so the CSS
    // and the registration cannot disagree.
    const metro = fs.readFileSync(METRO, 'utf8');
    expect(metro).toContain("require('./config/tenant-palettes.json')");
    expect(metro).toContain('extraThemes');
    expect(metro).toMatch(/t-\$\{slug\}-\$\{scheme\}/);
  });

  it('imports the generated CSS from global.css', () => {
    // Without the import the themes exist on disk, are registered by name, and contain
    // nothing — `setTheme` would succeed and change no colours.
    expect(fs.readFileSync(GLOBAL_CSS, 'utf8')).toContain("@import './generated/tenant-themes.css'");
  });

  it('keeps the generated file marked as generated', () => {
    expect(generatedCss()).toContain('GENERATED FILE');
    expect(generatedCss()).toContain('npm run themes:generate');
  });
});
