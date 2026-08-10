// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

/**
 * Render the What's On and partner-venues templates directly.
 *
 * The route tests stub `res.render` to assert the view model, which is the
 * right shape for contract assertions but means a template is never compiled
 * by them — a Nunjucks syntax error, a mistyped variable, or a broken loop
 * would pass every one of those tests. These cases compile and render the real
 * templates and assert the structures that carry meaning: GOV.UK tags, the
 * status banners, the CSRF field, the radio group, and the inline QR.
 */
const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const env = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});

const shell = {
  t: (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key),
  urlFor: (pathname) => `/hour-timebank/accessible${pathname}`,
  isAuthenticated: false,
  tenantName: 'Hour Timebank',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaCurrentLocale: 'en',
  csrfToken: 'test-csrf'
};

function render(template, context) {
  return env.render(template, { ...shell, ...context });
}

describe("What's On templates render", () => {
  it('lists events with status tags, and carries a literal "0" search through the paging link', () => {
    const html = render('whats-on/index.njk', {
      events: [
        {
          id: 1,
          title: 'Repair cafe',
          whenLabel: '4 September 2026, 6:30pm',
          location: 'Bantry',
          attendance_mode: 'in_person',
          operational_status: 'scheduled',
          category: { name: 'Skills' }
        },
        { id: 2, title: 'Online talk', whenLabel: '5 September 2026', attendance_mode: 'online', operational_status: 'cancelled' }
      ],
      when: 'upcoming',
      whenOptions: ['upcoming', 'past', 'all'],
      search: '0',
      nextCursor: 'CUR'
    });

    expect(html).toContain('Repair cafe');
    expect(html).toContain('4 September 2026, 6:30pm');
    expect(html).toContain('govuk-tag--red');   // cancelled
    expect(html).toContain('govuk-tag--blue');  // online
    // The location is suppressed for an online-only event.
    expect(html).toContain('Bantry');
    // Paging keeps the window, the cursor, and the falsy-looking search term.
    expect(html).toContain('cursor=CUR');
    expect(html).toContain('q=0');
    expect(html).toContain('when=upcoming');
  });

  it('renders the empty state instead of a list', () => {
    const html = render('whats-on/index.njk', {
      events: [], when: 'upcoming', whenOptions: ['upcoming', 'past', 'all'], search: '', nextCursor: null
    });

    expect(html).toContain('govuk_alpha_whats_on.index.empty');
    expect(html).not.toContain('govuk_alpha_whats_on.index.more');
  });

  it('shows only the accessibility rows the organiser actually answered', () => {
    const html = render('whats-on/detail.njk', {
      event: {
        id: 1,
        title: 'Community lunch',
        location: 'The Hall',
        attendance_mode: 'hybrid',
        operational_status: 'scheduled',
        organizer_name: 'Ada',
        description: 'Everyone welcome',
        category: { name: 'Food' },
        // hearing_loop is null — "not stated", which must NOT render as "No".
        accessibility: { step_free: true, accessible_toilet: false, hearing_loop: null, notes: 'Ring the bell' }
      },
      startsAt: '4 September 2026, 12:00pm',
      endsAt: '4 September 2026, 2:00pm'
    });

    expect(html).toContain('Community lunch');
    expect(html).toContain('4 September 2026, 12:00pm');
    expect(html).toContain('accessibility_step_free');
    expect(html).toContain('accessibility_accessible_toilet');
    expect(html).not.toContain('accessibility_hearing_loop');
    expect(html).toContain('Ring the bell');
    // Hybrid shows the place AND says it is joinable online.
    expect(html).toContain('The Hall');
    expect(html).toContain('govuk_alpha_whats_on.show.hybrid');
  });

  it('withholds the register prompt for a cancelled event', () => {
    const html = render('whats-on/detail.njk', {
      event: { id: 1, title: 'Called off', operational_status: 'cancelled', attendance_mode: 'in_person', accessibility: {} },
      startsAt: null, endsAt: null
    });

    expect(html).toContain('govuk-tag--red');
    expect(html).not.toContain('govuk_alpha_whats_on.show.sign_in_to_register');
  });
});

