// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';

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

import { FindAccountPage, type AccountMatch } from './FindAccountPage';

const FIND = '/v2/platform-team/accounts/find';
const ADDRESS = 'sample.person@example.org';

const match = (over: Partial<AccountMatch> = {}): AccountMatch => ({
  id: 41,
  name: 'Sample Person',
  community: { id: 2, name: 'Riverside Timebank', slug: 'riverside' },
  status: 'active',
  role: 'member',
  level: null,
  last_sign_in_at: '2026-11-10T09:30:00+00:00',
  two_step_on: true,
  has_passkey: false,
  signed_in_now: 3,
  ...over,
});

const found = (matches: AccountMatch[], truncated = false) => ({ success: true, data: { matches, truncated } });

const search = (address = ADDRESS) => {
  fireEvent.change(screen.getByLabelText(/^Email address/), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: 'Find' }));
};

const card = (id: number) => screen.findByTestId(`account-${id}`);

const openDialog = async (id = 41) => {
  fireEvent.click(within(await card(id)).getByRole('button', { name: 'Sign out everywhere' }));
  return screen.findByRole('alertdialog');
};

const typeReason = (dialog: HTMLElement, reason: string) =>
  fireEvent.change(within(dialog).getByLabelText(/^Why are you doing this/), { target: { value: reason } });

