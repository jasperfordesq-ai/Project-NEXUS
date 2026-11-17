// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({ useTenant: () => ({ tenantPath: (p: string) => `/test${p}` }) }));
// The page formats with getFormattingLocale() (language + community region).
// Pin it to the locale these expected strings are written in.
vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  getFormattingLocale: () => 'en',
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'days' in options) return `${key}|${String(options.days)}`;
      if (options && 'date' in options) return `${key}|${String(options.date)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { SecurityPage, type SecurityOverview } from './SecurityPage';

const overview = (over: Partial<SecurityOverview> = {}): SecurityOverview => ({
  generated_at: '2026-11-16T10:00:00+00:00',
  window_days: 90,
  access_changes: {
    available: true,
    truncated: false,
    items: [
      { at: '2026-11-10T09:00:00+00:00', change: 'global_super_admin_granted', by: 'Actor Sample', account: 'Target Sample', community: 'Sample Timebank' },
    ],
  },
  impersonations: {
    available: true,
    truncated: false,
    items: [{ at: '2026-11-12T09:00:00+00:00', by: 'Admin Sample', member: 'Member Sample', community: 'Sample Timebank' }],
  },
  failed_sign_ins: {
    available: true,
    last_hour: 3,
    last_24h: 41,
    refused_last_hour: 1900,
    refused_last_24h: 2050,
    counted_since: '2026-11-10T14:00:00+00:00',
    addresses_15m: 7,
    most_from_one_address_15m: 22,
    by_community: [
      { community: { id: 2, name: 'Sample Timebank' }, failed: 30, refused: 2040 },
      { community: null, failed: 11, refused: 10 },
    ],
  },
  two_step: { available: true, senior_total: 9, without_two_step: 2 },
  sign_outs: {
    available: true,
    truncated: false,
    items: [{ at: '2026-11-14T09:00:00+00:00', by: 'Team Sample', account: 'Signed Out Sample', community: 'Sample Timebank' }],
  },
  ...over,
});

const show = () =>
  render(
    <MemoryRouter>
      <SecurityPage />
    </MemoryRouter>,
  );

describe('SecurityPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: overview() });
  });

  it('asks the platform team request', async () => {
    show();

    await screen.findByTestId('security-two-step');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/security');
  });

  it('counts the senior accounts without two-step and links to the list', async () => {
    show();

    const section = await screen.findByTestId('security-two-step');
    expect(within(section).getByText('security.two_step.off|2')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: 'security.two_step.link' })).toHaveAttribute(
      'href',
      '/test/platform-team/senior-accounts',
    );
  });

  it('says so when every senior account has two-step', async () => {
    apiGet.mockResolvedValue({ success: true, data: overview({ two_step: { available: true, senior_total: 9, without_two_step: 0 } }) });
    show();

    expect(within(await screen.findByTestId('security-two-step')).getByText('security.two_step.all_on')).toBeInTheDocument();
  });

  it('shows the failed sign-in counts, since when they were counted, and each community', async () => {
    show();

    const section = await screen.findByTestId('security-failed');
    expect(screen.getByTestId('failed-last_hour')).toHaveTextContent('3');
    expect(screen.getByTestId('failed-last_24h')).toHaveTextContent('41');
    expect(screen.getByTestId('failed-addresses_15m')).toHaveTextContent('7');
    expect(screen.getByTestId('failed-most_from_one_15m')).toHaveTextContent('22');
    const since = new Date('2026-11-10T14:00:00+00:00').toLocaleDateString('en', { dateStyle: 'medium' });
    expect(within(section).getByText(`security.failed.counted_since|${since}`)).toBeInTheDocument();
    expect(within(section).queryByText('security.failed.nothing_counted')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('failed-community-2')).getByText('Sample Timebank')).toBeInTheDocument();
    expect(within(screen.getByTestId('failed-community-2')).getByText('30')).toBeInTheDocument();
    // A row with no community is named for what it is, not "None".
    expect(within(screen.getByTestId('failed-community-0')).getByText('security.failed.no_community')).toBeInTheDocument();
    // The per-community list has its own short heading.
    expect(within(section).getByRole('heading', { name: 'security.failed.by_community_title' })).toBeInTheDocument();
  });

  // A locked-out attacker's guesses never reach the password check: shown apart, never added in.
  it('shows the attempts refused by the lock-out beside the failed password checks', async () => {
    show();

    const section = await screen.findByTestId('security-failed');
    expect(within(section).getByText('security.failed.checks_title')).toBeInTheDocument();
    expect(within(section).getByText('security.failed.refused_title')).toBeInTheDocument();
    expect(screen.getByTestId('failed-refused_last_hour')).toHaveTextContent((1900).toLocaleString('en'));
    expect(screen.getByTestId('failed-refused_last_24h')).toHaveTextContent((2050).toLocaleString('en'));
    expect(screen.getByTestId('failed-last_24h')).toHaveTextContent('41');
    const community = screen.getByTestId('failed-community-2');
    expect(within(community).getByText('security.failed.col_refused')).toBeInTheDocument();
    expect(within(community).getByText((2040).toLocaleString('en'))).toBeInTheDocument();
  });

  it('puts each figure in the list as a term and its value, with nothing in between', async () => {
    show();

    await screen.findByTestId('security-failed');
    for (const key of ['last_hour', 'last_24h', 'refused_last_hour', 'addresses_15m']) {
      const item = screen.getByTestId(`failed-${key}`);
      expect(item.tagName).toBe('DIV');
      expect(item.parentElement?.tagName).toBe('DL');
      expect(Array.from(item.children).map((child) => child.tagName)).toEqual(['DT', 'DD']);
    }
  });

  // A quiet first day must not read as "nothing happened this week".
  it('says nothing has been counted yet, rather than showing zeros as if they covered a day', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: overview({
        failed_sign_ins: {
          available: true,
          // Nothing counted yet: the server sends no totals, not zeros.
          last_hour: null,
          last_24h: null,
          refused_last_hour: null,
          refused_last_24h: null,
          counted_since: null,
          addresses_15m: 1,
          most_from_one_address_15m: 2,
          by_community: [],
        },
      }),
    });
    show();

    const section = await screen.findByTestId('security-failed');
    expect(within(section).getByText('security.failed.nothing_counted')).toBeInTheDocument();
    expect(screen.queryByTestId('failed-last_hour')).not.toBeInTheDocument();
    expect(screen.queryByTestId('failed-last_24h')).not.toBeInTheDocument();
    expect(screen.queryByTestId('failed-refused_last_24h')).not.toBeInTheDocument();
    expect(within(section).queryByText('security.failed.empty')).not.toBeInTheDocument();
    expect(within(section).queryByText(/security\.failed\.counted_since/)).not.toBeInTheDocument();
    // The last-15-minutes figures come from another record and still show.
    expect(screen.getByTestId('failed-addresses_15m')).toHaveTextContent('1');
  });

  it('lists senior access given and removed, and says what is not recorded', async () => {
    show();

    const section = await screen.findByTestId('security-access');
    expect(within(section).getByText('Target Sample')).toBeInTheDocument();
    expect(within(section).getByText('Actor Sample')).toBeInTheDocument();
    expect(within(section).getByText('security.access.change.global_super_admin_granted')).toBeInTheDocument();
    // Platform team membership is set in the database: the page says it cannot show that.
    expect(within(section).getByText('security.access.note')).toBeInTheDocument();
  });

  it('lists who signed in as another member', async () => {
    show();

    const section = await screen.findByTestId('security-impersonation');
    expect(within(section).getByText('Admin Sample')).toBeInTheDocument();
    expect(within(section).getByText('Member Sample')).toBeInTheDocument();
  });

  it('lists the accounts the platform team signed out everywhere, and who did it', async () => {
    show();

    const section = await screen.findByTestId('security-sign-outs');
    expect(within(section).getByText('Signed Out Sample')).toBeInTheDocument();
    expect(within(section).getByText('Team Sample')).toBeInTheDocument();
    expect(within(section).getByText('Sample Timebank')).toBeInTheDocument();
    // The reason typed each time stays in the community's record: the page says so.
    expect(within(section).getByText('security.sign_outs.note')).toBeInTheDocument();
  });

  it('says in words when the platform team signed nobody out', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: overview({ sign_outs: { available: true, truncated: false, items: [] } }),
    });
    show();

    expect(await screen.findByText('security.sign_outs.empty|90')).toBeInTheDocument();
  });

  it('says "could not be checked" for the sign-outs when the record could not be read, or was not sent', async () => {
    apiGet.mockResolvedValue({ success: true, data: overview({ sign_outs: { available: false } }) });
    const first = show();

    const section = await screen.findByTestId('security-sign-outs');
    expect(within(section).getByText('security.unavailable')).toBeInTheDocument();
    expect(screen.queryByText('security.sign_outs.empty|90')).not.toBeInTheDocument();
    first.unmount();

    // A server that has not been updated yet sends no such section at all.
    const older = overview();
    delete older.sign_outs;
    apiGet.mockResolvedValue({ success: true, data: older });
    show();

    expect(within(await screen.findByTestId('security-sign-outs')).getByText('security.unavailable')).toBeInTheDocument();
    expect(screen.queryByText('security.sign_outs.empty|90')).not.toBeInTheDocument();
  });

  it('says a list is empty in words', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: overview({
        access_changes: { available: true, truncated: false, items: [] },
        impersonations: { available: true, truncated: false, items: [] },
      }),
    });
    show();

    expect(await screen.findByText('security.access.empty|90')).toBeInTheDocument();
    expect(screen.getByText('security.impersonation.empty|90')).toBeInTheDocument();
  });

  it('says a list was cut short', async () => {
    const data = overview();
    if (data.impersonations.available) data.impersonations.truncated = true;
    apiGet.mockResolvedValue({ success: true, data });
    show();

    expect(await screen.findByText('security.truncated|1')).toBeInTheDocument();
  });

  // "Could not be checked" must never be drawn as "nothing happened".
  it('says "could not be checked" for a section the server could not read, never an empty list', async () => {
    apiGet.mockResolvedValue({
      success: true,
      data: overview({
        access_changes: { available: false },
        impersonations: { available: false },
        failed_sign_ins: { available: false },
        two_step: { available: false },
      }),
    });
    show();

    await screen.findByTestId('security-two-step');
    expect(screen.getAllByText('security.unavailable')).toHaveLength(4);
    expect(screen.queryByText('security.access.empty|90')).not.toBeInTheDocument();
    expect(screen.queryByText('security.impersonation.empty|90')).not.toBeInTheDocument();
    expect(screen.queryByText('security.failed.empty')).not.toBeInTheDocument();
    expect(screen.queryByText('security.failed.nothing_counted')).not.toBeInTheDocument();
    expect(screen.queryByTestId('failed-last_24h')).not.toBeInTheDocument();
    expect(screen.queryByText('security.two_step.all_on')).not.toBeInTheDocument();
  });

  it('has no control that changes anything: one button, which reloads', async () => {
    show();
    await screen.findByTestId('security-two-step');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('shows the error card when the server refuses, and can try again', async () => {
    apiGet.mockResolvedValueOnce({ success: false, error: 'Forbidden' });
    show();

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('security-two-step')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(screen.getByTestId('security-two-step')).toBeInTheDocument());
  });
});
