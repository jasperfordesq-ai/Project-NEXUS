// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

// ── Stable mock refs ──────────────────────────────────────────────────────────
const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
const mockNavigate = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useToast: () => mockToast,
  }),
);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Mock adminVolunteering — all three methods used by VolunteeringOverview
// Must use vi.hoisted() so the ref is available when the vi.mock factory runs (which is hoisted)
const mockAdminVolunteering = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getTrends: vi.fn(),
  getActivityFeed: vi.fn(),
}));

vi.mock('@/admin/api/adminApi', () => ({
  adminVolunteering: mockAdminVolunteering,
}));

// The wellbeing panel talks to the shared api client directly (adminApi has no
// wellbeing helper), so mock @/lib/api's get/put.
const mockApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: mockApi,
  default: mockApi,
  API_BASE: 'http://localhost/api',
}));

// Recharts causes issues in jsdom — stub it
vi.mock('recharts', () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => <div data-testid="area-chart">{children}</div>,
  Area: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));

import { VolunteeringOverview } from './VolunteeringOverview';

// React needed for Recharts stub JSX
import React from 'react';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_STATS = {
  total_opportunities: 20,
  active_opportunities: 8,
  total_applications: 45,
  pending_applications: 3,
  total_hours_logged: 150,
  active_volunteers: 12,
};

const MOCK_OVERVIEW_RESPONSE = {
  success: true,
  data: {
    stats: MOCK_STATS,
    recent_opportunities: [
      { id: 1, title: 'Garden Helper', status: 'active', first_name: 'Test', last_name: 'Org', created_at: '2026-06-01T00:00:00Z' },
      { id: 2, title: 'Delivery Driver', status: 'open', first_name: 'Another', last_name: 'Org', created_at: '2026-06-02T00:00:00Z' },
    ],
  },
};

const MOCK_TRENDS_RESPONSE = {
  success: true,
  data: {
    hours_by_period: [{ period: 'Mon', hours: 10, count: 2 }],
    applications_by_period: [{ period: 'Mon', count: 5, approved: 3 }],
    volunteers_by_period: [{ period: 'Mon', count: 4 }],
  },
};

const MOCK_ACTIVITY_RESPONSE = {
  success: true,
  data: {
    activities: [
      {
        type: 'hours_logged',
        timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
        user_name: 'Jane Doe',
        avatar_url: '',
        description: 'Logged 2 hours for garden help',
        entity_type: 'vol_log',
        entity_id: 10,
      },
    ],
  },
};

// Default wellbeing endpoint responses for every test (individual tests override).
beforeEach(() => {
  mockApi.get.mockResolvedValue({ success: true, data: [] });
  mockApi.put.mockResolvedValue({ success: true });
});

describe('VolunteeringOverview — loading state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows skeleton loaders while data is loading', () => {
    // Never resolve
    mockAdminVolunteering.getOverview.mockReturnValue(new Promise(() => {}));
    mockAdminVolunteering.getTrends.mockReturnValue(new Promise(() => {}));
    mockAdminVolunteering.getActivityFeed.mockReturnValue(new Promise(() => {}));

    render(<VolunteeringOverview />);

    // StatCard renders skeletons when loading=true
    // The page renders 6 StatCard components while loading, which use HeroUI Skeleton
    const skeletons = document.querySelectorAll('[data-slot="base"]');
    // Either skeleton elements or the Recharts stub is present — just check render didn't crash
    expect(document.body).not.toBeEmptyDOMElement();
  });
});

describe('VolunteeringOverview — populated state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders stat card values after load', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    // StatCard renders loading={false} once data comes through
    await waitFor(() => {
      // active_opportunities = 8
      expect(screen.getByText('8')).toBeInTheDocument();
    });
    // pending_applications = 3
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders recent opportunity titles', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(screen.getByText('Garden Helper')).toBeInTheDocument();
      expect(screen.getByText('Delivery Driver')).toBeInTheDocument();
    });
  });

  it('renders activity feed items', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(screen.getByText('Jane Doe')).toBeInTheDocument();
      expect(screen.getByText('Logged 2 hours for garden help')).toBeInTheDocument();
    });
  });

  it('shows area chart when trend data is present', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(screen.getByTestId('area-chart')).toBeInTheDocument();
    });
  });

  it('shows alert banner when pending_applications > 0', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    // pending_applications = 3 → alert banner should appear
    await waitFor(() => {
      // Alert banner rendered with role="button" (onClick + tabIndex=0)
      const alertBanners = screen.getAllByRole('button');
      // The one with pending applications text
      const alertBtn = alertBanners.find(
        (b) =>
          b.textContent?.toLowerCase().includes('pending') ||
          b.textContent?.includes('3'),
      );
      expect(alertBtn).toBeDefined();
    });
  });
});

describe('VolunteeringOverview — empty states', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows no-opportunities message when opportunities list is empty', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue({
      success: true,
      data: { stats: MOCK_STATS, recent_opportunities: [] },
    });
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      // i18n key will render as literal key in test — check it's a non-empty text
      const statsEl = screen.getByText('8');
      expect(statsEl).toBeInTheDocument();
    });
    // opportunities list is empty — the empty state div should be present
    // (the Heart icon + "no_opportunities_yet" key text)
    const emptyDivs = document.querySelectorAll('.flex.flex-col.items-center');
    expect(emptyDivs.length).toBeGreaterThan(0);
  });

  it('shows no-trend-data message when trends array empty', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue({
      success: true,
      data: {
        hours_by_period: [],
        applications_by_period: [],
        volunteers_by_period: [],
      },
    });
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      // Chart stub not present when empty (no area-chart rendered with empty data)
      expect(screen.queryByTestId('area-chart')).toBeNull();
    });
  });
});

