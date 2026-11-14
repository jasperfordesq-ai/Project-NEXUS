// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AvailabilityGrid component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@/test/test-utils';
import { api } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/contexts', () => ({
  useToast: vi.fn(() => mockToast),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, name: 'Test User', role: 'user' },
    login: vi.fn(),
    logout: vi.fn(),
    register: vi.fn(),
    updateUser: vi.fn(),
    refreshUser: vi.fn(),
    status: 'idle',
    error: null,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    branding: { name: 'Test', logo_url: null },
    tenantSlug: 'test',
    tenantPath: (p: string) => '/test' + p,
    isLoading: false,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { AvailabilityGrid } from '../AvailabilityGrid';

const mockAvailabilityData = {
  weekly: [
    { day_of_week: 1, start_time: '09:00', end_time: '17:00' }, // Monday (backend: 1=Mon)
    { day_of_week: 3, start_time: '10:00', end_time: '14:00' }, // Wednesday (backend: 3=Wed)
  ],
  timezone: 'Europe/Dublin',
};

describe('AvailabilityGrid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading spinner initially', () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {}));

    render(<AvailabilityGrid editable={true} />);
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('renders the grid with day headers after loading', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText('Mon')).toBeInTheDocument();
      expect(screen.getByText('Tue')).toBeInTheDocument();
      expect(screen.getByText('Wed')).toBeInTheDocument();
      expect(screen.getByText('Thu')).toBeInTheDocument();
      expect(screen.getByText('Fri')).toBeInTheDocument();
      expect(screen.getByText('Sat')).toBeInTheDocument();
      expect(screen.getByText('Sun')).toBeInTheDocument();
    });
  });

  it('renders legend with Available and Unavailable labels', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText('Available')).toBeInTheDocument();
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });
  });

  it('renders the header when editable', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText('Set Your Availability')).toBeInTheDocument();
    });
  });

  it('does not render header when not editable', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={false} />);

    await waitFor(() => {
      expect(screen.queryByText('Set Your Availability')).not.toBeInTheDocument();
    });
  });

  it('returns null when not editable and no availability data', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { weekly: [] },
    });

    render(<AvailabilityGrid editable={false} />);

    await waitFor(() => {
      // Component returns null, so no day headers should appear
      expect(screen.queryByText('Mon')).not.toBeInTheDocument();
      expect(screen.queryByText('Available')).not.toBeInTheDocument();
    });
  });

  it('renders error state on API failure', async () => {
    vi.mocked(api.get).mockRejectedValueOnce(new Error('Network error'));

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText("That didn't load. Try again in a moment.")).toBeInTheDocument();
      expect(screen.getByText('Retry')).toBeInTheDocument();
    });
  });

  it('fetches data from user-specific endpoint when userId provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid userId={42} editable={false} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/users/42/availability');
    });
  });

  it('fetches data from /me endpoint when no userId provided', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/v2/users/me/availability');
    });
  });

  it('renders time slots in the grid', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText('09:00')).toBeInTheDocument();
      expect(screen.getByText('12:00')).toBeInTheDocument();
    });
  });

  it('renders description text when editable', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: mockAvailabilityData,
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText(/Click on time slots/)).toBeInTheDocument();
    });
  });

  it('maps backend day_of_week to correct grid column (Monday=1 → grid col 0)', async () => {
    // Backend: day_of_week 5 = Friday, 09:00-10:00
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        weekly: [{ day_of_week: 5, start_time: '09:00', end_time: '10:00' }],
      },
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      // Friday 09:00 should be "Available", Thursday 09:00 should be "Unavailable"
      const fridaySlot = screen.getByLabelText('Friday 09:00: Available');
      expect(fridaySlot).toBeInTheDocument();
      const thursdaySlot = screen.getByLabelText('Thursday 09:00: Unavailable');
      expect(thursdaySlot).toBeInTheDocument();
    });
  });

  it('maps Sunday (backend day_of_week=0) to last grid column', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        weekly: [{ day_of_week: 0, start_time: '10:00', end_time: '11:00' }],
      },
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      const sundaySlot = screen.getByLabelText('Sunday 10:00: Available');
      expect(sundaySlot).toBeInTheDocument();
      const saturdaySlot = screen.getByLabelText('Saturday 10:00: Unavailable');
      expect(saturdaySlot).toBeInTheDocument();
    });
  });

  it('normalizes MySQL TIME format HH:MM:SS to HH:MM for grid lookup', async () => {
    // MySQL returns "09:00:00" not "09:00"
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        weekly: [{ day_of_week: 1, start_time: '09:00:00', end_time: '11:00:00' }],
      },
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      const slot9 = screen.getByLabelText('Monday 09:00: Available');
      expect(slot9).toBeInTheDocument();
      const slot10 = screen.getByLabelText('Monday 10:00: Available');
      expect(slot10).toBeInTheDocument();
      // 11:00 is the end_time, so it should NOT be available
      const slot11 = screen.getByLabelText('Monday 11:00: Unavailable');
      expect(slot11).toBeInTheDocument();
    });
  });

  it('handles end-of-day slots with end_time beyond grid (22:00)', async () => {
    // User selected 21:00 (last slot) → saved with end_time = "22:00"
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        weekly: [{ day_of_week: 2, start_time: '21:00', end_time: '22:00' }],
      },
    });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      const lastSlot = screen.getByLabelText('Tuesday 21:00: Available');
      expect(lastSlot).toBeInTheDocument();
    });
  });

  it('sends correct backend day_of_week when saving (grid Fri=4 → backend 5)', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: { weekly: [] },
    });
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: { weekly: [] } });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByText('Set Your Availability')).toBeInTheDocument();
    });

    // Click Friday 15:00 (grid column 4)
    const fridaySlot = screen.getByLabelText('Friday 15:00: Unavailable');
    fridaySlot.click();

    // Click Save
    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
    screen.getByText('Save').click();

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/availability', {
        slots: [{ day_of_week: 5, start_time: '15:00', end_time: '16:00' }],
      });
    });
  });

  it('sends empty slots array when all availability is cleared', async () => {
    // Load with one slot, then toggle it off
    vi.mocked(api.get).mockResolvedValueOnce({
      success: true,
      data: {
        weekly: [{ day_of_week: 1, start_time: '09:00', end_time: '10:00' }],
      },
    });
    vi.mocked(api.put).mockResolvedValueOnce({ success: true, data: { weekly: [] } });

    render(<AvailabilityGrid editable={true} />);

    await waitFor(() => {
      expect(screen.getByLabelText('Monday 09:00: Available')).toBeInTheDocument();
    });

    // Toggle it off
    screen.getByLabelText('Monday 09:00: Available').click();

    await waitFor(() => {
      expect(screen.getByText('Save')).toBeInTheDocument();
    });
    screen.getByText('Save').click();

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/v2/users/me/availability', {
        slots: [],
      });
    });
  });
});
