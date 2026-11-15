// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E9.
 *
 *  - Who is going: the event page already lists people from the same roster
 *    the React page reads (GET /v2/events/{id}/attendees, `member.display_name`,
 *    which the server shortens to a first name for anyone not allowed to see a
 *    surname — App\Support\UserDisplayName / NameAudience). Our own fallback
 *    for an older row shape joined first_name and last_name itself, which
 *    would put a surname on the page that the server never chose to show. It
 *    now uses the first name only (no surnames to members, E-122).
 *  - A link from the dashboard to the member's own thank-you notes
 *    (/users/{id}/appreciations), while the community has thank-you notes on.
 */

const fs = require('fs');
const path = require('path');
const { createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => new Proxy({ ApiError: class ApiError extends Error {}, ApiOfflineError: class ApiOfflineError extends Error {} }, {
  get: (target, name) => (name in target ? target[name] : jest.fn())
}));

const { eventAttendee } = require('../src/routes/events')._test;

describe('who is going: first names only from our own fallback', () => {
  it('uses the server\'s display name as given', () => {
    expect(eventAttendee({ member: { id: 4, display_name: 'Ann' }, registration: { state: 'confirmed' } }).name).toBe('Ann');
  });

  it('never joins a surname on when an older row has no display name', () => {
    expect(eventAttendee({ first_name: 'Bea', last_name: 'Murphy', rsvp_status: 'going' }).name).toBe('Bea');
    expect(eventAttendee({ user: { first_name: 'Cal', last_name: 'Byrne' }, rsvp_status: 'going' }).name).toBe('Cal');
  });
});

describe('dashboard link to your thank-you notes', () => {
  const template = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'dashboard', 'index.njk'), 'utf8');

  it('links to your own thank-you notes page while thank-you notes are on', () => {
    expect(template).toMatch(/\{% if dashboardFeatures\.appreciations and profile\.id %\}\s*<li><a class="govuk-link" href="\{\{ urlFor\('\/users\/' \+ \(profile\.id \| string\) \+ '\/appreciations'\) \}\}">\{\{ t\("dashboard\.your_thank_you_notes"\) \}\}<\/a><\/li>/);
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'dashboard.js'), 'utf8');
    expect(route).toContain("appreciations: flagEnabled(tenant, 'appreciations', 'features', true)");
  });

  it('has the words in every language', () => {
    const en = createTranslator('en')('dashboard.your_thank_you_notes');
    expect(en).toBe('Your thank-you notes');
    for (const locale of ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
      const value = createTranslator(locale)('dashboard.your_thank_you_notes');
      expect([locale, value === en || value === 'dashboard.your_thank_you_notes']).toEqual([locale, false]);
    }
  });
});
