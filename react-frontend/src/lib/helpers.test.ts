// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for helper utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import i18n from '../i18n';
import {
  formatRelativeTime,
  formatDate,
  formatDateValue,
  formatDateTime,
  formatNumber,
  formatTime,
  getFormattingLocale,
  formatHours,
  truncate,
  cn,
  getUserDisplayName,
  getUserInitials,
  resolveUserDisplayName,
  resolveUserDisplayNameFromPrefix,
  buildStoredUserName,
  isOrganisationAccount,
  ORGANISATION_PROFILE_TYPE,
} from './helpers';
import { resetRegion, setRegion } from './regionStore';

describe('application-locale formatting', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('switches dates and numbers from English to the selected German locale', async () => {
    const date = new Date('2026-07-10T16:30:00Z');
    const options: Intl.DateTimeFormatOptions = {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    };

    await i18n.changeLanguage('en');
    const englishDate = formatDateTime(date, options);
    const englishNumber = formatNumber(1234567.89);

    await i18n.changeLanguage('de');
    expect(getFormattingLocale()).toBe('de-IE');
    expect(formatDateTime(date, options)).toBe(
      new Intl.DateTimeFormat('de-IE', options).format(date),
    );
    expect(formatDateTime(date, options)).not.toBe(englishDate);
    expect(formatNumber(1234567.89)).toBe(
      new Intl.NumberFormat('de-IE').format(1234567.89),
    );
    expect(formatNumber(1234567.89)).not.toBe(englishNumber);
  });

  it('preserves native RTL date and number output for the selected Arabic locale', async () => {
    await i18n.changeLanguage('ar');

    const number = formatNumber(1234567.89);
    const date = new Date('2026-07-10T16:30:00Z');
    const dateOptions: Intl.DateTimeFormatOptions = {
      dateStyle: 'full',
      timeZone: 'UTC',
    };
    const formattedDate = formatDateTime(date, dateOptions);

    expect(getFormattingLocale()).toBe('ar-IE');
    expect(number).toBe(new Intl.NumberFormat('ar-IE').format(1234567.89));
    expect(formattedDate).toBe(new Intl.DateTimeFormat('ar-IE', dateOptions).format(date));
    expect(formattedDate).toMatch(/\p{Script=Arabic}/u);
  });

  it('preserves the established fallback for invalid date values', () => {
    expect(formatDateValue('not-a-date')).toBe('—');
  });
});

