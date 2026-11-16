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
    t: (key: string, options?: Record<string, unknown>) =>
      options && 'count' in options ? `${key}|${String(options.count)}` : key,
    i18n: { language: 'en' },
  }),
}));

import { SeniorAccountsPage, type SeniorAccount, type SeniorAccountsList } from './SeniorAccountsPage';

const account = (over: Partial<SeniorAccount>): SeniorAccount => ({
  id: 1,
  name: 'Alex Sample',
  email: 'alex@example.test',
  level: 'platform_team',
  incomplete_platform_team: false,
  community: { id: 1, name: 'Platform' },
  status: 'active',
  last_sign_in_at: '2026-11-10T09:00:00+00:00',
  two_step_on: true,
  has_passkey: false,
  ...over,
});

const list = (accounts: SeniorAccount[], over: Partial<SeniorAccountsList> = {}): SeniorAccountsList => ({
  total: accounts.length,
  truncated: false,
  counts: {
    platform_team: accounts.filter((a) => a.level === 'platform_team').length,
    global_super_admin: accounts.filter((a) => a.level === 'global_super_admin').length,
    tenant_super_admin: accounts.filter((a) => a.level === 'tenant_super_admin').length,
    platform_flag_only: accounts.filter((a) => a.level === 'platform_flag_only').length,
  },
  accounts,
  ...over,
});

const reply = (data: SeniorAccountsList) => ({ success: true, data });

describe('SeniorAccountsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('asks the platform team request and groups the accounts by level', async () => {
    apiGet.mockResolvedValue(
      reply(
        list([
          account({ id: 1, name: 'Alex Sample' }),
          account({ id: 2, name: 'Bo Sample', level: 'global_super_admin' }),
          account({ id: 3, name: 'Cy Sample', level: 'tenant_super_admin', community: { id: 2, name: 'Sample Timebank' } }),
        ]),
      ),
    );
    render(<SeniorAccountsPage />);

    const team = await screen.findByTestId('senior-level-platform_team');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/senior-accounts');
    expect(within(team).getByText('Alex Sample')).toBeInTheDocument();
    expect(within(screen.getByTestId('senior-level-global_super_admin')).getByText('Bo Sample')).toBeInTheDocument();
    const tenantSupers = screen.getByTestId('senior-level-tenant_super_admin');
    expect(within(tenantSupers).getByText('Cy Sample')).toBeInTheDocument();
    expect(within(tenantSupers).getByText('Sample Timebank')).toBeInTheDocument();
  });

  it('says whether two-step is on for each account, and counts the ones without', async () => {
    apiGet.mockResolvedValue(
      reply(list([account({ id: 1 }), account({ id: 2, two_step_on: false, has_passkey: true })])),
    );
    render(<SeniorAccountsPage />);

    const on = await screen.findByTestId('senior-account-1');
    expect(within(on).getByText('senior_accounts.two_step_on')).toBeInTheDocument();
    expect(within(on).queryByText('senior_accounts.passkey')).not.toBeInTheDocument();
    const off = screen.getByTestId('senior-account-2');
    expect(within(off).getByText('senior_accounts.two_step_off')).toBeInTheDocument();
    expect(within(off).getByText('senior_accounts.passkey')).toBeInTheDocument();
    expect(screen.getByTestId('two-step-summary')).toHaveTextContent('senior_accounts.without_two_step|1');
  });

  it('says so when every account has two-step', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1 })])));
    render(<SeniorAccountsPage />);

    expect(await screen.findByTestId('two-step-summary')).toHaveTextContent('senior_accounts.all_have_two_step');
  });

  it('says "never" for an account that has not signed in, and names an account that is not active', async () => {
    apiGet.mockResolvedValue(
      reply(list([account({ id: 1, last_sign_in_at: null, status: 'suspended' }), account({ id: 2, status: 'something-new' })])),
    );
    render(<SeniorAccountsPage />);

    const row = await screen.findByTestId('senior-account-1');
    expect(within(row).getByText('senior_accounts.never')).toBeInTheDocument();
    expect(within(row).getByText('senior_accounts.status.suspended')).toBeInTheDocument();
    expect(within(screen.getByTestId('senior-account-2')).getByText('senior_accounts.status.other')).toBeInTheDocument();
  });

  it('copes with an account that has no name and no community', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1, name: null, community: null })])));
    render(<SeniorAccountsPage />);

    const row = await screen.findByTestId('senior-account-1');
    expect(within(row).getByText('senior_accounts.unnamed')).toBeInTheDocument();
    expect(within(row).getByText('senior_accounts.no_community')).toBeInTheDocument();
  });

  it('shows the half-set platform team mark only when an account has it', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1 })])));
    const { unmount } = render(<SeniorAccountsPage />);
    await screen.findByTestId('senior-level-platform_team');
    expect(screen.queryByTestId('senior-level-platform_flag_only')).not.toBeInTheDocument();
    unmount();

    apiGet.mockResolvedValue(
      reply(
        list([
          account({ id: 1 }),
          account({ id: 2, level: 'platform_flag_only', incomplete_platform_team: true }),
          account({ id: 3, level: 'tenant_super_admin', incomplete_platform_team: true }),
        ]),
      ),
    );
    render(<SeniorAccountsPage />);

    expect(await screen.findByTestId('senior-level-platform_flag_only')).toBeInTheDocument();
    expect(within(screen.getByTestId('senior-account-3')).getByText('senior_accounts.incomplete')).toBeInTheDocument();
  });

  it('says a level is empty instead of leaving a gap', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1 })])));
    render(<SeniorAccountsPage />);

    const globals = await screen.findByTestId('senior-level-global_super_admin');
    expect(within(globals).getByText('senior_accounts.none_at_level')).toBeInTheDocument();
  });

  it('warns when the list was cut short', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1 })], { truncated: true })));
    render(<SeniorAccountsPage />);

    expect(await screen.findByText('senior_accounts.truncated|1')).toBeInTheDocument();
  });

  // The way to the top tier is not a web button.
  it('has no control that changes anything: the only button reloads the list', async () => {
    apiGet.mockResolvedValue(reply(list([account({ id: 1 }), account({ id: 2, level: 'tenant_super_admin' })])));
    render(<SeniorAccountsPage />);
    await screen.findByTestId('senior-account-1');

    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['home.refresh']);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('shows the error card, not an empty list, when the server refuses', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<SeniorAccountsPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByTestId('senior-level-platform_team')).not.toBeInTheDocument();
  });

  it('shows the error card when the request throws, and can try again', async () => {
    apiGet.mockRejectedValueOnce(new Error('network'));
    apiGet.mockResolvedValue(reply(list([account({ id: 1 })])));
    render(<SeniorAccountsPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'couldnt_load_retry' }));
    await waitFor(() => expect(screen.getByTestId('senior-account-1')).toBeInTheDocument());
  });
});
