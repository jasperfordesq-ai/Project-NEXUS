// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-611 (E-121): a member who joined with Google has no password, so nothing
 * that asks "confirm it's you" can work for them. Owner decision: they add a
 * password first. This prompt sends the existing password-reset email to the
 * member's own address, from wherever a password was needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, userEvent } from '@/test/test-utils';

const mockPost = vi.fn();
vi.mock('@/lib/api', () => ({
  api: { post: (...args: unknown[]) => mockPost(...args) },
  tokenManager: { getTenantId: vi.fn() },
}));

const authUser = { id: 9, email: 'gail.google@gmail.com' };
vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: authUser, isAuthenticated: true }),
  useTenant: () => ({ tenant: { id: 2 }, tenantPath: (p: string) => p, hasFeature: () => true, hasModule: () => true }),
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
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

import { SetPasswordPrompt } from './SetPasswordPrompt';

describe('SetPasswordPrompt', () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it('explains why, in the words the caller gives, and what a password unlocks', () => {
    render(<SetPasswordPrompt reason="To turn on two-factor sign-in, your account needs a password first." />);
    expect(screen.getByText('To turn on two-factor sign-in, your account needs a password first.')).toBeInTheDocument();
    expect(screen.getByText(/accessible site and the phone app/)).toBeInTheDocument();
  });

  it('emails a link to set a password to the member\'s own address', async () => {
    mockPost.mockResolvedValue({ success: true, data: {} });
    const user = userEvent.setup();
    render(<SetPasswordPrompt />);

    await user.click(screen.getByRole('button', { name: 'Email me a link to set a password' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledWith('/auth/forgot-password', { email: 'gail.google@gmail.com' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      "We've emailed you a link to set a password. Using it signs you out everywhere, so sign in again afterwards."
    );
    expect(screen.queryByRole('button', { name: 'Email me a link to set a password' })).not.toBeInTheDocument();
  });

  it('says so when the email could not be sent, and lets the member try again', async () => {
    mockPost.mockResolvedValue({ success: false, error: 'Too many requests' });
    const user = userEvent.setup();
    render(<SetPasswordPrompt />);

    await user.click(screen.getByRole('button', { name: 'Email me a link to set a password' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("We couldn't send the email. Please try again.");
    expect(screen.queryByText('Too many requests')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Email me a link to set a password' })).toBeEnabled();
  });
});