describe('day-first dates for Irish and UK communities', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    resetRegion();
  });

  // A bare language tag has no region, so Intl falls back to the language's
  // default one — the United States for English. That is what rendered
  // 17 August 2026 as `8/17/2026` across an Ireland/UK platform. These
  // assertions pin the outcome, not the tag, so they still catch a regression
  // if the resolution strategy is rewritten.
  it('renders a short English date day-first, never month-first', async () => {
    await i18n.changeLanguage('en');
    const august17 = new Date('2026-08-17T12:00:00Z');
    const options: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };

    // The bare-numeric shape used by the majority of call sites across the app.
    expect(august17.toLocaleDateString(getFormattingLocale(), options)).toBe('17/8/2026');
    expect(august17.toLocaleDateString('en', options)).toBe('8/17/2026');
  });

  it('renders a long English date with the day before the month', async () => {
    await i18n.changeLanguage('en');
    const formatted = formatDate('2026-08-17T12:00:00Z', {
      day: 'numeric',
      month: 'long',
      timeZone: 'UTC',
      year: 'numeric',
    });

    expect(formatted).toBe('17 August 2026');
  });

  it('follows the community region when it is not the platform default', async () => {
    await i18n.changeLanguage('en');
    setRegion('GB');
    const august17 = new Date('2026-08-17T12:00:00Z');

    expect(getFormattingLocale()).toBe('en-GB');
    expect(august17.toLocaleDateString(getFormattingLocale(), { timeZone: 'UTC' })).toBe(
      '17/08/2026',
    );
  });

  it('keeps a language tag that already carries its own region', async () => {
    await i18n.changeLanguage('pt-BR');
    expect(getFormattingLocale()).toBe('pt-BR');
    await i18n.changeLanguage('en');
  });

  it('ignores a malformed region rather than falling back to the browser', () => {
    setRegion('not-a-region');
    expect(getFormattingLocale()).toBe('en-IE');
  });
});

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-04T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // The single-letter abbreviations ("30s ago", "3d ago") exist only in US
  // English CLDR data. Irish and British English both render "30 sec ago" and
  // "3 days ago" at every Intl style, so these expectations changed when the
  // formatting locale gained its region. Verified against en, en-IE and en-GB.
  it('returns "just now" for times less than a minute ago', () => {
    const date = new Date('2026-02-04T11:59:30Z').toISOString();
    expect(formatRelativeTime(date)).toBe('30 sec ago');
  });

  it('returns minutes ago for times less than an hour ago', () => {
    const date = new Date('2026-02-04T11:30:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('30 min ago');
  });

  it('returns hours ago for times less than a day ago', () => {
    const date = new Date('2026-02-04T06:00:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('6 hr ago');
  });

  it('returns days ago for times less than a week ago', () => {
    const date = new Date('2026-02-01T12:00:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('3 days ago');
  });

  it('returns weeks ago for times less than a month ago', () => {
    const date = new Date('2026-01-21T12:00:00Z').toISOString();
    expect(formatRelativeTime(date)).toBe('2 wk ago');
  });
});

describe('formatDate', () => {
  it('formats date with default options', () => {
    const result = formatDate('2026-02-04T12:00:00Z');
    expect(result).toContain('2026');
    expect(result).toContain('February');
  });

  it('formats date with custom options', () => {
    const result = formatDate('2026-02-04T12:00:00Z', {
      month: 'short',
      day: 'numeric',
    });
    expect(result).toContain('Feb');
    expect(result).toContain('4');
  });
});

describe('formatTime', () => {
  it('formats time correctly', () => {
    const result = formatTime('2026-02-04T14:30:00Z');
    // Time will vary based on timezone, just check it's a valid time format
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});

describe('formatHours', () => {
  it('returns singular for 1 hour', () => {
    expect(formatHours(1)).toBe('1 hour');
  });

  it('returns plural for multiple hours', () => {
    expect(formatHours(2)).toBe('2 hours');
    expect(formatHours(5)).toBe('5 hours');
  });
});

describe('truncate', () => {
  it('returns original string if shorter than max length', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates string and adds ellipsis', () => {
    expect(truncate('hello world', 5)).toBe('hello...');
  });

  it('handles exact length', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });
});

describe('cn', () => {
  it('joins class names', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('filters out falsy values', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });

  it('handles empty input', () => {
    expect(cn()).toBe('');
  });
});

describe('resolveUserDisplayName', () => {
  const organisation = {
    profile_type: 'organisation',
    organization_name: 'Northside Community Trust',
    first_name: 'Zephyrine',
    last_name: 'Quilbrook',
    name: 'Zephyrine Quilbrook',
  };

  it('shows an organisation its own name, never its contact person', () => {
    expect(resolveUserDisplayName(organisation)).toBe('Northside Community Trust');
  });

  it('prefers the organisation name over a stale precomputed name', () => {
    // `users.name` was stored as first+last on insert and never recomputed when
    // a member switched their profile to an organisation, so an older payload
    // can still carry the personal name.
    expect(
      resolveUserDisplayName({
        profile_type: 'organisation',
        organization_name: 'Acme Co-op',
        name: 'John Smith',
      }),
    ).toBe('Acme Co-op');
  });

  it('falls back to the contact person when the organisation name is blank', () => {
    expect(
      resolveUserDisplayName({
        profile_type: 'organisation',
        organization_name: '   ',
        first_name: 'Ada',
        last_name: 'Lovelace',
      }),
    ).toBe('Ada Lovelace');
  });

  it('prefers an explicit name over rebuilding from the parts', () => {
    // Surname-withholding endpoints drop last_name entirely; rebuilding would
    // return "Ada" and lose half the name.
    expect(resolveUserDisplayName({ first_name: 'Ada', name: 'Ada Lovelace' })).toBe('Ada Lovelace');
  });

  it('builds the person name when there is no explicit name', () => {
    expect(resolveUserDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace');
  });

  it('uses the fallback for an empty or missing record', () => {
    expect(resolveUserDisplayName(null, 'A member')).toBe('A member');
    expect(resolveUserDisplayName(undefined, 'A member')).toBe('A member');
    expect(resolveUserDisplayName({}, 'A member')).toBe('A member');
    expect(resolveUserDisplayName({})).toBe('');
  });

  it('does not treat the American spelling as an organisation', () => {
    // users.profile_type only ever holds the British spelling; comparing
    // against 'organization' silently never matches.
    expect(ORGANISATION_PROFILE_TYPE).toBe('organisation');
    expect(
      resolveUserDisplayName({
        profile_type: 'organization',
        organization_name: 'Acme',
        first_name: 'Ada',
        last_name: 'L',
      }),
    ).toBe('Ada L');
  });
});

describe('isOrganisationAccount', () => {
  it('needs both the flag and a usable name', () => {
    expect(isOrganisationAccount({ profile_type: 'organisation', organization_name: 'Acme' })).toBe(true);
    expect(isOrganisationAccount({ profile_type: 'organisation', organization_name: '' })).toBe(false);
    expect(isOrganisationAccount({ profile_type: 'individual', organization_name: 'Acme' })).toBe(false);
    expect(isOrganisationAccount(null)).toBe(false);
  });
});

describe('buildStoredUserName', () => {
  it('rebuilds from the parts rather than echoing the old name', () => {
    // A SAVE must not post the name the account had before the edit.
    expect(buildStoredUserName({ first_name: 'Ada', last_name: 'Byron', name: 'Ada Lovelace' })).toBe('Ada Byron');
  });

  it('stores the organisation name for an organisation', () => {
    expect(
      buildStoredUserName({
        profile_type: 'organisation',
        organization_name: 'Northside Community Trust',
        first_name: 'Zephyrine',
        last_name: 'Quilbrook',
      }),
    ).toBe('Northside Community Trust');
  });

  it('is empty when there is nothing to store', () => {
    expect(buildStoredUserName({ name: 'Ada Lovelace' })).toBe('');
  });
});

describe('resolveUserDisplayNameFromPrefix', () => {
  it('reads prefixed join columns', () => {
    expect(
      resolveUserDisplayNameFromPrefix(
        {
          author_profile_type: 'organisation',
          author_organization_name: 'Riverside Care Collective',
          author_first_name: 'Thurman',
          author_last_name: 'Schroeder',
        },
        'author_',
      ),
    ).toBe('Riverside Care Collective');
  });

  it('falls back to the prefixed person, then the fallback', () => {
    const row = { sender_first_name: 'Ada', sender_last_name: 'Lovelace' };
    expect(resolveUserDisplayNameFromPrefix(row, 'sender_')).toBe('Ada Lovelace');
    expect(resolveUserDisplayNameFromPrefix(row, 'receiver_', 'nobody')).toBe('nobody');
  });
});

describe('getUserDisplayName', () => {
  it('returns full name', () => {
    expect(getUserDisplayName({ first_name: 'John', last_name: 'Doe' })).toBe('John Doe');
  });

  it('trims whitespace', () => {
    expect(getUserDisplayName({ first_name: 'John', last_name: '' })).toBe('John');
  });
});

describe('getUserInitials', () => {
  it('returns initials', () => {
    expect(getUserInitials({ first_name: 'John', last_name: 'Doe' })).toBe('JD');
  });

  it('uses the organisation name, not the contact person', () => {
    expect(
      getUserInitials({
        profile_type: 'organisation',
        organization_name: 'Northside Community Trust',
        first_name: 'Zephyrine',
        last_name: 'Quilbrook',
      }),
    ).toBe('NT');
  });

  it('handles missing names', () => {
    expect(getUserInitials({ first_name: '', last_name: '' })).toBe('');
  });

  it('handles undefined names', () => {
    expect(getUserInitials({ first_name: undefined, last_name: undefined } as Parameters<typeof getUserInitials>[0])).toBe('');
  });
});
