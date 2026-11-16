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
      if (options && 'from' in options) return `${key}|${String(options.from)}-${String(options.to)}`;
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

import {
  DataRequestsPage,
  type DataRequests,
  type DataRequestsRow,
  type RequestType,
} from './DataRequestsPage';

const none = (): Record<RequestType, number> => ({
  access: 0, erasure: 0, rectification: 0, restriction: 0, portability: 0, objection: 0,
});

const row = (over: Partial<DataRequestsRow>): DataRequestsRow => ({
  id: 2,
  name: 'Alpha Timebank',
  slug: 'alpha',
  is_active: true,
  open: 3,
  open_by_type: { ...none(), access: 2, erasure: 1 },
  overdue: 1,
  nearly_due: 1,
  oldest_open_days: 41,
  completed_last_90_days: 5,
  ...over,
});

const reply = (over: Partial<DataRequests> = {}): DataRequests => ({
  overdue_after_days: 30,
  nearly_due_from_days: 25,
  completed_window_days: 90,
  request_types: ['access', 'erasure', 'rectification', 'restriction', 'portability', 'objection'],
  unavailable: [],
  totals: {
    communities: 3,
    open: 4,
    open_by_type: { ...none(), access: 2, erasure: 1, objection: 1 },
    overdue: 1,
    nearly_due: 1,
    oldest_open_days: 41,
    completed_last_90_days: 7,
    completed_without_date: 0,
  },
  communities: [
    row({}),
    row({
      id: 3, name: 'Beta Exchange', slug: 'beta', open: 1, open_by_type: { ...none(), objection: 1 },
      overdue: 0, nearly_due: 0, oldest_open_days: 4, completed_last_90_days: 2,
    }),
    row({
      id: 4, name: 'Gamma Circle', slug: 'gamma', is_active: false, open: 0, open_by_type: none(),
      overdue: 0, nearly_due: 0, oldest_open_days: null, completed_last_90_days: 0,
    }),
  ],
  ...over,
});

const tableRow = (name: string): HTMLElement =>
  within(screen.getByTestId('data-requests-table')).getByRole('row', { name: new RegExp(`^${name}`) });

describe('DataRequestsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockResolvedValue({ success: true, data: reply() });
  });

  it('asks the platform team request and draws a row per community', async () => {
    render(<DataRequestsPage />);

    await screen.findByTestId('data-requests-table');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/data-requests');
    for (const name of ['Alpha Timebank', 'Beta Exchange', 'Gamma Circle']) {
      expect(tableRow(name)).toBeInTheDocument();
    }
    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    expect(alpha[0]).toHaveTextContent('3');
    expect(alpha[1]).toHaveTextContent('1');
    expect(alpha[3]).toHaveTextContent('41');
    expect(alpha[4]).toHaveTextContent('5');
  });

  it('names each kind of open request plainly, and only the kinds that are open', async () => {
    render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');

    const alpha = tableRow('Alpha Timebank');
    expect(alpha).toHaveTextContent('data_requests.type.access');
    expect(alpha).toHaveTextContent('data_requests.type.erasure');
    expect(alpha).not.toHaveTextContent('data_requests.type.objection');
    expect(tableRow('Beta Exchange')).toHaveTextContent('data_requests.type.objection');
  });

  it('says what overdue means and that the clock starts when the request was made', async () => {
    render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');

    expect(screen.getByText('data_requests.overdue_rule|30')).toBeInTheDocument();
    expect(screen.getByText('data_requests.nearly_due_rule|25-30')).toBeInTheDocument();
  });

  it('names the communities with overdue requests', async () => {
    render(<DataRequestsPage />);

    const summary = await screen.findByTestId('data-requests-overdue');
    expect(summary).toHaveTextContent('data_requests.overdue_count|1');
    expect(summary).toHaveTextContent('data_requests.overdue_names|Alpha Timebank');
    expect(summary).not.toHaveTextContent('Beta Exchange');
  });

  it('says when nothing is overdue', async () => {
    const data = reply();
    data.communities = data.communities.map((c) => ({ ...c, overdue: 0 }));
    data.totals.overdue = 0;
    apiGet.mockResolvedValue({ success: true, data });
    render(<DataRequestsPage />);

    expect(await screen.findByText('data_requests.none_overdue')).toBeInTheDocument();
  });

  it('lists a community with nothing open, and says so rather than leaving it blank', async () => {
    render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');

    const gamma = tableRow('Gamma Circle');
    expect(gamma).toHaveTextContent('data_requests.nothing_open');
    expect(gamma).toHaveTextContent('data_requests.not_active');
  });

  it('shows a total row for the whole platform', async () => {
    render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');

    const totals = within(tableRow('data_requests.totals_row')).getAllByRole('cell');
    expect(totals[0]).toHaveTextContent('4');
    expect(totals[4]).toHaveTextContent('7');
  });

  it('shows a figure that could not be read as not available, never as zero', async () => {
    const data = reply({ unavailable: ['overdue'] });
    data.communities = data.communities.map((c) => ({ ...c, overdue: null }));
    data.totals.overdue = null;
    apiGet.mockResolvedValue({ success: true, data });
    render(<DataRequestsPage />);

    expect(await screen.findByText('data_requests.unavailable_note')).toBeInTheDocument();
    const alpha = within(tableRow('Alpha Timebank')).getAllByRole('cell');
    expect(alpha[1]).toHaveTextContent('data_requests.not_available');
    expect(alpha[1]).not.toHaveTextContent('0');
    expect(screen.getByTestId('data-requests-overdue')).toHaveTextContent('data_requests.overdue_unknown');
  });

  // Completed with no completion date: counted apart, said once, only when there are some.
  it('says how many completed requests have no completion date, only when there are some', async () => {
    const { unmount } = render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');
    expect(screen.queryByTestId('data-requests-without-date')).not.toBeInTheDocument();
    unmount();

    apiGet.mockResolvedValue({
      success: true,
      data: reply({ totals: { ...reply().totals, completed_without_date: 3 } }),
    });
    render(<DataRequestsPage />);

    expect(await screen.findByTestId('data-requests-without-date')).toHaveTextContent(
      'data_requests.completed_without_date|3',
    );
  });

  it('gives a narrow screen one card per community', async () => {
    render(<DataRequestsPage />);

    const list = await screen.findByTestId('data-requests-list');
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(3);
    expect(cards[0]).toHaveTextContent('Alpha Timebank');
    expect(cards[0]).toHaveTextContent('data_requests.type.erasure');
  });

  it('names no member and no request: counts only', async () => {
    render(<DataRequestsPage />);
    await screen.findByTestId('data-requests-table');

    expect(screen.getByText('data_requests.counts_only')).toBeInTheDocument();
  });

  it('shows the error card when the reply cannot be loaded, and tries again', async () => {
    apiGet.mockRejectedValueOnce(new Error('boom'));
    render(<DataRequestsPage />);

    const retry = await screen.findByRole('button', { name: 'couldnt_load_retry' });
    expect(screen.queryByTestId('data-requests-table')).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('data-requests-table')).toBeInTheDocument();
  });

  it('shows the error card for a reply without a list', async () => {
    apiGet.mockResolvedValue({ success: true, data: { totals: {} } });
    render(<DataRequestsPage />);

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByTestId('data-requests-table')).not.toBeInTheDocument();
    expect(screen.getByText('data_requests.load_error_title')).toBeInTheDocument();
  });
});
