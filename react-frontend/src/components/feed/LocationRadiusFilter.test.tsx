// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for LocationRadiusFilter component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
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
  useAuth: () => ({ user: null, isAuthenticated: false, login: vi.fn(), logout: vi.fn(), register: vi.fn(), updateUser: vi.fn(), refreshUser: vi.fn(), status: 'idle', error: null }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

import { LocationRadiusFilter } from './LocationRadiusFilter';

describe('LocationRadiusFilter', () => {
  const defaultProps = {
    isNearby: false,
    radiusKm: 50,
    onToggle: vi.fn(),
    onRadiusChange: vi.fn(),
    hasLocation: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    render(<LocationRadiusFilter {...defaultProps} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
  });

  it('shows "Global" text when isNearby is false', () => {
    render(<LocationRadiusFilter {...defaultProps} isNearby={false} />);
    expect(screen.getByText('Global')).toBeInTheDocument();
    expect(screen.queryByText("Near me")).not.toBeInTheDocument();
  });

  it('shows "Near me" text when isNearby is true', () => {
    render(<LocationRadiusFilter {...defaultProps} isNearby={true} />);
    expect(screen.getByText("Near me")).toBeInTheDocument();
    expect(screen.queryByText('Global')).not.toBeInTheDocument();
  });

  it('calls onToggle when the button is pressed', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<LocationRadiusFilter {...defaultProps} onToggle={onToggle} />);
    const btn = screen.getByText('Global').closest('button')!;
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('disables the button when hasLocation is false', () => {
    render(<LocationRadiusFilter {...defaultProps} hasLocation={false} />);
    const btn = screen.getByText('Global').closest('button')!;
    expect(btn).toBeDisabled();
  });

  it('shows radius slider and km label when isNearby and hasLocation', () => {
    render(
      <LocationRadiusFilter {...defaultProps} isNearby={true} hasLocation={true} radiusKm={100} />
    );
    expect(screen.getByText('100 km')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeInTheDocument();
  });

  it('does not show radius slider when isNearby is false', () => {
    render(<LocationRadiusFilter {...defaultProps} isNearby={false} />);
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByText(/km$/)).not.toBeInTheDocument();
  });

  it('does not show radius slider when hasLocation is false even if isNearby', () => {
    render(
      <LocationRadiusFilter {...defaultProps} isNearby={true} hasLocation={false} />
    );
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('has correct aria-label on the button', () => {
    render(<LocationRadiusFilter {...defaultProps} isNearby={false} />);
    expect(screen.getByLabelText('Global')).toBeInTheDocument();
  });

  it('has correct aria-label on the button when nearby', () => {
    render(<LocationRadiusFilter {...defaultProps} isNearby={true} />);
    expect(screen.getByLabelText("Near me")).toBeInTheDocument();
  });
});