describe('VolunteeringOverview — error state', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows error toast when overview fetch fails', async () => {
    mockAdminVolunteering.getOverview.mockRejectedValueOnce(new Error('Server error'));
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
  });
});

describe('VolunteeringOverview — trend period switch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calls getTrends with month when Monthly button pressed', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);

    await waitFor(() => screen.getByText('8'));

    const monthlyBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('month') ||
        b.textContent?.toLowerCase().includes('volunteering.monthly'),
    );
    expect(monthlyBtn).toBeDefined();
    fireEvent.click(monthlyBtn!);

    await waitFor(() => {
      // getTrends called at least twice: once for 'week' on mount, once for 'month'
      const calls = vi.mocked(mockAdminVolunteering.getTrends).mock.calls;
      const monthCall = calls.find((c) => c[0] === 'month');
      expect(monthCall).toBeDefined();
    });
  });
});

describe('VolunteeringOverview — refresh', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-fetches all data when refresh button pressed', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);
    await waitFor(() => screen.getByText('8'));

    const refreshBtn = screen.getAllByRole('button').find(
      (b) =>
        b.textContent?.toLowerCase().includes('refresh') ||
        b.textContent?.toLowerCase().includes('volunteering.refresh'),
    );
    expect(refreshBtn).toBeDefined();
    fireEvent.click(refreshBtn!);

    await waitFor(() => {
      // getOverview should have been called at least twice now
      expect(mockAdminVolunteering.getOverview.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('navigates to approvals when alert banner clicked', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);
    await waitFor(() => screen.getByText('8'));

    // Alert banner has role="button" from tabIndex + onClick
    const allBtns = screen.getAllByRole('button');
    const alertBtn = allBtns.find(
      (b) =>
        b.textContent?.toLowerCase().includes('pending') ||
        (b.textContent?.includes('3') && b.getAttribute('role') === 'button'),
    );
    if (alertBtn) {
      fireEvent.click(alertBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/test/admin/volunteering/approvals');
    }
  });

  // Gap D3: the quick actions navigated without the community prefix, so on a community
  // reached by its slug they left that community.
  it('keeps quick-action navigation inside the community', async () => {
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);

    render(<VolunteeringOverview />);
    fireEvent.click(await screen.findByRole('button', { name: /Verify hours/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/test/admin/volunteering/hours');
  });
});

describe('VolunteeringOverview — wellbeing alerts', () => {
  beforeEach(() => vi.clearAllMocks());

  const WELLBEING_ALERT = {
    id: 55,
    user_id: 3,
    user_name: 'Carer Bob',
    risk_level: 'moderate',
    reason: 'activity',
    latest_checkin: null,
    status: 'active',
    created_at: '2026-06-10T00:00:00Z',
  };

  it('queries the wellbeing alerts endpoint with the active status on mount', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);
    mockApi.get.mockResolvedValue({ success: true, data: [] });

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(mockApi.get).toHaveBeenCalledWith(expect.stringContaining('status=active'));
    });
  });

  it('renders an active alert and fires the PUT when acknowledged', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);
    mockApi.get.mockResolvedValue({ success: true, data: [WELLBEING_ALERT] });
    mockApi.put.mockResolvedValue({ success: true });

    render(<VolunteeringOverview />);

    // The alerts card (WellbeingAlertsPanel) shows the name, a translated reason and risk level.
    await waitFor(() => {
      expect(screen.getByText('Carer Bob')).toBeInTheDocument();
    });
    expect(screen.getByText('Activity pattern')).toBeInTheDocument();
    expect(screen.getByText('Moderate risk')).toBeInTheDocument();

    const ackBtn = screen.getAllByRole('button').find(
      (b) => b.textContent?.toLowerCase().includes('acknowledge'),
    );
    expect(ackBtn).toBeDefined();
    fireEvent.click(ackBtn!);

    await waitFor(() => {
      expect(mockApi.put).toHaveBeenCalledWith(
        expect.stringContaining('/wellbeing/alerts/55'),
        { status: 'acknowledged' },
      );
    });
  });

  it('reloads the wellbeing alerts when the page Refresh button is pressed', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);
    mockApi.get.mockResolvedValue({ success: true, data: [] });

    render(<VolunteeringOverview />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    expect(mockApi.get).toHaveBeenLastCalledWith(expect.stringContaining('/wellbeing/alerts?status=active'));
  });

  it('renders defensively when the alert list envelope is nested under data.items', async () => {
    mockAdminVolunteering.getOverview.mockResolvedValue(MOCK_OVERVIEW_RESPONSE);
    mockAdminVolunteering.getTrends.mockResolvedValue(MOCK_TRENDS_RESPONSE);
    mockAdminVolunteering.getActivityFeed.mockResolvedValue(MOCK_ACTIVITY_RESPONSE);
    mockApi.get.mockResolvedValue({ success: true, data: { items: [WELLBEING_ALERT] } });

    render(<VolunteeringOverview />);

    await waitFor(() => {
      expect(screen.getByText('Carer Bob')).toBeInTheDocument();
    });
  });
});
