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

  it('ignores anything that is not a #rrggbb colour', () => {
    expect(shellFor({ header_bg_color: 'red;background:url(x)' }).headerThemeStyle).toBe('');
  });

  it('puts the style on the header element', () => {
    const base = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'layouts', 'base.njk'), 'utf8');
    expect(base).toMatch(/<header class="nexus-alpha-header" role="banner"\{% if headerThemeStyle %\} style="\{\{ headerThemeStyle \}\}"\{% endif %\}>/);
  });
});
