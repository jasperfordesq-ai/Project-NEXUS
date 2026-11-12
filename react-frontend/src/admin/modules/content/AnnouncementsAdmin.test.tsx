// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@/test/test-utils';
import { AnnouncementsAdmin, announcementStatus, fromLocalField, toLocalField } from './AnnouncementsAdmin';

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({ adminAnnouncements: api }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/contexts', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
  useTenant: () => ({ tenant: { id: 2, name: 'Riverside', slug: 'riverside' }, tenantPath: (p: string) => `/riverside${p}` }),
  useAuth: () => ({ user: { id: 1 }, isAuthenticated: true }),
  useAuthOptional: () => ({ user: { id: 1 }, isAuthenticated: true }),
}));
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ tenant: { id: 2, name: 'Riverside', slug: 'riverside' }, tenantPath: (p: string) => `/riverside${p}` }),
}));

const SAVE = 'Save Changes';

const notice = {
  id: 7,
  message: 'Repair café this Saturday',
  style: 'celebration',
  link_url: '/events/12',
  link_label: 'See the event',
  starts_at: null,
  ends_at: null,
  is_dismissible: true,
  is_active: true,
  created_by: 1,
  created_at: '2026-11-12T09:00:00+00:00',
  updated_at: '2026-11-12T09:00:00+00:00',
};

describe('announcement helpers', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');

  it('says plainly where a notice stands', () => {
    expect(announcementStatus({ is_active: true, starts_at: null, ends_at: null }, now)).toBe('showing');
    expect(announcementStatus({ is_active: false, starts_at: null, ends_at: null }, now)).toBe('off');
    expect(announcementStatus({ is_active: true, starts_at: '2026-11-13T10:00:00Z', ends_at: null }, now)).toBe('scheduled');
    expect(announcementStatus({ is_active: true, starts_at: null, ends_at: '2026-11-12T09:59:00Z' }, now)).toBe('ended');
  });

  // The server reads a time with no zone as UTC. An admin types their own
  // clock time, so the zone is always stated when it is sent.
  it('sends the time the admin typed with its zone, and shows a saved time back in their own clock', () => {
    const sent = fromLocalField('2026-12-01T09:30');
    expect(sent).toMatch(/^2026-\d\d-\d\dT\d\d:\d\d:00\.000Z$/);
    expect(new Date(sent as string).getTime()).toBe(new Date('2026-12-01T09:30').getTime());
    expect(toLocalField(sent)).toBe('2026-12-01T09:30');
    expect(fromLocalField('')).toBeNull();
    expect(toLocalField(null)).toBe('');
    expect(toLocalField('not a date')).toBe('');
  });
});

describe('AnnouncementsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ success: true, data: { items: [notice] } });
    api.create.mockResolvedValue({ success: true, data: { announcement: notice } });
    api.update.mockResolvedValue({ success: true, data: { announcement: notice } });
    api.delete.mockResolvedValue({ success: true, data: { ok: true } });
  });

  // The community's settings are kept by the server for 10 minutes and by
  // browsers for up to 15 more, and the server's copy is not refreshed when a
  // scheduled notice starts. "Up to ten minutes" promised too much (audit of
  // warmth phase 5, 12 Nov 2026).
  it('tells the admin honestly how long a notice can take to appear', async () => {
    render(<AnnouncementsAdmin />);
    await screen.findByTestId('announcement-row-7');
    const note = screen.getByText(/can take up to about 15 minutes/);
    expect(note.textContent).toContain('up to about 25 minutes after its start time');
    expect(note.textContent).not.toContain('ten minutes');
  });

  it('lists the community notices with where each one stands', async () => {
    render(<AnnouncementsAdmin />);
    const row = await screen.findByTestId('announcement-row-7');
    expect(within(row).getByText('Repair café this Saturday')).toBeInTheDocument();
    expect(within(row).getByText('Showing now')).toBeInTheDocument();
  });

  it('invites a first notice when there are none', async () => {
    api.list.mockResolvedValue({ success: true, data: { items: [] } });
    render(<AnnouncementsAdmin />);
    expect(await screen.findByText('No notices yet')).toBeInTheDocument();
  });

  it('says so when the notices cannot be loaded, instead of looking empty', async () => {
    api.list.mockResolvedValue({ success: false, error: 'nope' });
    render(<AnnouncementsAdmin />);
    expect(await screen.findByText('The notices could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('No notices yet')).toBeNull();
  });

  it('shows the real banner as the admin types, and saves what was typed', async () => {
    api.list.mockResolvedValue({ success: true, data: { items: [] } });
    render(<AnnouncementsAdmin />);
    await screen.findByText('No notices yet');

    fireEvent.click(screen.getAllByRole('button', { name: 'New notice' })[0]!);
    const preview = await screen.findByTestId('announcement-preview');
    expect(within(preview).getByText('Your notice will appear here as you type.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Notice/), { target: { value: 'Seed swap on Sunday' } });
    await waitFor(() => expect(within(preview).getByText('Seed swap on Sunday')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create.mock.calls[0]![0]).toMatchObject({
      message: 'Seed swap on Sunday',
      style: 'info',
      link_url: null,
      link_label: null,
      starts_at: null,
      ends_at: null,
      is_dismissible: true,
      is_active: true,
    });
  });

  it('will not save an empty notice or a link that is not safe', async () => {
    api.list.mockResolvedValue({ success: true, data: { items: [] } });
    render(<AnnouncementsAdmin />);
    await screen.findByText('No notices yet');
    fireEvent.click(screen.getAllByRole('button', { name: 'New notice' })[0]!);
    await screen.findByTestId('announcement-preview');

    const saveButton = screen.getByRole('button', { name: SAVE });
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^Notice/), { target: { value: 'Hello' } });
    await waitFor(() => expect(saveButton).not.toBeDisabled());

    fireEvent.change(screen.getByLabelText(/^Link \(optional\)/), { target: { value: 'javascript:alert(1)' } });
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(api.create).not.toHaveBeenCalled();
  });

  // The banner shows a link only with its words: a link without them used to
  // save and then vanish from the page (audit of warmth phase 5, 12 Nov 2026).
  it('asks for the words to show when a link is given', async () => {
    api.list.mockResolvedValue({ success: true, data: { items: [] } });
    render(<AnnouncementsAdmin />);
    await screen.findByText('No notices yet');
    fireEvent.click(screen.getAllByRole('button', { name: 'New notice' })[0]!);
    await screen.findByTestId('announcement-preview');
    const saveButton = screen.getByRole('button', { name: SAVE });

    fireEvent.change(screen.getByLabelText(/^Notice/), { target: { value: 'Repair café on Saturday' } });
    fireEvent.change(screen.getByLabelText(/^Link \(optional\)/), { target: { value: '/events' } });
    await waitFor(() => expect(saveButton).toBeDisabled());
    expect(screen.getByText('Add the words to show for the link, or leave the link empty.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Words for the link/), { target: { value: 'See the events' } });
    await waitFor(() => expect(saveButton).not.toBeDisabled());
  });

  it("shows the server's own words when it refuses a notice", async () => {
    api.list.mockResolvedValue({ success: true, data: { items: [] } });
    api.create.mockResolvedValue({ success: false, error: 'The end must be after the start.' });
    render(<AnnouncementsAdmin />);
    await screen.findByText('No notices yet');
    fireEvent.click(screen.getAllByRole('button', { name: 'New notice' })[0]!);
    await screen.findByTestId('announcement-preview');
    fireEvent.change(screen.getByLabelText(/^Notice/), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: SAVE }));
    expect(await screen.findByText('The end must be after the start.')).toBeInTheDocument();
  });
});
