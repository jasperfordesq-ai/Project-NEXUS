// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organiser notification links on the accessible frontend (26 Oct 2026).
 *
 * The server stores bell and email links for organisation staff in React's shape,
 * `/volunteering/org/{id}/…`. This frontend serves those pages under
 * `/volunteering/organisations/{id}/…`, and the inbox follows a stored link
 * verbatim, so before this route existed every one of them opened "Page not found".
 *
 * Pinned here:
 * - every dashboard tab, and the safeguarding list and report addresses, redirect to
 *   the page that does the same job, inside the tenant prefix;
 * - an unknown or missing tab lands on the dashboard, never on an error;
 * - every tab the Laravel services actually write into a link is mapped — so a new
 *   producer cannot reintroduce a dead link without this test failing.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const orgLinkRoutes = require('../src/routes/volunteering-org-links');

const { TAB_PAGES } = orgLinkRoutes;
const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;

function createApp() {
  const app = express();
  app.use(MOUNT, (req, res, next) => {
    res.locals.urlFor = (value) => `${PREFIX}${value}`;
    next();
  }, orgLinkRoutes);
  return app;
}

// Every page the map points at must be a real organisation page on this frontend.
const ORG_PAGES = new Set([
  'dashboard', 'opportunities', 'manage', 'volunteers', 'expenses', 'fundraising',
  'qualifications', 'team', 'wallet', 'settings', 'wellbeing', 'safeguarding'
]);

describe('organiser notification links in React address shape', () => {
  it.each(Object.entries(TAB_PAGES))('dashboard?tab=%s goes to the %s page', async (tab, page) => {
    const res = await request(createApp()).get(`${MOUNT}/org/7/dashboard?tab=${tab}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/volunteering/organisations/7/${page}`);
  });

  it('maps every tab only to an organisation page this frontend serves', () => {
    for (const page of Object.values(TAB_PAGES)) {
      expect(ORG_PAGES.has(page)).toBe(true);
    }
  });

  it('sends a bare dashboard link, or one with an unknown tab, to the dashboard', async () => {
    const bare = await request(createApp()).get(`${MOUNT}/org/7/dashboard`);
    expect(bare.headers.location).toBe(`${PREFIX}/volunteering/organisations/7/dashboard`);

    const unknown = await request(createApp()).get(`${MOUNT}/org/7/dashboard?tab=constructor`);
    expect(unknown.headers.location).toBe(`${PREFIX}/volunteering/organisations/7/dashboard`);
  });

  it('opens the safeguarding list and a single report', async () => {
    const list = await request(createApp()).get(`${MOUNT}/org/7/safeguarding`);
    expect(list.headers.location).toBe(`${PREFIX}/volunteering/organisations/7/safeguarding`);

    const report = await request(createApp()).get(`${MOUNT}/org/7/safeguarding/41`);
    expect(report.status).toBe(302);
    expect(report.headers.location).toBe(`${PREFIX}/volunteering/organisations/7/safeguarding/41`);
  });

  it('does not match a non-numeric organisation or report id', async () => {
    const res = await request(createApp()).get(`${MOUNT}/org/abc/dashboard`);
    expect(res.status).toBe(404);
  });

  it('maps every tab the Laravel services write into an organiser link', () => {
    const servicesDir = path.join(__dirname, '..', '..', 'app', 'Services');
    const tabs = new Set();
    for (const file of fs.readdirSync(servicesDir)) {
      if (!file.endsWith('.php')) continue;
      const source = fs.readFileSync(path.join(servicesDir, file), 'utf8');
      // Links are built by concatenation ('/volunteering/org/' . $id . '/dashboard?tab=x'),
      // so read the tab from any organiser dashboard link in a file that builds one.
      if (!source.includes('/volunteering/org/')) continue;
      for (const match of source.matchAll(/\/dashboard\?tab=([a-z_-]+)/g)) {
        tabs.add(match[1]);
      }
    }
    // Guard against the scan silently finding nothing (a moved directory would
    // otherwise make this test pass vacuously).
    expect(tabs.size).toBeGreaterThanOrEqual(5);
    for (const tab of tabs) {
      expect(Object.keys(TAB_PAGES)).toContain(tab);
    }
  });
});
