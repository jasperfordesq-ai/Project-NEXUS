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

/** Mix towards white, matching `shift()` in scripts/generate-tenant-themes.mjs. */
function lift(hex: string, amount: number): string {
  const clean = hex.replace(/^#/, '');
  return '#' + [0, 2, 4]
    .map((i) => parseInt(clean.slice(i, i + 2), 16))
    .map((c) => Math.round(c + (255 - c) * amount).toString(16).padStart(2, '0'))
    .join('');
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

  it('🔴 is the SAME colour in dark mode — lightening it was tried twice and abandoned twice', () => {
    // The full reasoning lives in scripts/generate-tenant-themes.mjs. In short: a lightened
    // accent is a DIFFERENT colour from `usePrimaryColor()`, which everything the app paints
    // by hand uses, so the two stop agreeing and it cascades:
    //
    //   79 buttons overriding their own background      (swept away — worth doing anyway)
    //   91 conditional overrides on toggle buttons      (swept away — worth doing anyway)
    //   62 buttons with a hardcoded white ICON beside a label that would become dark ink
    //
    // The last group cannot be fixed cheaply: lib/theme/nativeVectorIconStyling.test.ts
    // requires Ionicons to use the native `color` prop, so an icon cannot inherit a CSS
    // variable — it would need a new hook threaded through 34 files.
    //
    // And it buys nothing that is missing. See the next test.
    expect(defaultAccent('dark')).toBe(defaultAccent('light'));
    expect(defaultAccent('dark')).toBe(fallbackPrimary());
    expect(defaultAccent('dark')).not.toBe(lift(fallbackPrimary(), 0.3));
  });

  it('🔴 is legible on the dark ground WITHOUT being lightened', () => {
    // This is the measurement that makes the decision above defensible rather than merely
    // convenient. The accent is also `--link`, so it has to be readable as text on the
    // near-black background: un-lifted it measures 4.24:1, comfortably over the 3:1 floor
    // for UI text. As a solid button fill, lightening changes nothing about visibility.
    expect(contrast(defaultAccent('dark'), '#0a0a0f')).toBeGreaterThanOrEqual(3);
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

  it('keeps the same white label in dark mode, since it is the same accent', () => {
    // One accent means one label. White measures 4.66:1 on this blue in either scheme.
    // Recomputed rather than trusted, so changing the default colour cannot silently leave
    // an unreadable label behind.
    expect(contrast(defaultAccent('dark'), '#ffffff')).toBeGreaterThanOrEqual(4.5);

    const css = fs.readFileSync(GLOBAL_CSS, 'utf8');
    const dark = /@variant dark[\s\S]*?--accent-foreground:\s*([^;]+);/.exec(css);
    expect(dark).not.toBeNull();
    expect(dark![1]!.trim()).toBe('oklch(1 0 0)');
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
