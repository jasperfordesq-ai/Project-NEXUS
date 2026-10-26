// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Organiser notification links, written in React's address shape.
 *
 * The server stores bell and email links for organisation staff as
 * `/volunteering/org/{id}/dashboard?tab=…` and
 * `/volunteering/org/{id}/safeguarding[/{incidentId}]` — React's routes. This
 * frontend serves the same pages under `/volunteering/organisations/{id}/…`,
 * one page per tab, and the notification inbox follows a stored link verbatim
 * (`routes/notifications.js`). Without this file every such link — safeguarding
 * reports, wellbeing alerts, fundraising, hand-overs, expenses, qualifications,
 * applications, team, wallet — opened "Page not found" here.
 *
 * Each address is redirected to the page that does the same job. Access is not
 * decided here: the destination page checks the member manages the
 * organisation, exactly as if they had followed the dashboard link.
 */

const express = require('express');

const router = express.Router();

// React dashboard tab → this frontend's page for it. Applications and the hours
// queue share one page here (`/manage`). An unknown or absent tab lands on the
// dashboard, which links to every section.
const TAB_PAGES = Object.freeze({
  overview: 'dashboard',
  opportunities: 'opportunities',
  applications: 'manage',
  hours: 'manage',
  volunteers: 'volunteers',
  expenses: 'expenses',
  fundraising: 'fundraising',
  qualifications: 'qualifications',
  team: 'team',
  wallet: 'wallet',
  settings: 'settings',
  wellbeing: 'wellbeing',
  safeguarding: 'safeguarding'
});

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function tabPage(value) {
  const tab = typeof value === 'string' ? value.trim() : '';
  return Object.hasOwn(TAB_PAGES, tab) ? TAB_PAGES[tab] : 'dashboard';
}

router.get('/org/:orgId(\\d+)/dashboard', (req, res) => (
  redirectTo(res, `/volunteering/organisations/${req.params.orgId}/${tabPage(req.query.tab)}`)
));

router.get('/org/:orgId(\\d+)/safeguarding', (req, res) => (
  redirectTo(res, `/volunteering/organisations/${req.params.orgId}/safeguarding`)
));

router.get('/org/:orgId(\\d+)/safeguarding/:incidentId(\\d+)', (req, res) => (
  redirectTo(res, `/volunteering/organisations/${req.params.orgId}/safeguarding/${req.params.incidentId}`)
));

module.exports = router;
module.exports.TAB_PAGES = TAB_PAGES;
