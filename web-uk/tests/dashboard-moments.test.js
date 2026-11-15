// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E8 (dashboard half): the React dashboard's three moments as
 * plain text on the accessible dashboard, from data the API already returns.
 *
 *  - the member's joining anniversary (React MembershipAnniversary.tsx): the
 *    week after the day they joined, one year on or more, from their own
 *    `created_at` (GET /v2/users/me);
 *  - the community's birthday (React CommunityAnniversary.tsx):
 *    `anniversary_years` from GET /v2/community/this-month, 1 or more;
 *  - the community hours milestone (React CommunityMilestone.tsx): the largest
 *    round number the community's own hours have passed, from
 *    GET /v2/platform/stats, only when `scope` is "tenant".
 *
 * React lets a member close each card; these are short lines of text that
 * cannot be closed (a no-JavaScript close would need a form and a cookie).
 */

const { createTranslator, translateChoice } = require('../src/lib/localization');
const {
  membershipAnniversary,
  communityAnniversary,
  communityMilestone,
  milestoneReached
} = require('../src/lib/dashboard-moments');

const t = createTranslator('en');
const tc = (key, count, replacements) => translateChoice('en', key, count, replacements);

describe('joining anniversary', () => {
  const at = (iso) => new Date(iso);

  it('shows in the week after the day the member joined, a year or more ago', () => {
    const moment = membershipAnniversary('2024-11-10T15:00:00Z', { now: at('2026-11-14T12:00:00Z'), t, locale: 'en-GB', community: 'Riverside' });
    expect(moment).toEqual({
      title: 'Happy anniversary!',
      body: 'You joined Riverside on 10 November 2024. Thank you for being part of it.'
    });
  });

  it('does not show before the day, a week or more after it, or in the first year', () => {
    const now = at('2026-11-14T12:00:00Z');
    expect(membershipAnniversary('2024-11-15T10:00:00Z', { now, t, community: 'R' })).toBeNull();
    expect(membershipAnniversary('2024-11-07T10:00:00Z', { now, t, community: 'R' })).toBeNull();
    expect(membershipAnniversary('2026-11-12T10:00:00Z', { now, t, community: 'R' })).toBeNull();
    expect(membershipAnniversary('', { now, t, community: 'R' })).toBeNull();
    expect(membershipAnniversary('not a date', { now, t, community: 'R' })).toBeNull();
  });
});

describe('community birthday', () => {
  it('says how old the community is this month, with plural forms', () => {
    expect(communityAnniversary({ data: { anniversary_years: 1 } }, { tc, t, community: 'Riverside' })).toEqual({
      title: 'Riverside is one year old this month',
      body: 'Thank you to everyone who has given an hour along the way.'
    });
    expect(communityAnniversary({ data: { anniversary_years: 3 } }, { tc, t, community: 'Riverside' }).title)
      .toBe('Riverside is 3 years old this month');
  });

  it('shows nothing without a birthday this month', () => {
    for (const value of [null, 0, -1, 1.5, 'two', undefined]) {
      expect(communityAnniversary({ data: { anniversary_years: value } }, { tc, t, community: 'R' })).toBeNull();
    }
    expect(communityAnniversary(null, { tc, t, community: 'R' })).toBeNull();
  });
});

describe('community hours milestone', () => {
  it('picks the largest round number passed', () => {
    expect(milestoneReached(99.5)).toBeNull();
    expect(milestoneReached(100)).toBe(100);
    expect(milestoneReached(2600)).toBe(2500);
    expect(milestoneReached(250000)).toBe(100000);
  });

  it('uses only this community\'s own total, never a platform-wide one', () => {
    const own = communityMilestone({ data: { hours_exchanged: 1234, scope: 'tenant' } }, { t, locale: 'en-GB', community: 'Riverside' });
    expect(own).toEqual({
      title: '1,000 hours shared together',
      body: 'Members of Riverside have now given each other more than 1,000 hours of help. Thank you for being part of it.'
    });
    expect(communityMilestone({ data: { hours_exchanged: 1234, scope: 'platform' } }, { t, community: 'R' })).toBeNull();
    expect(communityMilestone({ data: { hours_exchanged: 1234 } }, { t, community: 'R' })).toBeNull();
    expect(communityMilestone({ data: { hours_exchanged: 50, scope: 'tenant' } }, { t, community: 'R' })).toBeNull();
  });
});

describe('every language has the words', () => {
  it('has the six strings in all eleven locales, not copied from English', () => {
    const keys = ['dashboard.anniversary_title', 'dashboard.anniversary_body', 'dashboard.milestone_title',
      'dashboard.milestone_body', 'dashboard.community_birthday_body'];
    for (const locale of ['ar', 'de', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt']) {
      const tl = createTranslator(locale);
      for (const key of keys) {
        expect([locale, key, tl(key) === key]).toEqual([locale, key, false]);
        expect([locale, key, tl(key) === t(key)]).toEqual([locale, key, false]);
      }
      expect(translateChoice(locale, 'dashboard.community_birthday_title', 4, { count: 4, community: 'X' })).toContain('X');
    }
  });
});
