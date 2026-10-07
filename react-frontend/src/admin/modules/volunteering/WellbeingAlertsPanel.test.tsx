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
});
