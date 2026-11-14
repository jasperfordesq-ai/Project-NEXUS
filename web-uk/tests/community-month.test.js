// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID feedback (Nov 2026): "energy, warmth, and community". The dashboard
 * shows what the community has shared so far this month
 * (GET /api/v2/community/this-month), as the React dashboard does, as a GOV.UK
 * summary list.
 */

const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const { communityMonthHighlight } = require('../src/lib/community-month');
const { createTranslator } = require('../src/lib/localization');

const en = createTranslator('en');
const payload = { data: { month: '2026-11', hours_shared: 42.5, new_members: 3, new_listings: 7 } };

describe('community month highlight', () => {
  it('names the month and the community, and lists the three figures', () => {
    const highlight = communityMonthHighlight(payload, { t: en, community: 'Timebank Ireland', locale: 'en-GB' });
    expect(highlight.title).toBe('November in Timebank Ireland');
    expect(highlight.rows).toEqual([
      { key: { text: 'Hours shared' }, value: { text: '42.5' } },
      { key: { text: 'New members' }, value: { text: '3' } },
      { key: { text: 'New offers and requests' }, value: { text: '7' } }
    ]);
  });

  it('leaves out zero figures, and the offers row while listings are off', () => {
    const rows = communityMonthHighlight({ data: { ...payload.data, new_members: 0 } }, { t: en, listings: false }).rows;
    expect(rows.map((row) => row.key.text)).toEqual(['Hours shared']);
  });

  it('shows nothing when there is nothing to show or the answer is unusable', () => {
    expect(communityMonthHighlight({ data: { month: '2026-11', hours_shared: 0, new_members: 0, new_listings: 0 } }, { t: en })).toBeNull();
    expect(communityMonthHighlight(null, { t: en })).toBeNull();
    expect(communityMonthHighlight({ data: { hours_shared: 3 } }, { t: en })).toBeNull();
  });

  // Warmth phase 6 (D3a + D8): two counts that name nobody, as in React.
  it('adds the thank-you notes and the members who helped someone this month', () => {
    const rows = communityMonthHighlight(
      { data: { ...payload.data, thank_yous: 42, members_helped: 7 } },
      { t: en, community: 'X', locale: 'en-GB' }
    ).rows;
    expect(rows.slice(3)).toEqual([
      { key: { text: 'Thank-you notes written' }, value: { text: '42' } },
      { key: { text: 'Members who helped someone' }, value: { text: '7' } }
    ]);
  });

  it('leaves out no thank-yous, and fewer than three helpers so nobody can be picked out', () => {
    const rows = communityMonthHighlight(
      { data: { ...payload.data, thank_yous: 0, members_helped: 2 } },
      { t: en, locale: 'en-GB' }
    ).rows;
    expect(rows.map((row) => row.key.text)).toEqual(['Hours shared', 'New members', 'New offers and requests']);
  });

  it('shows the section for the counts alone in a month with no other figures yet', () => {
    const highlight = communityMonthHighlight(
      { data: { month: '2026-11', hours_shared: 0, new_members: 0, new_listings: 0, thank_yous: 3 } },
      { t: en, locale: 'en-GB' }
    );
    expect(highlight.rows).toEqual([{ key: { text: 'Thank-you notes written' }, value: { text: '3' } }]);
  });

  it('has the two new labels in every language, not English copies', () => {
    for (const locale of ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
      const t = createTranslator(locale);
      for (const key of ['dashboard.month_highlight_thank_yous', 'dashboard.month_highlight_helpers']) {
        expect(t(key)).not.toBe(key);
        expect(t(key)).not.toBe(en(key));
      }
    }
  });

  it('starts the heading with a capital in languages whose months are lower case', () => {
    const fr = communityMonthHighlight(payload, { t: createTranslator('fr'), community: 'AWID', locale: 'fr-FR' });
    expect(fr.title).toBe('Novembre à AWID');
  });

  it('renders as a GOV.UK summary list on the dashboard', () => {
    const view = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'dashboard', 'index.njk'), 'utf8');
    expect(view).toContain('govukSummaryList({ rows: monthHighlight.rows');
    const route = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'dashboard.js'), 'utf8');
    expect(route).toContain('getCommunityThisMonth(req.token)');
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')
    ]), { autoescape: true });
    const html = env.renderString(
      '{% from "govuk/components/summary-list/macro.njk" import govukSummaryList %}{{ govukSummaryList({ rows: rows }) }}',
      communityMonthHighlight(payload, { t: en, community: 'X' })
    ).replace(/\s+/g, ' ');
    expect(html).toContain('<dt class="govuk-summary-list__key"> Hours shared </dt> <dd class="govuk-summary-list__value"> 42.5 </dd>');
  });
});
