// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet } = vi.hoisted(() => ({ apiGet: vi.fn() }));

vi.mock('@/lib/api', () => ({ api: { get: apiGet } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'names' in options) return `${key}|${String(options.names)}`;
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'days' in options) return `${key}|${String(options.days)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import { CommunityHealthPage, type CommunityHealth, type CommunityHealthRow } from './CommunityHealthPage';

const row = (over: Partial<CommunityHealthRow>): CommunityHealthRow => ({
  id: 2,
  name: 'Alpha Timebank',
  slug: 'alpha',
  is_active: true,
  members: 120,
  active_members: 40,
  new_members_this_month: 3,
  exchanges_this_month: 12,
  exchanges_last_month: 9,
  hours_this_month: 18.5,
  new_listings_this_month: 4,
  last_sign_in_at: '2026-11-15T10:00:00+00:00',
  quiet: false,
  ...over,
});

const health = (over: Partial<CommunityHealth> = {}): CommunityHealth => ({
  active_window_days: 30,
  unavailable: [],
  totals: {
    communities: 3,
    quiet: 1,
    members: 131,
    active_members: 41,
    new_members_this_month: 3,
    exchanges_this_month: 12,
    exchanges_last_month: 9,
    hours_this_month: 18.5,
    new_listings_this_month: 4,
  },
  communities: [
    row({}),
    row({
      id: 3, name: 'Beta Exchange', slug: 'beta', members: 11, active_members: 1, new_members_this_month: 0,
      exchanges_this_month: 0, exchanges_last_month: 0, hours_this_month: 0, new_listings_this_month: 0,
      last_sign_in_at: null, quiet: true,
    }),
    row({
      id: 4, name: 'Gamma Circle', slug: 'gamma', is_active: false, members: 0, active_members: 0,
      new_members_this_month: 0, exchanges_this_month: 0, exchanges_last_month: 0, hours_this_month: 0,
      new_listings_this_month: 0, last_sign_in_at: null, quiet: false,
    }),
  ],
  ...over,
});

const tableRow = (name: string): HTMLElement =>
  within(screen.getByTestId('community-health-table')).getByRole('row', { name: new RegExp(`^${name}`) });

describe('CommunityHealthPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: health() });
  });

  it('asks the platform team request and draws a row per community', async () => {
    render(<CommunityHealthPage />);

    await screen.findByTestId('community-health-table');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/community-health');
    for (const name of ['Alpha Timebank', 'Beta Exchange', 'Gamma Circle']) {
      expect(tableRow(name)).toBeInTheDocument();
    }
    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    expect(alpha[0]).toHaveTextContent('120');
    expect(alpha[1]).toHaveTextContent('40');
    expect(alpha[5]).toHaveTextContent('18.5');
  });

  it('names the quiet communities and says the rule in words', async () => {
    render(<CommunityHealthPage />);

    const summary = await screen.findByTestId('community-health-quiet');
    expect(summary).toHaveTextContent('community_health.quiet_count|1');
    expect(summary).toHaveTextContent('community_health.quiet_names|Beta Exchange');
    expect(screen.getByText('community_health.quiet_rule|30')).toBeInTheDocument();
    expect(tableRow('Beta Exchange')).toHaveTextContent('community_health.quiet');
    expect(tableRow('Alpha Timebank')).not.toHaveTextContent('community_health.quiet');
  });

  it('says when no community is quiet', async () => {
    const data = health();
    data.communities = data.communities.map((c) => ({ ...c, quiet: false }));
    data.totals.quiet = 0;
    apiGet.mockResolvedValue({ success: true, data });
    render(<CommunityHealthPage />);

    expect(await screen.findByText('community_health.none_quiet')).toBeInTheDocument();
  });

  it('marks a community that is switched off, and does not call it quiet', async () => {
    render(<CommunityHealthPage />);
    await screen.findByTestId('community-health-table');

    expect(tableRow('Gamma Circle')).toHaveTextContent('community_health.not_active');
    expect(tableRow('Gamma Circle')).not.toHaveTextContent('community_health.quiet');
  });

  it('says a community has had no sign-in, rather than leaving a blank', async () => {
    render(<CommunityHealthPage />);
    await screen.findByTestId('community-health-table');

    expect(tableRow('Beta Exchange')).toHaveTextContent('community_health.never_signed_in');
  });

  it('shows a total row for the whole platform', async () => {
    render(<CommunityHealthPage />);
    await screen.findByTestId('community-health-table');

    const totals = within(tableRow('community_health.totals_row')).getAllByRole('cell');
    expect(totals[0]).toHaveTextContent('131');
  });

  it('shows a figure that could not be read as not available, never as zero', async () => {
    const data = health({ unavailable: ['exchanges_this_month'] });
    data.communities = data.communities.map((c) => ({ ...c, exchanges_this_month: null, hours_this_month: null, quiet: null }));
    data.totals.exchanges_this_month = null;
    data.totals.hours_this_month = null;
    apiGet.mockResolvedValue({ success: true, data });
    render(<CommunityHealthPage />);

    expect(await screen.findByText('community_health.unavailable_note')).toBeInTheDocument();
    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    expect(alpha[3]).toHaveTextContent('community_health.not_available');
    expect(alpha[3]).not.toHaveTextContent('0');
    expect(tableRow('Alpha Timebank')).toHaveTextContent('community_health.quiet_unknown');
  });

  it('gives a narrow screen one card per community', async () => {
    render(<CommunityHealthPage />);

    const list = await screen.findByTestId('community-health-list');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[1]).toHaveTextContent('Beta Exchange');
    expect(cards[1]).toHaveTextContent('community_health.quiet');
  });

  it('says the last sign-in could not be read, not that nobody signed in, when the server could not read it', async () => {
    const data = health({ unavailable: ['last_sign_in_at'] });
    data.communities = data.communities.map((c) => ({ ...c, last_sign_in_at: null }));
    apiGet.mockResolvedValue({ success: true, data });
    render(<CommunityHealthPage />);
    await screen.findByTestId('community-health-table');

    for (const name of ['Alpha Timebank', 'Beta Exchange', 'Gamma Circle']) {
      const cells = within(tableRow(name)).getAllByRole('cell');
      expect(cells[cells.length - 1]).toHaveTextContent('community_health.not_available');
      expect(cells[cells.length - 1]).not.toHaveTextContent('community_health.never_signed_in');
    }
    const cards = within(screen.getByTestId('community-health-list')).getAllByRole('listitem');
    expect(cards[0]).not.toHaveTextContent('community_health.never_signed_in');
  });

  it('never says no community is quiet when it could not tell', async () => {
    const data = health();
    data.communities = data.communities.map((c) => ({ ...c, quiet: c.is_active ? null : false }));
    data.totals.quiet = 0;
    apiGet.mockResolvedValue({ success: true, data });
    render(<CommunityHealthPage />);

    const summary = await screen.findByTestId('community-health-quiet');
    expect(summary).toHaveTextContent('community_health.quiet_unknown_summary');
    expect(summary).not.toHaveTextContent('community_health.none_quiet');
  });

  it('draws only the figures it knows: a stray name in the reply never reaches the screen', async () => {
    const data = health();
    data.communities = data.communities.map(
      (c) => ({ ...c, top_member: 'Mary Planted-Surname', owner: 'Seán Planted' }) as CommunityHealthRow,
    );
    apiGet.mockResolvedValue({ success: true, data });
    const { container } = render(<CommunityHealthPage />);
    await screen.findByTestId('community-health-table');

    expect(container).not.toHaveTextContent('Planted');
  });

  it('shows the error card when the reply cannot be loaded, and tries again', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<CommunityHealthPage />);

    const retry = await screen.findByRole('button', { name: 'couldnt_load_retry' });
    expect(screen.queryByTestId('community-health-table')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('community-health-table')).toBeInTheDocument();
  });

  it('shows the error card for a reply without a list', async () => {
    apiGet.mockResolvedValue({ success: true, data: { totals: {} } });
    render(<CommunityHealthPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('community-health-table')).not.toBeInTheDocument();
    expect(screen.getByText('community_health.load_error_title')).toBeInTheDocument();
  });

  // The server keeps these figures for a short while. The first look uses the
  // kept ones; "Check again" asks for them to be worked out again.
  it('works the figures out again only when "Check again" is pressed, and says when they are from', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...health(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<CommunityHealthPage />);

    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/community-health');
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));
    await waitFor(() => expect(apiGet).toHaveBeenLastCalledWith('/v2/platform-team/community-health?refresh=1'));
  });

  it('says nothing about when the figures are from when the server does not say', async () => {
    render(<CommunityHealthPage />);

    await waitFor(() => expect(apiGet).toHaveBeenCalled());
    await screen.findByRole('button', { name: 'home.refresh' });
    expect(screen.queryByText(/^shared\.figures_from/)).not.toBeInTheDocument();
  });

  it('keeps the figures on screen and says so when checking again is refused', async () => {
    apiGet.mockResolvedValue({ success: true, data: { ...health(), generated_at: '2026-11-16T10:05:00+00:00' } });
    render(<CommunityHealthPage />);
    expect(await screen.findByText(/^shared\.figures_from/)).toBeInTheDocument();

    apiGet.mockResolvedValue({ success: false, code: 'RATE_LIMIT_EXCEEDED', error: 'Too many requests' });
    fireEvent.click(screen.getByRole('button', { name: 'home.refresh' }));

    expect(await screen.findByText('translations.recount_refused')).toBeInTheDocument();
    expect(screen.queryByTestId('load-error')).not.toBeInTheDocument();
    expect(screen.getByText(/^shared\.figures_from/)).toBeInTheDocument();
  });
});
