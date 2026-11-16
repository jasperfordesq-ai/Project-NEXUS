// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';

const { apiGet, apiPost, apiPut, toast } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/lib/api', () => ({ api: { get: apiGet, post: apiPost, put: apiPut } }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useToast: () => toast,
  useTenant: () => ({ tenant: { id: 2, name: 'Riverside', slug: 'riverside' }, tenantPath: (p: string) => `/riverside${p}` }),
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
  useAuthOptional: () => ({ user: { id: 1 }, isAuthenticated: true }),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 2, name: 'Riverside', slug: 'riverside' }, tenantPath: (p: string) => `/riverside${p}` }),
}));

import { PlatformNoticesPage, type TeamNotice } from './PlatformNoticesPage';

const notice = (over: Partial<TeamNotice> = {}): TeamNotice => ({
  id: 7,
  message: 'Planned work on Tuesday evening.',
  kind: 'planned_work',
  link_url: null,
  link_label: null,
  starts_at: null,
  ends_at: null,
  is_dismissible: true,
  state: 'live',
  written_by: 'Sample Owner',
  created_at: '2026-11-16T09:00:00+00:00',
  updated_at: '2026-11-16T09:00:00+00:00',
  ended_at: null,
  closed_count: 4,
  ...over,
});

const list = (notices: TeamNotice[]) => ({ success: true, data: { notices } });

const openForm = async () => {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Write a notice' }))[0]!);
  return screen.findByRole('dialog');
};

describe('PlatformNoticesPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    apiGet.mockResolvedValue(list([notice()]));
    apiPost.mockResolvedValue({ success: true, data: { notice: notice() } });
    apiPut.mockResolvedValue({ success: true, data: { notice: notice() } });
  });

  it('asks the platform team request and lists each notice with where it stands', async () => {
    apiGet.mockResolvedValue(
      list([
        notice(),
        notice({ id: 8, state: 'scheduled', message: 'Next month.' }),
        notice({ id: 9, state: 'expired', message: 'Last week.' }),
        notice({ id: 10, state: 'ended', message: 'Stopped.' }),
      ]),
    );
    render(<PlatformNoticesPage />);

    const live = await screen.findByTestId('team-notice-7');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/notices');
    expect(within(live).getByText('Planned work on Tuesday evening.')).toBeInTheDocument();
    expect(within(live).getByText('Showing now')).toBeInTheDocument();
    expect(within(live).getByText('Sample Owner')).toBeInTheDocument();
    expect(within(live).getByText('4')).toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-8')).getByText('Not started yet')).toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-9')).getByText('Finished')).toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-10')).getByText('Ended early')).toBeInTheDocument();
  });

  it('offers "End now" only for a notice that is showing or waiting to start', async () => {
    apiGet.mockResolvedValue(
      list([notice(), notice({ id: 8, state: 'scheduled' }), notice({ id: 9, state: 'expired' }), notice({ id: 10, state: 'ended' })]),
    );
    render(<PlatformNoticesPage />);

    expect(within(await screen.findByTestId('team-notice-7')).getByRole('button', { name: 'End now' })).toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-8')).getByRole('button', { name: 'End now' })).toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-9')).queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
    expect(within(screen.getByTestId('team-notice-10')).queryByRole('button', { name: 'End now' })).not.toBeInTheDocument();
    // An ended notice stays ended, so there is nothing to change either.
    expect(within(screen.getByTestId('team-notice-10')).queryByRole('button', { name: 'Change' })).not.toBeInTheDocument();
  });

  it('invites a first notice when there are none', async () => {
    apiGet.mockResolvedValue(list([]));
    render(<PlatformNoticesPage />);

    expect(await screen.findByText('No notices yet')).toBeInTheDocument();
  });

  it('shows the error card when the notices cannot be loaded, instead of looking empty', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<PlatformNoticesPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('No notices yet')).not.toBeInTheDocument();
  });

  it('shows the real band as the notice is typed, and saves what was typed', async () => {
    render(<PlatformNoticesPage />);
    const dialog = await openForm();

    fireEvent.change(within(dialog).getByLabelText(/^Notice/), { target: { value: 'A new release went out today.' } });
    fireEvent.change(within(dialog).getByLabelText(/^Link \(optional\)/), { target: { value: 'https://example.test/changelog' } });
    fireEvent.change(within(dialog).getByLabelText(/^Words for the link/), { target: { value: 'What changed' } });

    const preview = within(dialog).getByTestId('notice-preview');
    expect(within(preview).getByText('A new release went out today.')).toBeInTheDocument();
    expect(within(preview).getByRole('link', { name: /What changed/ })).toHaveAttribute('href', 'https://example.test/changelog');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/notices', {
      message: 'A new release went out today.',
      kind: 'info',
      link_url: 'https://example.test/changelog',
      link_label: 'What changed',
      starts_at: null,
      ends_at: null,
      is_dismissible: true,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('will not save an empty notice, a link that is not https, or a link with no words', async () => {
    render(<PlatformNoticesPage />);
    const dialog = await openForm();
    const save = within(dialog).getByRole('button', { name: 'Save' });

    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Notice/), { target: { value: 'Hello' } });
    expect(save).not.toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Link \(optional\)/), { target: { value: '/admin' } });
    expect(save).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Link \(optional\)/), { target: { value: 'https://example.test/' } });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText('Add the words to show for the link, or leave the link empty.')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/^Words for the link/), { target: { value: 'Read more' } });
    expect(save).not.toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('opens a notice to change it and sends the change to that notice', async () => {
    render(<PlatformNoticesPage />);
    fireEvent.click(within(await screen.findByTestId('team-notice-7')).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText(/^Notice/)).toHaveValue('Planned work on Tuesday evening.');
    fireEvent.change(within(dialog).getByLabelText(/^Notice/), { target: { value: 'Planned work moved to Wednesday.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut.mock.calls[0]![0]).toBe('/v2/platform-team/notices/7');
    expect(apiPut.mock.calls[0]![1]).toMatchObject({ message: 'Planned work moved to Wednesday.', kind: 'planned_work' });
  });

  it('keeps the form open and says so when the server refuses', async () => {
    apiPost.mockResolvedValue({ success: false, error: 'Refused', errors: [{ field: 'link_url', message: 'server words' }] });
    render(<PlatformNoticesPage />);
    const dialog = await openForm();

    fireEvent.change(within(dialog).getByLabelText(/^Notice/), { target: { value: 'Hello' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('A full address that starts with https://');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('asks before ending a notice, then ends it', async () => {
    render(<PlatformNoticesPage />);
    fireEvent.click(within(await screen.findByTestId('team-notice-7')).getByRole('button', { name: 'End now' }));

    expect(apiPost).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('End this notice now?')).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'End it' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/notices/7/end'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
