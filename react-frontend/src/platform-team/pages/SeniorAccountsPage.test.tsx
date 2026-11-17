// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const { apiGet, apiPost, toast, auth } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  auth: { user: { id: 1 } as { id: number } | null },
}));

vi.mock('@/lib/api', () => ({
  api: { get: apiGet, post: apiPost },
  AUTH_STEP_UP_REQUIRED: 'AUTH_STEP_UP_REQUIRED',
}));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useToast: () => toast,
  useAuth: () => ({ user: auth.user, isAuthenticated: true }),
}));
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

const FIND = '/v2/platform-team/accounts/find';
const addUrl = (id: number) => `/v2/platform-team/senior-accounts/${id}/add-to-team`;
const removeUrl = (id: number) => `/v2/platform-team/senior-accounts/${id}/remove-from-team`;

/** What the Find an account request sends back for one account. */
const match = (over: Record<string, unknown> = {}) => ({
  id: 41,
  name: 'Sample Person',
  community: { id: 2, name: 'Riverside Timebank', slug: 'riverside' },
  status: 'active',
  role: 'member',
  level: null,
  last_sign_in_at: null,
  two_step_on: true,
  has_passkey: false,
  signed_in_now: 0,
  ...over,
});

const row = (id: number) => screen.findByTestId(`senior-account-${id}`);

