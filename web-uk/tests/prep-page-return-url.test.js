// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Laravel-prep placeholder pages render a "Back" link from ?return=. It used
 * to pass req.query.return straight into the href, allowing an open redirect
 * (`?return=https://evil`) and a javascript:-scheme click-through. It must now
 * go through validateReturnUrl, exactly like every sibling route.
 */

const fs = require('fs');
const path = require('path');
const { validateReturnUrl } = require('../src/lib/urlValidator');

describe('prep-page return URL is validated', () => {
  it('validateReturnUrl rejects the dangerous values and keeps a safe relative path', () => {
    expect(validateReturnUrl('javascript:alert(document.cookie)', '')).toBe('');
    expect(validateReturnUrl('https://evil.example/phish', '')).toBe('');
    expect(validateReturnUrl('//evil.example', '')).toBe('');
    expect(validateReturnUrl('/members/directory', '')).toBe('/members/directory');
    expect(validateReturnUrl(undefined, '')).toBe('');
  });

  it('the route passes req.query.return through validateReturnUrl, not raw', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'routes', 'laravel-prep-pages.js'),
      'utf8'
    );
    expect(src).toContain("validateReturnUrl(req.query.return, '')");
    // The raw pass-through must be gone.
    expect(src).not.toMatch(/returnUrl:\s*req\.query\.return\s*\|\|\s*''/);
  });
});
