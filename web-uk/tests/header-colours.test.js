// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): Admin → Settings → "Accessible header
 * colour" was saved but the accessible site never used it. The stylesheet has
 * always read --nexus-alpha-header-bg / -accent / -fg; nothing set them.
 *
 * The header text colour is computed from the background (white or near-black,
 * whichever contrasts more), so a light brand colour never leaves white text on
 * a pale bar.
 */

const fs = require('fs');
const path = require('path');
const { buildShellLocals } = require('../src/lib/accessible-shell');

function shellFor(branding) {
  return buildShellLocals({
    query: {},
    path: '/',
    originalUrl: '/acme/accessible',
    accessibleRouting: {
      tenant: { id: 9, name: 'Acme', slug: 'acme', features: {}, modules: {}, branding },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }
  }, false);
}

describe('accessible header colours', () => {
  it('sets nothing when the community chose no colour (stock black + blue)', () => {
    expect(shellFor({}).headerThemeStyle).toBe('');
  });

  it('applies a dark background with white text, and the chosen accent line', () => {
    const style = shellFor({ header_bg_color: '#5b2a86', header_accent_color: '#ffffff' }).headerThemeStyle;
    expect(style).toContain('--nexus-alpha-header-bg:#5b2a86');
    expect(style).toContain('--nexus-alpha-header-accent:#ffffff');
    expect(style).toContain('--nexus-alpha-header-fg:#ffffff');
  });

  it('uses near-black text on a light background', () => {
    const style = shellFor({ header_bg_color: '#ffdd00' }).headerThemeStyle;
    expect(style).toContain('--nexus-alpha-header-fg:#0b0c0c');
  });

  it('matches the line to the background when no accent is chosen, as the admin preview shows', () => {
    const style = shellFor({ header_bg_color: '#5b2a86' }).headerThemeStyle;
    expect(style).toContain('--nexus-alpha-header-accent:#5b2a86');
  });

  // AWID feedback (Nov 2026): "more vibrant … warmth, and community". The
  // community colour (Admin → Settings → "Community colour", the colour the
  // member website is painted in) now draws the header's stripe too, unless the
  // admin chose an accessible header colour, which always wins.
  it('draws the stripe in the community colour when no header colour is chosen', () => {
    const style = shellFor({ primary_color: '#c2185b' }).headerThemeStyle;
    expect(style).toBe('--nexus-alpha-header-accent:#c2185b');
  });

  it('keeps the accessible header colours ahead of the community colour', () => {
    expect(shellFor({ primary_color: '#c2185b', header_accent_color: '#ffffff' }).headerThemeStyle)
      .toContain('--nexus-alpha-header-accent:#ffffff');
    expect(shellFor({ primary_color: '#c2185b', header_bg_color: '#5b2a86' }).headerThemeStyle)
      .toContain('--nexus-alpha-header-accent:#5b2a86');
  });

  it('never lets the community colour change the header background or text', () => {
    const style = shellFor({ primary_color: '#c2185b' }).headerThemeStyle;
    expect(style).not.toContain('--nexus-alpha-header-bg');
    expect(style).not.toContain('--nexus-alpha-header-fg');
  });

  it('ignores a community colour that is not a #rrggbb colour', () => {
    expect(shellFor({ primary_color: 'red;background:url(x)' }).headerThemeStyle).toBe('');
  });

  it('ignores anything that is not a #rrggbb colour', () => {
    expect(shellFor({ header_bg_color: 'red;background:url(x)' }).headerThemeStyle).toBe('');
  });

  it('puts the style on the header element', () => {
    const base = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'layouts', 'base.njk'), 'utf8');
    expect(base).toMatch(/<header class="nexus-alpha-header" role="banner"\{% if headerThemeStyle %\} style="\{\{ headerThemeStyle \}\}"\{% endif %\}>/);
  });
});