describe('SeniorAccountsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toast.success.mockReset();
    auth.user = { id: 1 };
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

  describe('adding and removing platform team members', () => {
    const team = () =>
      list([
        account({ id: 1, name: 'Me Sample' }),
        account({ id: 2, name: 'Bo Sample' }),
        account({ id: 3, name: 'Cy Sample', level: 'global_super_admin' }),
        account({ id: 4, name: 'Di Sample', level: 'global_super_admin', two_step_on: false }),
        account({ id: 5, name: 'Ed Sample', level: 'global_super_admin', status: 'suspended' }),
        account({ id: 6, name: 'Flo Sample', level: 'tenant_super_admin' }),
        account({ id: 7, name: 'Gus Sample', level: 'platform_flag_only', incomplete_platform_team: true }),
      ]);

    beforeEach(() => {
      apiGet.mockResolvedValue(reply(team()));
      apiPost.mockResolvedValue({ success: true, data: { added: true, user_id: 3 } });
    });

    it('offers to remove a member, but never yourself', async () => {
      render(<SeniorAccountsPage />);

      expect(within(await row(2)).getByRole('button', { name: 'senior_accounts.remove' })).toBeInTheDocument();
      const mine = await row(1);
      expect(within(mine).queryByRole('button')).not.toBeInTheDocument();
      expect(within(mine).getByText('senior_accounts.is_you')).toBeInTheDocument();
    });

    it('offers to add a global super admin only when the account is active and has two-step on', async () => {
      render(<SeniorAccountsPage />);

      expect(within(await row(3)).getByRole('button', { name: 'senior_accounts.add' })).toBeInTheDocument();
      const noTwoStep = await row(4);
      expect(within(noTwoStep).queryByRole('button')).not.toBeInTheDocument();
      expect(within(noTwoStep).getByText('senior_accounts.needs_two_step')).toBeInTheDocument();
      const suspended = await row(5);
      expect(within(suspended).queryByRole('button')).not.toBeInTheDocument();
      expect(within(suspended).getByText('senior_accounts.not_active_note')).toBeInTheDocument();
    });

    it('offers nothing on a tenant super admin, and both ways to put a half-set account right', async () => {
      render(<SeniorAccountsPage />);

      expect(within(await row(6)).queryByRole('button')).not.toBeInTheDocument();
      const halfSet = await row(7);
      expect(within(halfSet).getByRole('button', { name: 'senior_accounts.add' })).toBeInTheDocument();
      expect(within(halfSet).getByRole('button', { name: 'senior_accounts.remove_mark' })).toBeInTheDocument();
    });

    it('asks first, then adds, says so and loads the list again', async () => {
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(3)).getByRole('button', { name: 'senior_accounts.add' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('senior_accounts.confirm.add_title')).toBeInTheDocument();
      expect(within(dialog).getByText('senior_accounts.confirm.add_text')).toBeInTheDocument();
      // Already a global super admin: the box does not say it will become one.
      expect(within(dialog).queryByText('senior_accounts.confirm.add_also_global')).not.toBeInTheDocument();
      expect(within(dialog).getByText('senior_accounts.confirm.recorded')).toBeInTheDocument();
      expect(apiPost).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.add' }));

      await waitFor(() => expect(apiPost).toHaveBeenCalledWith(addUrl(3)));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('senior_accounts.added_toast'));
      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    });

    it('asks first, then removes a member', async () => {
      apiPost.mockResolvedValue({ success: true, data: { removed: true, user_id: 2 } });
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(2)).getByRole('button', { name: 'senior_accounts.remove' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('senior_accounts.confirm.remove_title')).toBeInTheDocument();
      expect(within(dialog).getByText('senior_accounts.confirm.remove_text')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.remove' }));

      await waitFor(() => expect(apiPost).toHaveBeenCalledWith(removeUrl(2)));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('senior_accounts.removed_toast'));
      await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    });

    it('takes the mark off a half-set account, in its own words', async () => {
      apiPost.mockResolvedValue({ success: true, data: { removed: true, user_id: 7 } });
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(7)).getByRole('button', { name: 'senior_accounts.remove_mark' }));

      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('senior_accounts.confirm.remove_mark_title')).toBeInTheDocument();
      expect(within(dialog).getByText('senior_accounts.confirm.remove_mark_text')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.remove_mark' }));

      await waitFor(() => expect(apiPost).toHaveBeenCalledWith(removeUrl(7)));
      await waitFor(() => expect(toast.success).toHaveBeenCalledWith('senior_accounts.mark_removed_toast'));
    });

    it('does nothing when the box is closed without confirming', async () => {
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(3)).getByRole('button', { name: 'senior_accounts.add' }));
      const dialog = await screen.findByRole('alertdialog');

      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.confirm.cancel' }));

      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(apiPost).not.toHaveBeenCalled();
      expect(apiGet).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['AUTH_STEP_UP_REQUIRED', 'step_cancelled'],
      ['PLATFORM_TEAM_TWO_STEP_REQUIRED', 'two_step'],
      ['PLATFORM_TEAM_ACCOUNT_NOT_ACTIVE', 'not_active'],
      ['PLATFORM_TEAM_ALREADY_MEMBER', 'already'],
      ['PLATFORM_TEAM_NOT_A_MEMBER', 'not_member'],
      ['NOT_FOUND', 'gone'],
      ['RATE_LIMIT_EXCEEDED', 'too_many'],
      ['SERVER_ERROR', 'failed'],
    ])('keeps the box open and says why when the server answers %s', async (code, wording) => {
      apiPost.mockResolvedValue({ success: false, code });
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(3)).getByRole('button', { name: 'senior_accounts.add' }));
      const dialog = await screen.findByRole('alertdialog');

      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.add' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(`senior_accounts.confirm.error.${wording}`);
      expect(toast.success).not.toHaveBeenCalled();
      // Nothing was changed, so the list is not loaded again.
      expect(apiGet).toHaveBeenCalledTimes(1);
    });

    it('says it did not work when the request throws', async () => {
      apiPost.mockRejectedValue(new Error('network'));
      render(<SeniorAccountsPage />);
      fireEvent.click(within(await row(3)).getByRole('button', { name: 'senior_accounts.add' }));
      const dialog = await screen.findByRole('alertdialog');

      fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.add' }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent('senior_accounts.confirm.error.failed');
    });

    describe('adding someone who is not on the list', () => {
      const openFinder = async () => {
        await row(1);
        fireEvent.click(screen.getByRole('button', { name: 'senior_accounts.add_someone' }));
        return screen.findByTestId('add-someone');
      };

      const search = (finder: HTMLElement, address: string) => {
        fireEvent.change(within(finder).getByLabelText(/accounts\.email_label/), { target: { value: address } });
        fireEvent.click(within(finder).getByRole('button', { name: 'accounts.find' }));
      };

      it('is closed until asked for, and sends nothing until an address is searched', async () => {
        render(<SeniorAccountsPage />);
        await row(1);
        expect(screen.queryByTestId('add-someone')).not.toBeInTheDocument();

        await openFinder();
        expect(apiPost).not.toHaveBeenCalled();
      });

      it('will not search for part of an address', async () => {
        render(<SeniorAccountsPage />);
        const finder = await openFinder();

        search(finder, 'not-an-address');

        expect(await within(finder).findByText('accounts.email_invalid')).toBeInTheDocument();
        expect(apiPost).not.toHaveBeenCalled();
      });

      it('finds the account by its whole address, sent in the body, and adds it after asking', async () => {
        apiPost.mockImplementation((url: string) =>
          Promise.resolve(
            url === FIND
              ? { success: true, data: { matches: [match()], truncated: false } }
              : { success: true, data: { added: true, user_id: 41 } },
          ),
        );
        render(<SeniorAccountsPage />);
        const finder = await openFinder();

        search(finder, ' sample.person@example.org ');

        const found = await within(finder).findByTestId('found-account-41');
        expect(apiPost).toHaveBeenCalledWith(FIND, { email: 'sample.person@example.org' });
        expect(within(found).getByText('Sample Person')).toBeInTheDocument();
        expect(within(found).getByText('Riverside Timebank')).toBeInTheDocument();

        fireEvent.click(within(found).getByRole('button', { name: 'senior_accounts.add' }));
        const dialog = await screen.findByRole('alertdialog');
        // Not a global super admin yet: the box says it will become one.
        expect(within(dialog).getByText('senior_accounts.confirm.add_also_global')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', { name: 'senior_accounts.add' }));

        await waitFor(() => expect(apiPost).toHaveBeenCalledWith(addUrl(41)));
        await waitFor(() => expect(toast.success).toHaveBeenCalledWith('senior_accounts.added_toast'));
        // The list is loaded again, and the finder is put away.
        await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(screen.queryByTestId('add-someone')).not.toBeInTheDocument());
      });

      it('offers no button for an account that is on the team already, has no two-step, or is not active', async () => {
        apiPost.mockResolvedValue({
          success: true,
          data: {
            matches: [
              match({ id: 51, level: 'platform_team' }),
              match({ id: 52, two_step_on: false }),
              match({ id: 53, status: 'suspended' }),
              match({ id: 54, status: 'deleted' }),
            ],
            truncated: false,
          },
        });
        render(<SeniorAccountsPage />);
        const finder = await openFinder();
        search(finder, 'sample.person@example.org');

        const onTeam = await within(finder).findByTestId('found-account-51');
        expect(within(onTeam).queryByRole('button')).not.toBeInTheDocument();
        expect(within(onTeam).getByText('senior_accounts.find.on_team')).toBeInTheDocument();
        expect(
          within(within(finder).getByTestId('found-account-52')).getByText('senior_accounts.needs_two_step'),
        ).toBeInTheDocument();
        expect(
          within(within(finder).getByTestId('found-account-53')).getByText('senior_accounts.not_active_note'),
        ).toBeInTheDocument();
        expect(
          within(within(finder).getByTestId('found-account-54')).getByText('senior_accounts.not_active_note'),
        ).toBeInTheDocument();
        expect(within(finder).queryByRole('button', { name: 'senior_accounts.add' })).not.toBeInTheDocument();
      });

      it('says so when no account uses the address, when there were too many searches, and when it could not search', async () => {
        render(<SeniorAccountsPage />);
        const finder = await openFinder();

        apiPost.mockResolvedValueOnce({ success: true, data: { matches: [], truncated: false } });
        search(finder, 'nobody@example.org');
        expect(await within(finder).findByText('accounts.none')).toBeInTheDocument();

        apiPost.mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' });
        search(finder, 'nobody@example.org');
        expect(await within(finder).findByText('accounts.too_many')).toBeInTheDocument();

        apiPost.mockRejectedValueOnce(new Error('network'));
        search(finder, 'nobody@example.org');
        expect(await within(finder).findByText('accounts.search_error_title')).toBeInTheDocument();
        // Never "no account uses that address" for a search that was not made.
        expect(within(finder).queryByText('accounts.none')).not.toBeInTheDocument();
      });
    });
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
