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

import { AgreementsPage, type Agreement } from './AgreementsPage';

const agreement = (over: Partial<Agreement> = {}): Agreement => ({
  id: 7,
  community: { id: 2, name: 'Riverside' },
  title: 'Hosting agreement',
  with_whom: 'Riverside Timebank',
  starts_on: '2026-01-01',
  renews_on: '2027-01-01',
  ends_on: null,
  contact_name: 'Morwenna Testcontact',
  contact_email: 'morwenna.contact@example.test',
  notes: null,
  is_ended: false,
  days_to_renewal: 120,
  renews_soon: false,
  updated_at: '2026-11-16T09:00:00+00:00',
  ...over,
});

const list = (agreements: Agreement[], ended: Agreement[] = []) => ({
  success: true,
  data: {
    agreements,
    ended,
    communities: [{ id: 2, name: 'Riverside' }, { id: 3, name: 'Hilltop' }],
    renewal_warning_days: 60,
  },
});

const openForm = async () => {
  fireEvent.click((await screen.findAllByRole('button', { name: 'Add an agreement' }))[0]!);
  return screen.findByRole('dialog');
};

describe('AgreementsPage', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiPut.mockReset();
    toast.success.mockReset();
    toast.error.mockReset();
    apiGet.mockResolvedValue(list([agreement()]));
    apiPost.mockResolvedValue({ success: true, data: { agreement: agreement() } });
    apiPut.mockResolvedValue({ success: true, data: { agreement: agreement() } });
  });

  it('asks the platform team request and shows each agreement with its contact', async () => {
    render(<AgreementsPage />);

    const row = await screen.findByTestId('agreement-7');
    expect(apiGet).toHaveBeenCalledWith('/v2/platform-team/agreements');
    expect(within(row).getByText('Hosting agreement')).toBeInTheDocument();
    expect(within(row).getByText('Riverside Timebank')).toBeInTheDocument();
    expect(within(row).getByText('Morwenna Testcontact')).toBeInTheDocument();
    expect(within(row).getByText('morwenna.contact@example.test')).toBeInTheDocument();
    expect(within(row).getByText('120')).toBeInTheDocument();
  });

  it('shows an empty field as "Not entered", never a made-up value', async () => {
    apiGet.mockResolvedValue(list([agreement({
      community: null, starts_on: null, renews_on: null, ends_on: null, contact_name: null, contact_email: null,
      notes: null, days_to_renewal: null,
    })]));
    render(<AgreementsPage />);

    const row = await screen.findByTestId('agreement-7');
    // Start, renewal, end, contact name, contact email and notes.
    expect(within(row).getAllByText('Not entered')).toHaveLength(6);
    expect(within(row).getByText('Not linked to a community')).toBeInTheDocument();
    expect(within(row).queryByText('Days until renewal')).not.toBeInTheDocument();
  });

  it('marks one that renews soon, and one whose renewal date has passed', async () => {
    apiGet.mockResolvedValue(list([
      agreement({ id: 1, renews_soon: true, days_to_renewal: -5 }),
      agreement({ id: 2, renews_soon: true, days_to_renewal: 30 }),
      agreement({ id: 3, renews_soon: true, days_to_renewal: 0 }),
      agreement({ id: 4 }),
    ]));
    render(<AgreementsPage />);

    const passed = await screen.findByTestId('agreement-1');
    expect(within(passed).getByText('Renewal date passed')).toBeInTheDocument();
    expect(within(passed).getByText('Days since the renewal date')).toBeInTheDocument();
    expect(within(passed).getByText('5')).toBeInTheDocument();
    expect(within(screen.getByTestId('agreement-2')).getByText('Renews soon')).toBeInTheDocument();
    expect(within(screen.getByTestId('agreement-3')).getByText('Renews today')).toBeInTheDocument();
    expect(within(screen.getByTestId('agreement-4')).queryByText('Renews soon')).not.toBeInTheDocument();
  });

  it('says when a community no longer exists', async () => {
    apiGet.mockResolvedValue(list([agreement({ community: { id: 99, name: null } })]));
    render(<AgreementsPage />);

    expect(await screen.findByText('Community no longer exists (#99)')).toBeInTheDocument();
  });

  it('lists ended agreements separately, without an "End" button, and says there is no delete', async () => {
    apiGet.mockResolvedValue(list([agreement()], [agreement({ id: 9, title: 'Old agreement', is_ended: true })]));
    render(<AgreementsPage />);

    const ended = await screen.findByTestId('agreement-9');
    expect(within(ended).getByText('Ended')).toBeInTheDocument();
    expect(within(ended).queryByRole('button', { name: 'End' })).not.toBeInTheDocument();
    expect(within(ended).getByRole('button', { name: 'Change' })).toBeInTheDocument();
    expect(screen.getByText(/There is no delete/)).toBeInTheDocument();
  });

  it('invites a first agreement when there are none', async () => {
    apiGet.mockResolvedValue(list([]));
    render(<AgreementsPage />);

    expect(await screen.findByText('No agreements entered yet')).toBeInTheDocument();
  });

  it('shows the error card when the list cannot be loaded, instead of looking empty', async () => {
    apiGet.mockResolvedValue({ success: false, error: 'Forbidden' });
    render(<AgreementsPage />);

    expect(await screen.findByTestId('load-error')).toBeInTheDocument();
    expect(screen.queryByText('No agreements entered yet')).not.toBeInTheDocument();
  });

  it('saves only what was typed: empty fields go as empty, nothing is filled in', async () => {
    render(<AgreementsPage />);
    const dialog = await openForm();

    fireEvent.change(within(dialog).getByLabelText(/^Name of the agreement/), { target: { value: 'Support agreement' } });
    fireEvent.change(within(dialog).getByLabelText(/^Who it is with/), { target: { value: 'Hilltop Council' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/agreements', {
      title: 'Support agreement',
      with_whom: 'Hilltop Council',
      community_id: null,
      starts_on: null,
      renews_on: null,
      ends_on: null,
      contact_name: null,
      contact_email: null,
      notes: null,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('will not save without the two names, with an end before the start, or with a bad email', async () => {
    render(<AgreementsPage />);
    const dialog = await openForm();
    const save = within(dialog).getByRole('button', { name: 'Save' });

    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Name of the agreement/), { target: { value: 'Support' } });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/^Who it is with/), { target: { value: 'Hilltop' } });
    expect(save).not.toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Start date/), { target: { value: '2027-02-01' } });
    fireEvent.change(within(dialog).getByLabelText(/^End date/), { target: { value: '2027-01-01' } });
    expect(save).toBeDisabled();
    expect(within(dialog).getByText('The end date cannot be before the start date.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/^End date/), { target: { value: '2027-02-01' } });
    expect(save).not.toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText(/^Contact's email/), { target: { value: 'not-an-address' } });
    expect(save).toBeDisabled();
    expect(apiPost).not.toHaveBeenCalled();
  });

  it('opens an agreement to change it and sends the change to that agreement', async () => {
    render(<AgreementsPage />);
    fireEvent.click(within(await screen.findByTestId('agreement-7')).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getByLabelText(/^Name of the agreement/)).toHaveValue('Hosting agreement');
    expect(within(dialog).getByLabelText(/^Renewal date/)).toHaveValue('2027-01-01');
    fireEvent.change(within(dialog).getByLabelText(/^Renewal date/), { target: { value: '2028-01-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    expect(apiPut.mock.calls[0]![0]).toBe('/v2/platform-team/agreements/7');
    expect(apiPut.mock.calls[0]![1]).toMatchObject({ renews_on: '2028-01-01', community_id: 2, contact_email: 'morwenna.contact@example.test' });
  });

  it('keeps the form open and says so when the server refuses', async () => {
    apiPost.mockResolvedValue({ success: false, error: 'Refused', errors: [{ field: 'community_id', message: 'server words' }] });
    render(<AgreementsPage />);
    const dialog = await openForm();

    fireEvent.change(within(dialog).getByLabelText(/^Name of the agreement/), { target: { value: 'Support' } });
    fireEvent.change(within(dialog).getByLabelText(/^Who it is with/), { target: { value: 'Hilltop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That community does not exist.');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('reads a refusal by the server\'s code first: a renewal date that is not a date is not "before the start"', async () => {
    apiPost.mockResolvedValue({
      success: false,
      error: 'Refused',
      errors: [{ code: 'VALIDATION_INVALID_FORMAT', field: 'renews_on', message: 'server words' }],
    });
    render(<AgreementsPage />);
    const dialog = await openForm();

    fireEvent.change(within(dialog).getByLabelText(/^Name of the agreement/), { target: { value: 'Support' } });
    fireEvent.change(within(dialog).getByLabelText(/^Who it is with/), { target: { value: 'Hilltop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Use a real date, or leave it empty.');
    expect(alert).not.toHaveTextContent('before the start date');
  });

  it('writes day counts in the reader\'s number style', async () => {
    apiGet.mockResolvedValue(list([
      agreement({ id: 1, days_to_renewal: 1234 }),
      agreement({ id: 2, days_to_renewal: -2500, renews_soon: true }),
    ]));
    render(<AgreementsPage />);

    expect(within(await screen.findByTestId('agreement-1')).getByText('1,234')).toBeInTheDocument();
    expect(within(screen.getByTestId('agreement-2')).getByText('2,500')).toBeInTheDocument();
  });

  it('opens an agreement whose community no longer exists without losing the link', async () => {
    apiGet.mockResolvedValue(list([agreement({ community: { id: 99, name: null } })]));
    render(<AgreementsPage />);
    fireEvent.click(within(await screen.findByTestId('agreement-7')).getByRole('button', { name: 'Change' }));
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).getAllByText('Community no longer exists').length).toBeGreaterThan(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(apiPut).toHaveBeenCalledTimes(1));
    // Not sent, so the server keeps the link it has; sending the old number would be refused.
    expect(apiPut.mock.calls[0]![1]).not.toHaveProperty('community_id');
  });

  it('asks before ending an agreement, then ends it', async () => {
    render(<AgreementsPage />);
    fireEvent.click(within(await screen.findByTestId('agreement-7')).getByRole('button', { name: 'End' }));

    expect(apiPost).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog');
    expect(within(confirm).getByText('End this agreement?')).toBeInTheDocument();
    fireEvent.click(within(confirm).getByRole('button', { name: 'End it' }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/v2/platform-team/agreements/7/end'));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