describe('Partner venues templates render', () => {
  it('joins the address parts and marks the venue website as third-party', () => {
    const html = render('venues/index.njk', {
      venues: [{
        id: 1, name: 'The Corner Cafe', offer_summary: 'Free tea',
        address_line: '1 Main St', city: 'Bantry', postcode: 'P75 XY12',
        website: 'https://example.test'
      }]
    });

    expect(html).toContain('The Corner Cafe');
    expect(html).toContain('1 Main St, Bantry, P75 XY12');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('omits an absent address without leaving stray separators', () => {
    const html = render('venues/index.njk', { venues: [{ id: 1, name: 'Nameless', city: 'Bantry' }] });

    expect(html).toContain('Bantry');
    expect(html).not.toContain(', ,');
    expect(html).not.toMatch(/>\s*,/);
  });

  it('embeds the QR inline and never prints the pass token as text', () => {
    const html = render('venues/pass.njk', {
      pass: { qr_url: 'https://x.test/venues/checkin/SECRETTOKEN' },
      qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
      visits: [{ venue_name: 'The Corner Cafe', visitedOnLabel: '4 September 2026' }],
      rotated: true
    });

    expect(html).toContain('<svg');
    expect(html).toContain('role="img"');
    expect(html).toContain('govuk_alpha_venues.pass.qr_alt');
    // The token is the credential: it belongs in the QR, not on the page.
    expect(html).not.toContain('SECRETTOKEN');
    expect(html).toContain('govuk_alpha_venues.pass.rotated_notice');
    expect(html).toContain('name="_csrf"');
    expect(html).toContain('4 September 2026');
  });

  it('hides the rotated banner when the pass was not just rotated', () => {
    const html = render('venues/pass.njk', {
      pass: {}, qrSvg: null, visits: [], rotated: false
    });

    expect(html).not.toContain('govuk_alpha_venues.pass.rotated_notice');
    expect(html).toContain('govuk_alpha_venues.pass.visits_empty');
    expect(html).not.toContain('<svg');
  });

  it('offers a keyboard-reachable radio group when a venue must be chosen', () => {
    const html = render('venues/checkin.njk', {
      token: 'abc123',
      result: { status: 'needs_venue', venues: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] },
      venueChoices: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }]
    });

    expect(html).toContain('govuk-radios');
    expect(html).toContain('id="venue-choice-1"');
    expect(html).toContain('for="venue-choice-1"');
    expect(html).toContain('id="venue-choice-2"');
    expect(html).toContain('checked');
    expect(html).toContain('name="_csrf"');
  });

  it('announces a recorded visit and any completed challenge', () => {
    const html = render('venues/checkin.njk', {
      token: 'abc123',
      result: {
        status: 'recorded',
        member: { name: 'Ada' },
        venue: { name: 'The Corner Cafe' },
        visits_this_month: 3,
        completed_challenges: [{ title: 'Explorer' }]
      },
      venueChoices: []
    });

    expect(html).toContain('role="alert"');
    expect(html).toContain('govuk_alpha_venues.checkin.recorded');
    expect(html).toContain('Explorer');
    expect(html).toContain('govuk_alpha_venues.checkin.visits_this_month');
    // Nothing left to submit once it is recorded.
    expect(html).not.toContain('govuk_alpha_venues.checkin.confirm');
  });

  it.each([
    ['invalid_pass', 'invalid'],
    ['forbidden', 'forbidden']
  ])('states the %s outcome as a page-level notice, not field validation', (status, key) => {
    const html = render('venues/checkin.njk', { token: 'abc123', result: { status }, venueChoices: [] });

    expect(html).toContain('role="alert"');
    expect(html).toContain(`govuk_alpha_venues.checkin.${key}_title`);
    expect(html).toContain(`govuk_alpha_venues.checkin.${key}_body`);
    // An error summary would promise links back to invalid fields that do not exist.
    expect(html).not.toContain('govuk-error-summary');
  });

  it('shows the confirm form and records nothing on the initial GET state', () => {
    const html = render('venues/checkin.njk', { token: 'abc123', result: null, venueChoices: [] });

    expect(html).toContain('govuk_alpha_venues.checkin.intro');
    expect(html).toContain('govuk_alpha_venues.checkin.confirm');
    expect(html).toContain('/venues/checkin/abc123');
    expect(html).not.toContain('govuk-radios');
  });
});
