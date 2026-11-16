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
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && 'count' in options) return `${key}|${String(options.count)}`;
      if (options && 'days' in options) return `${key}|${String(options.days)}`;
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
    addresses_24h: 7,
    most_from_one_address_24h: 22,
    by_community: [
      { community: { id: 2, name: 'Sample Timebank' }, failed: 30, accounts_tried: 4, most_on_one_account: 19, last_at: '2026-11-16T09:30:00+00:00' },
      { community: null, failed: 11, accounts_tried: 11, most_on_one_account: 1, last_at: null },
    ],
  },
  two_step: { available: true, senior_total: 9, without_two_step: 2 },
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

  it('shows the failed sign-in counts and each community', async () => {
    show();

    await screen.findByTestId('security-failed');
    expect(screen.getByTestId('failed-last_hour')).toHaveTextContent('3');
    expect(screen.getByTestId('failed-last_24h')).toHaveTextContent('41');
    expect(screen.getByTestId('failed-addresses')).toHaveTextContent('7');
    expect(screen.getByTestId('failed-most_from_one')).toHaveTextContent('22');
    expect(within(screen.getByTestId('failed-community-2')).getByText('Sample Timebank')).toBeInTheDocument();
    expect(within(screen.getByTestId('failed-community-0')).getByText('senior_accounts.no_community')).toBeInTheDocument();
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
