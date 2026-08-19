// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The default accent and the default tenant colour must be the SAME colour.
 *
 * 🔴 This one disagreement WAS the two-brand-colour bug, and it survived the first
 * attempt to fix it.
 *
 * `usePrimaryColor()` in lib/context/TenantContext.tsx returns `FALLBACK_PRIMARY`
 * (#006FEE, NEXUS blue) whenever a community has not set a colour of its own. App code
 * uses that for the things it draws itself — icons, logo tiles, accent bars. HeroUI
 * Native's thirteen accent-consuming components instead read `--accent` from
 * global.css, which was indigo. So on any screen with both, blue sat next to indigo:
 * 128 controls with a blue icon and an indigo label, a blue logo above an indigo Sign
 * in button, a Back button whose arrow and word were different colours.
 *
 * Generating per-community themes fixed the communities that HAVE a colour. It did NOT
 * fix the fallback, which is the majority case — nine of eleven live communities have
 * no `primary_color`, and every new community starts that way. The generated themes
 * made the exception correct while leaving the rule broken, and the first write-up of
 * that work claimed the fallback "looks deliberate rather than broken" when it was
 * still showing the original clash.
 *
 * Hence this test. It is not about a preferred colour; it is about two sources of the
 * same idea being unable to drift apart.
 */

import fs from 'node:fs';
import path from 'node:path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..');
const GLOBAL_CSS = path.join(MOBILE_ROOT, 'global.css');
const TENANT_CONTEXT = path.join(MOBILE_ROOT, 'lib', 'context', 'TenantContext.tsx');

function fallbackPrimary(): string {
  const source = fs.readFileSync(TENANT_CONTEXT, 'utf8');
  const match = /const FALLBACK_PRIMARY\s*=\s*'(#[0-9a-fA-F]{6})'/.exec(source);
  if (!match) throw new Error('FALLBACK_PRIMARY not found in TenantContext.tsx');
  return match[1]!.toLowerCase();
}

/** The `--accent` declared inside a named `@variant` block of global.css. */
function defaultAccent(scheme: 'light' | 'dark'): string {
  const css = fs.readFileSync(GLOBAL_CSS, 'utf8');
  const block = new RegExp(`@variant ${scheme}\\s*\\{([\\s\\S]*?)\\n {4}\\}`).exec(css);
  if (!block) throw new Error(`could not find the "@variant ${scheme}" block in global.css`);

  const accent = /--accent:\s*rgb\((\d+) (\d+) (\d+)\)/.exec(block[1]!);
  if (!accent) {
    throw new Error(
      `the ${scheme} --accent is not an rgb() triple. It must be written as rgb(r g b) so ` +
        'this test can compare it with FALLBACK_PRIMARY.'
    );
  }
  return '#' + [1, 2, 3].map((i) => Number(accent[i]).toString(16).padStart(2, '0')).join('');
}

function toLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  const [r, g, b] = [0, 2, 4].map((i) => toLinear(parseInt(clean.slice(i, i + 2), 16)));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the default accent', () => {
  it('🔴 is exactly the colour usePrimaryColor() falls back to', () => {
    // The assertion the whole file exists for. If these two ever disagree again, every
    // community without a brand colour goes back to showing two of them.
    expect(defaultAccent('light')).toBe(fallbackPrimary());
  });

  it('🔴 is the SAME colour in dark mode, not a lightened one', () => {
    // An earlier version of this work lifted the dark accent 30% towards white, and it
    // broke 142 buttons across 52 files: each overrides its background to the community's
    // UN-lifted colour while its label follows `--accent-foreground`, so ink computed for
    // the lifted shade landed on #006FEE at 3.83:1 where white had been 4.66:1 — a
    // contrast regression caused by the very change meant to fix the colours.
    //
    // No single label colour passes on both a colour and its lifted form, so the mismatch
    // was structural. One accent per community, used in both schemes, is what makes the
    // theme and every hand-written override agree by construction.
    expect(defaultAccent('dark')).toBe(defaultAccent('light'));
    expect(defaultAccent('dark')).toBe(fallbackPrimary());
  });

  it('puts a readable label on the light accent', () => {
    const css = fs.readFileSync(GLOBAL_CSS, 'utf8');
    const light = /@variant light\s*\{([\s\S]*?)\n {4}\}/.exec(css)![1]!;

    // White is only correct here because it measures 4.66:1 on #006FEE. Recomputed
    // rather than trusted, so a change to the default colour cannot silently leave an
    // unreadable label behind.
    expect(light).toMatch(/--accent-foreground:\s*oklch\(1 0 0\)/);
    expect(contrast(defaultAccent('light'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps a readable white label on the dark accent too', () => {
    const css = fs.readFileSync(GLOBAL_CSS, 'utf8');
    const dark = /@variant dark\s*\{([\s\S]*?)\n {4}\}/.exec(css)![1]!;

    // Because the accent is the same colour in both schemes, the label is the same too:
    // white, at 4.66:1 on #006FEE. Recomputed rather than trusted, so changing the
    // default colour cannot silently leave an unreadable label behind.
    expect(contrast(defaultAccent('dark'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(dark).toMatch(/--accent-foreground:\s*oklch\(1 0 0\)/);
  });

  it('🔴 stays legible as a link colour on the dark background', () => {
    // The accent is also `--link`. Not lightening it for dark mode means this has to be
    // checked rather than assumed: #006FEE measures 4.24:1 on the near-black ground.
    expect(contrast(defaultAccent('dark'), '#0a0a0f')).toBeGreaterThanOrEqual(3);
  });

  it('does not generate a redundant theme for the default colour', () => {
    // A community whose colour equals the default needs no theme: the fallback already
    // paints it correctly. Generating one would be dead weight in the bundle and would
    // suggest the default is not trusted.
    const palette = JSON.parse(
      fs.readFileSync(path.join(MOBILE_ROOT, 'config', 'tenant-palettes.json'), 'utf8')
    ) as { tenants: Record<string, { accent: string }> };

    for (const [slug, entry] of Object.entries(palette.tenants)) {
      expect({ slug, accent: entry.accent.toLowerCase() })
        .not.toEqual({ slug, accent: fallbackPrimary() });
    }
  });
});
