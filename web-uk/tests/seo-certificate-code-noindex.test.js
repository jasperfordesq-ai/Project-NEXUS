// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * An address carrying a certificate code is about one person, so it must not
 * be indexed (React 5c76c2c2f). The bare verification form stays indexable.
 */

const { isPrivatePath, buildSeoLocals } = require('../src/lib/seo-meta');

describe('certificate verification pages and search engines', () => {
  it('treats a certificate code in the address as private', () => {
    expect(isPrivatePath('/verify-certificate/ABC-123')).toBe(true);
    expect(isPrivatePath('/verify-certificate/abc-123/')).toBe(true);
  });

  it('keeps the bare verification form indexable', () => {
    expect(isPrivatePath('/verify-certificate')).toBe(false);
    expect(isPrivatePath('/verify-certificate/')).toBe(false);
  });

  it('marks the coded page noindex and leaves the form alone', () => {
    const t = (key) => key;
    const tenant = { id: 2, slug: 'acme', name: 'Acme Timebank', seo: {} };
    expect(buildSeoLocals({ tenant, t, routePath: '/verify-certificate/ABC-123' }).seoRobots).toContain('noindex');
    expect(buildSeoLocals({ tenant, t, routePath: '/verify-certificate' }).seoRobots || '').not.toContain('noindex');
  });
});
