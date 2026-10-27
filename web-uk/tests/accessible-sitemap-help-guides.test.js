// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Help Centre guides are public signed-out pages web-uk serves
 * (routes/support.js /help/:audience/:section/:article), but the accessible
 * sitemap listed only /help. Pinned: on an accessible-primary community every
 * guide page a signed-out visitor can open is listed, a guide behind a
 * switched-off module or feature is not, and standard mode (where /help
 * canonicalises to the main site) lists none of them.
 */

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {},
  getLegalVersions: jest.fn().mockResolvedValue({ data: { versions: [] } }),
  getBlogPosts: jest.fn().mockResolvedValue({ data: { items: [] } }),
  getPublicEvents: jest.fn().mockResolvedValue({ data: [], meta: {} })
}));

delete process.env.MAIN_FRONTEND_URL;

const { buildSitemapXml } = require('../src/lib/accessible-sitemap');

function tenant({ modules = {}, features = {}, primary = 'accessible' } = {}) {
  return {
    id: 2,
    name: 'Acme Timebank',
    slug: 'acme',
    modules: { listings: true, ...modules },
    features: { events: true, ...features },
    branding: {},
    seo: {},
    settings: { seo_primary_site: primary }
  };
}

async function paths(data) {
  const xml = await buildSitemapXml({ tenant: data, protocol: 'https', host: 'accessible.acme.example', prefix: '' });
  return Array.from(xml.matchAll(/<loc>https:\/\/accessible\.acme\.example([^<]*)<\/loc>/g), (match) => match[1] || '/');
}

describe('Help Centre guides in the accessible sitemap', () => {
  it('lists audience, section and article pages a signed-out visitor can open', async () => {
    const listed = await paths(tenant());
    expect(listed).toContain('/help');
    expect(listed).toContain('/help/brokers');
    expect(listed).toContain('/help/admins');
    expect(listed).toContain('/help/members/getting_started');
    expect(listed).toContain('/help/members/getting_started/what_is_timebanking');
    expect(listed).toContain('/help/members/listings/offers_and_requests');
    // The members audience page is /help itself; /help/members only redirects.
    expect(listed).not.toContain('/help/members');
  });

  it('leaves out guides behind a switched-off module or feature', async () => {
    const off = await paths(tenant({ modules: { feed: false }, features: { events: false } }));
    expect(off.some((p) => p.startsWith('/help/members/feed'))).toBe(false);
    expect(off.some((p) => p.startsWith('/help/members/events'))).toBe(false);
    const on = await paths(tenant({ modules: { feed: true } }));
    expect(on).toContain('/help/members/feed');
  });

  it('lists no guide in standard mode, where help belongs to the main site', async () => {
    const listed = await paths(tenant({ primary: 'standard' }));
    expect(listed.some((p) => p.startsWith('/help'))).toBe(false);
  });
});
