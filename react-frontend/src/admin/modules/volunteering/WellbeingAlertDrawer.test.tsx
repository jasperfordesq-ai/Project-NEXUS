// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WellbeingAlertDrawer — one alert opened by staff: the volunteer, why the
 * alert was raised, their shared check-ins, who was told (and whether it
 * worked), and the permanent notes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

const mockApi = vi.hoisted(() => ({
  getWellbeingAlert: vi.fn(),
  addWellbeingAlertNote: vi.fn(),
  updateWellbeingAlert: vi.fn(),
}));

vi.mock('../../api/adminApi', () => ({
  adminVolunteering: mockApi,
}));

import { WellbeingAlertDrawer } from './WellbeingAlertDrawer';

const DETAIL = {
  alert: {
    id: 71,
    user_id: 12,
    user_name: 'Pat Murphy',
    avatar_url: null,
    risk_level: 'high',
    risk_score: 65,
    reason: 'low_mood',
    status: 'active',
    coordinator_notified: true,
    legacy_notes: null,
    resolved_at: null,
    created_at: '2026-10-20T12:05:22Z',
    updated_at: '2026-10-20T12:14:17Z',
  },
  indicators: {
    mood: { latest_mood: 1, latest_at: '2026-10-20T12:05:22Z', low_checkins_14_days: 2 },
    engagement_gap: { days_since_last_activity: 40 },
  },
  checkins: [
    { id: 15, mood: 2, note: null, created_at: '2026-10-20T12:14:17Z', team_notified_at: null },
    { id: 14, mood: 1, note: 'My other job is really getting to me', created_at: '2026-10-20T12:05:22Z', team_notified_at: '2026-10-20T12:05:22Z' },
  ],
  notifications: [
    { id: 1, checkin_id: 14, recipient: { id: 222, name: 'Nikita Serkevich', other_community: false }, email_masked: null, organisation: null, tier: 'staff', channel: 'bell', status: 'sent', error_code: null, created_at: '2026-10-20T12:05:22Z', updated_at: null },
    { id: 2, checkin_id: 14, recipient: { id: 222, name: 'Nikita Serkevich', other_community: false }, email_masked: null, organisation: null, tier: 'staff', channel: 'email', status: 'sent', error_code: null, created_at: '2026-10-20T12:05:22Z', updated_at: '2026-10-20T12:05:23Z' },
    { id: 3, checkin_id: 14, recipient: null, email_masked: 's***@community.example', organisation: null, tier: 'community_contact_email', channel: 'email', status: 'failed', error_code: 'send_false', created_at: '2026-10-20T12:05:22Z', updated_at: '2026-10-20T12:05:24Z' },
  ],
  notes: [
    { id: 5, author: { id: 222, name: 'Nikita Serkevich' }, body: 'Rang Pat, left a message.', created_at: '2026-10-20T13:00:00Z' },
  ],
};

describe('WellbeingAlertDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getWellbeingAlert.mockResolvedValue({ success: true, data: DETAIL });
    mockApi.updateWellbeingAlert.mockResolvedValue({ success: true, data: { id: 71, status: 'acknowledged' } });
  });

  it('shows the volunteer, the shared check-ins with their notes, who was told and the notes', async () => {
    render(<WellbeingAlertDrawer alertId={71} isOpen onClose={() => {}} onChanged={() => {}} />);

    expect(await screen.findByText('Pat Murphy')).toBeInTheDocument();
    expect(screen.getByText('My other job is really getting to me')).toBeInTheDocument();
    // Who was told: a person, and a masked address that failed.
    expect(screen.getAllByText('Nikita Serkevich').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('s***@community.example')).toBeInTheDocument();
    expect(screen.getByText(/not delivered/i)).toBeInTheDocument();
    // Notes, with author.
    expect(screen.getByText('Rang Pat, left a message.')).toBeInTheDocument();
    // Links to the volunteer: profile and a message.
    const profile = screen.getByRole('link', { name: /view profile/i });
    expect(profile).toHaveAttribute('href', '/test/profile/12');
    expect(screen.getByRole('link', { name: /message pat murphy/i })).toHaveAttribute('href', '/test/messages/12');
  });

  it('adds a note and shows it without reloading the whole drawer', async () => {
    mockApi.addWellbeingAlertNote.mockResolvedValue({
      success: true,
      data: { note: { id: 6, author: { id: 1, name: 'Ann Admin' }, body: 'Spoke to Pat today.', created_at: '2026-10-20T14:00:00Z' } },
    });
    render(<WellbeingAlertDrawer alertId={71} isOpen onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Pat Murphy');

    fireEvent.change(screen.getByLabelText(/add a note/i), { target: { value: 'Spoke to Pat today.' } });
    fireEvent.click(screen.getByRole('button', { name: /save note/i }));

    await waitFor(() => expect(mockApi.addWellbeingAlertNote).toHaveBeenCalledWith(71, 'Spoke to Pat today.'));
    expect(await screen.findByText('Spoke to Pat today.')).toBeInTheDocument();
    expect(screen.getByText('Ann Admin')).toBeInTheDocument();
    expect(mockApi.getWellbeingAlert).toHaveBeenCalledTimes(1);
  });

  it('acknowledges from the footer and tells the page something changed', async () => {
    const onChanged = vi.fn();
    render(<WellbeingAlertDrawer alertId={71} isOpen onClose={() => {}} onChanged={onChanged} />);
    await screen.findByText('Pat Murphy');

    fireEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

    await waitFor(() => expect(mockApi.updateWellbeingAlert).toHaveBeenCalledWith(71, 'acknowledged'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mockToast.success).toHaveBeenCalled();
  });

  it('says when nobody could be told', async () => {
    mockApi.getWellbeingAlert.mockResolvedValue({ success: true, data: { ...DETAIL, notifications: [] } });
    render(<WellbeingAlertDrawer alertId={71} isOpen onClose={() => {}} onChanged={() => {}} />);
    await screen.findByText('Pat Murphy');

    expect(screen.getByText(/nobody could be told/i)).toBeInTheDocument();
  });
});
