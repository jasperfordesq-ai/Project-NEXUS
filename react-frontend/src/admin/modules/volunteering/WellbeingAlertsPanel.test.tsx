// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WellbeingAlertsPanel — the wellbeing alerts list shared by the admin
 * Volunteering overview and the broker Safeguarding › Volunteering page.
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

const mockApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  API_BASE: 'http://localhost/api',
}));

import { WellbeingAlertsPanel, extractWellbeingAlerts } from './WellbeingAlertsPanel';
import { getFormattingLocale } from '@/lib/helpers';

const STRUGGLING_ALERT = {
  id: 71,
  user_id: 12,
  user_name: 'Alex Volunteer',
  avatar_url: null,
  risk_level: 'high',
  risk_score: 80,
  indicators: [],
  coordinator_notified: true,
  coordinator_notes: null,
  status: 'active',
  created_at: '2026-10-06T09:00:00Z',
  updated_at: '2026-10-06T09:00:00Z',
  reason: 'low_mood',
  latest_checkin: {
    mood: 1,
    note: 'Not sleeping, <b>too much</b> on',
    created_at: '2026-10-06T08:55:00Z',
  },
};

const TOLD_ALERT = {
  ...STRUGGLING_ALERT,
  id: 73,
  user_name: 'Pat Murphy',
  told_count: 2,
  last_told_at: '2026-10-20T12:05:22Z',
};

const NOBODY_TOLD_ALERT = {
  ...STRUGGLING_ALERT,
  id: 74,
  user_name: 'Lone Volunteer',
  told_count: 0,
  last_told_at: null,
};

const LOW_ALERT = {
  ...STRUGGLING_ALERT,
  id: 72,
  user_name: 'Sam Helper',
  risk_level: 'moderate',
  latest_checkin: { mood: 2, note: null, created_at: '2026-10-05T10:00:00Z' },
};

const ACTIVITY_ALERT = {
  ...STRUGGLING_ALERT,
  id: 73,
  user_name: 'Jo Busy',
  risk_level: 'critical',
  reason: 'activity',
  latest_checkin: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.get.mockResolvedValue({ success: true, data: [] });
  mockApi.put.mockResolvedValue({ success: true });
});