describe('FindAccountPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    auth.user = { id: 1 };
    apiPost.mockImplementation((url: string) =>
      Promise.resolve(url === FIND ? found([match()]) : { success: true, data: { signed_out: true } }),
    );
  });

  it('asks the server for nothing until an address is searched for', () => {
    render(<FindAccountPage />);

    expect(screen.getByRole('heading', { level: 1, name: 'Find an account' })).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.queryByText('No account uses that address')).not.toBeInTheDocument();
  });

  it('sends the whole address in the body of the request, never in its address', async () => {
    render(<FindAccountPage />);
    search(`  ${ADDRESS} `);

    await card(41);
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(apiPost).toHaveBeenCalledWith(FIND, { email: ADDRESS });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('does not send something that is not one whole address', () => {
    render(<FindAccountPage />);

    for (const partial of ['', 'sample', 'sample@', '@example.org', 'two words@example.org']) {
      search(partial);
    }

    expect(apiPost).not.toHaveBeenCalled();
    expect(screen.getByText('Type one whole email address, such as name@example.org.')).toBeInTheDocument();
  });

  it('shows each account that uses the address, with what tells them apart', async () => {
    apiPost.mockResolvedValue(
      found([
        match(),
        match({
          id: 77,
          name: null,
          community: { id: 9, name: null, slug: 'hillside' },
          status: 'suspended',
          role: 'admin',
          level: 'tenant_super_admin',
          last_sign_in_at: null,
          two_step_on: false,
          has_passkey: true,
          signed_in_now: 0,
        }),
        match({ id: 78, community: null, status: 'deleted', role: 'god', level: 'platform_flag_only' }),
        match({ id: 79, role: 'something_new' }),
      ]),
    );
    render(<FindAccountPage />);
    search();

    const first = await card(41);
    expect(screen.getByText('Accounts found: 4')).toBeInTheDocument();
    expect(within(first).getByRole('heading', { name: 'Sample Person' })).toBeInTheDocument();
    expect(within(first).getByText('Riverside Timebank')).toBeInTheDocument();
    expect(within(first).getByText('Member')).toBeInTheDocument();
    expect(within(first).getByText('Two-step on')).toBeInTheDocument();
    expect(within(first).getByTestId('open-sign-ins-41')).toHaveTextContent('3');
    expect(within(first).queryByText('Has a passkey')).not.toBeInTheDocument();

    const second = await card(77);
    expect(within(second).getByRole('heading', { name: 'No name recorded' })).toBeInTheDocument();
    expect(within(second).getByText('Community #9')).toBeInTheDocument();
    expect(within(second).getByText('Community admin')).toBeInTheDocument();
    expect(within(second).getByText('Tenant super admin')).toBeInTheDocument();
    expect(within(second).getByText('Suspended')).toBeInTheDocument();
    expect(within(second).getByText('Two-step off')).toBeInTheDocument();
    expect(within(second).getByText('Has a passkey')).toBeInTheDocument();
    expect(within(second).getByText('Never')).toBeInTheDocument();
    expect(within(second).getByTestId('open-sign-ins-77')).toHaveTextContent('0');

    const third = await card(78);
    expect(within(third).getByText('Deleted')).toBeInTheDocument();
    expect(within(third).getByText('Platform-wide access, not on the platform team')).toBeInTheDocument();
    // On screen the top tier is the platform team; the old role name is never shown.
    expect(within(third).queryByText(/god/i)).not.toBeInTheDocument();
    // Its level says what it is, so no role is shown beside it.
    expect(within(third).queryByText('Role:')).not.toBeInTheDocument();
    // A role this page has no word for, on an account with no level, is "Another role".
    expect(within(await card(79)).getByText('Another role')).toBeInTheDocument();
    // An account in no community has no sign-ins to end.
    expect(within(third).queryByRole('button', { name: 'Sign out everywhere' })).not.toBeInTheDocument();
    expect(within(third).getByText('This account is in no community, so it has no sign-ins to end.')).toBeInTheDocument();

    // The page never shows the address back from the server: the reply does not carry it.
    expect(within(first).queryByText(ADDRESS)).not.toBeInTheDocument();
  });

  it('says so in words when no account uses the address', async () => {
    apiPost.mockResolvedValue(found([]));
    render(<FindAccountPage />);
    search();

    expect(await screen.findByText('No account uses that address')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out everywhere' })).not.toBeInTheDocument();
  });

  it('says when the list was cut short', async () => {
    apiPost.mockResolvedValue(found([match()], true));
    render(<FindAccountPage />);
    search();

    expect(await screen.findByText('Only the first 1 accounts are shown.')).toBeInTheDocument();
  });

  // "Could not search" must never be drawn as "nobody has that address".
  it('shows the error card when the search fails, never "no account", and can try again', async () => {
    apiPost.mockResolvedValueOnce({ success: false, error: 'Server error' });
    render(<FindAccountPage />);
    search();

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('No account uses that address')).not.toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId('load-error')).getByRole('button'));
    await card(41);
    expect(apiPost).toHaveBeenCalledTimes(2);
    expect(apiPost).toHaveBeenLastCalledWith(FIND, { email: ADDRESS });
  });

  it('shows the error card when the reply is not a list', async () => {
    apiPost.mockResolvedValueOnce({ success: true, data: { matches: 'nope' } });
    render(<FindAccountPage />);
    search();

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('No account uses that address')).not.toBeInTheDocument();
  });

  it('says to wait when there have been too many searches', async () => {
    apiPost.mockResolvedValueOnce({ success: false, code: 'RATE_LIMIT_EXCEEDED' });
    render(<FindAccountPage />);
    search();

    expect(await screen.findByText('That is a lot of searches. Wait a minute, then try again.')).toBeInTheDocument();
    expect(screen.queryByText('No account uses that address')).not.toBeInTheDocument();
  });

  it('asks before signing an account out, says what it does, and needs a reason', async () => {
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();

    expect(within(dialog).getByRole('heading', { name: 'Sign Sample Person out everywhere?' })).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'They will be signed out on every phone and computer and must sign in again. Their password is not changed. Notifications to their phone stop until they sign in again.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText(/This is your own account/)).not.toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Sign out everywhere' });
    expect(confirm).toBeDisabled();
    typeReason(dialog, 'abcd');
    expect(confirm).toBeDisabled();
    typeReason(dialog, '  ab  ');
    expect(confirm).toBeDisabled();
    typeReason(dialog, 'Phone stolen');
    expect(confirm).toBeEnabled();

    // Nothing was sent by opening the dialog or typing.
    expect(apiPost).toHaveBeenCalledTimes(1);
  });

  it('says "This is your own account" when it is', async () => {
    auth.user = { id: 41 };
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();

    expect(within(dialog).getByText(/This is your own account/)).toBeInTheDocument();
  });

  it('sends the reason, then shows on the card that it was done', async () => {
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();
    typeReason(dialog, '  Phone reported stolen ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    await waitFor(() =>
      expect(apiPost).toHaveBeenLastCalledWith('/v2/platform-team/accounts/41/sign-out', { reason: 'Phone reported stolen' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());

    const done = await card(41);
    expect(within(done).getByText('Signed out everywhere just now.')).toBeInTheDocument();
    expect(within(done).getByTestId('open-sign-ins-41')).toHaveTextContent('0');
    expect(within(done).queryByRole('button', { name: 'Sign out everywhere' })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('leaves the account alone when the dialog is cancelled', async () => {
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();
    typeReason(dialog, 'Phone reported stolen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave them signed in' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(apiPost).toHaveBeenCalledTimes(1);
    expect(within(await card(41)).getByRole('button', { name: 'Sign out everywhere' })).toBeInTheDocument();
  });

  // The API client asks for the code and replays the request itself. When the
  // person cancels that, it hands the refusal back: nothing was done.
  it('keeps the dialog and the reason when the second sign-in step was not completed', async () => {
    apiPost.mockImplementation((url: string) =>
      Promise.resolve(url === FIND ? found([match()]) : { success: false, code: 'AUTH_STEP_UP_REQUIRED' }),
    );
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();
    typeReason(dialog, 'Phone reported stolen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    expect(
      await within(dialog).findByText('You did not confirm it was you, so nobody was signed out.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Why are you doing this/)).toHaveValue('Phone reported stolen');
    expect(within(await card(41)).queryByText('Signed out everywhere just now.')).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();

    // Trying again sends the same request again.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));
    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(3));
  });

  it('says nobody was signed out when the server could not do it', async () => {
    apiPost.mockImplementation((url: string) =>
      url === FIND ? Promise.resolve(found([match()])) : Promise.reject(new Error('network')),
    );
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();
    typeReason(dialog, 'Phone reported stolen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    expect(await within(dialog).findByText("That didn't work. Nobody was signed out.")).toBeInTheDocument();
    expect(within(await card(41)).queryByText('Signed out everywhere just now.')).not.toBeInTheDocument();
  });

  it('says to search again when the account can no longer be signed out', async () => {
    apiPost.mockImplementation((url: string) =>
      Promise.resolve(url === FIND ? found([match()]) : { success: false, code: 'NOT_FOUND' }),
    );
    render(<FindAccountPage />);
    search();
    const dialog = await openDialog();
    typeReason(dialog, 'Phone reported stolen');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign out everywhere' }));

    expect(
      await within(dialog).findByText('This account can no longer be signed out from here. Search again.'),
    ).toBeInTheDocument();
  });

  it('has one action on an account and no other: nothing changes a password, a role or access', async () => {
    render(<FindAccountPage />);
    search();
    const found41 = await card(41);

    expect(within(found41).getAllByRole('button').map((b) => b.textContent)).toEqual(['Sign out everywhere']);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });
});