describe('WellbeingAlertsPanel', () => {
  it('shows why each alert was raised, in words, with a translated risk level', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [STRUGGLING_ALERT, LOW_ALERT, ACTIVITY_ALERT] });
    render(<WellbeingAlertsPanel />);

    expect(await screen.findByText('Alex Volunteer')).toBeInTheDocument();
    expect(screen.getByText("Said they're struggling")).toBeInTheDocument();
    expect(screen.getByText("Said they're feeling low")).toBeInTheDocument();
    expect(screen.getByText('Activity pattern')).toBeInTheDocument();

    expect(screen.getByText('High risk')).toBeInTheDocument();
    expect(screen.getByText('Moderate risk')).toBeInTheDocument();
    expect(screen.getByText('Critical risk')).toBeInTheDocument();
    // Never the raw enum value.
    expect(screen.queryByText('high')).not.toBeInTheDocument();
    expect(screen.queryByText('low_mood')).not.toBeInTheDocument();
  });

  it("shows the volunteer's latest check-in and note as plain text", async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [STRUGGLING_ALERT] });
    const { container } = render(<WellbeingAlertsPanel />);

    expect(await screen.findByText(/Latest check-in: Struggling/)).toBeInTheDocument();
    expect(screen.getByText('Their note')).toBeInTheDocument();
    // The note is rendered as text, never as HTML.
    expect(screen.getByText('Not sleeping, <b>too much</b> on')).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });

  it('does not show a note block when the check-in has no note', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [LOW_ALERT] });
    render(<WellbeingAlertsPanel />);

    expect(await screen.findByText(/Latest check-in: Low/)).toBeInTheDocument();
    expect(screen.queryByText('Their note')).not.toBeInTheDocument();
  });

  it('acknowledges an alert and reloads the list', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [STRUGGLING_ALERT] });
    render(<WellbeingAlertsPanel />);

    fireEvent.click(await screen.findByRole('button', { name: /Acknowledge/i }));

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith('/v2/admin/volunteering/wellbeing/alerts/71', { status: 'acknowledged' });
    });
    await waitFor(() => expect(mockToast.success).toHaveBeenCalled());
    expect(mockApi.get).toHaveBeenCalledTimes(2);
  });

  it('shows an error with a retry when the list cannot be loaded', async () => {
    mockApi.get.mockResolvedValue({ success: false });
    render(<WellbeingAlertsPanel />);

    expect(await screen.findByText('Failed to load wellbeing alerts')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument();
  });

  // Deep audit O4 (21 Oct 2026): if the nightly activity check stops, nobody notices.
  it('says when the nightly activity check last finished', async () => {
    const recent = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    mockApi.get.mockResolvedValue({ success: true, data: [], meta: { last_scan_at: recent } });
    render(<WellbeingAlertsPanel />);
    const line = await screen.findByTestId('wellbeing-last-scan');
    expect(line).toHaveTextContent(/nightly activity check last finished/i);
    expect(line).not.toHaveAttribute('role', 'alert');
  });

  it('warns when the nightly activity check has not finished in more than two days', async () => {
    const old = new Date(Date.now() - 50 * 60 * 60 * 1000).toISOString();
    mockApi.get.mockResolvedValue({ success: true, data: [], meta: { last_scan_at: old } });
    render(<WellbeingAlertsPanel />);
    const warning = await screen.findByTestId('wellbeing-last-scan');
    expect(warning).toHaveTextContent(/more than two days ago/i);
    expect(warning.className).toContain('warning');
  });

  it('warns when the nightly activity check has never finished', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [], meta: { last_scan_at: null } });
    render(<WellbeingAlertsPanel />);
    expect(await screen.findByTestId('wellbeing-last-scan')).toHaveTextContent(/has not finished yet/i);
  });

  it('says nothing about the nightly check when an older server does not report it', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [STRUGGLING_ALERT] });
    render(<WellbeingAlertsPanel />);
    await screen.findByText('Alex Volunteer');
    expect(screen.queryByTestId('wellbeing-last-scan')).not.toBeInTheDocument();
  });

  // Deep audit C6: the legacy stamp is UTC and must not be read as local time.
  it.each([
    ['legacy UTC form', '2026-10-21 14:05:00'],
    ['ISO with offset', '2026-10-21T14:05:00+00:00'],
  ])('reads alert times as UTC (%s)', async (_label, stamp) => {
    mockApi.get.mockResolvedValue({ success: true, data: [{ ...TOLD_ALERT, last_told_at: stamp, latest_checkin: { mood: 1, note: null, created_at: stamp } }] });
    render(<WellbeingAlertsPanel />);
    await screen.findByText('Pat Murphy');
    const expected = new Date(Date.UTC(2026, 9, 21, 14, 5)).toLocaleString(getFormattingLocale(), { dateStyle: 'medium', timeStyle: 'short' });
    expect(screen.getByText(new RegExp(`Latest check-in: Struggling, ${expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeInTheDocument();
  });

  it('reloads when refreshKey changes', async () => {
    const { rerender } = render(<WellbeingAlertsPanel refreshKey={0} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    rerender(<WellbeingAlertsPanel refreshKey={1} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
  });
});

describe('extractWellbeingAlerts', () => {
  it('accepts every envelope shape the endpoint may use', () => {
    const a = [{ id: 1 }];
    expect(extractWellbeingAlerts(a)).toEqual(a);
    expect(extractWellbeingAlerts({ data: a })).toEqual(a);
    expect(extractWellbeingAlerts({ items: a })).toEqual(a);
    expect(extractWellbeingAlerts({ data: { items: a } })).toEqual(a);
    expect(extractWellbeingAlerts({ data: { data: a } })).toEqual(a);
    expect(extractWellbeingAlerts(null)).toEqual([]);
    expect(extractWellbeingAlerts('nope')).toEqual([]);
  });

  it('says how many people were told, or that nobody could be, and offers to open the alert', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: [TOLD_ALERT, NOBODY_TOLD_ALERT] });
    const onOpen = vi.fn();
    render(<WellbeingAlertsPanel onOpen={onOpen} />);
    expect(await screen.findByText('Pat Murphy')).toBeInTheDocument();
    expect(screen.getByText(/told 2 people/i)).toBeInTheDocument();
    expect(screen.getByText(/nobody could be told yet/i)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /^open$/i })[0] as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 73 }));
  });
});
