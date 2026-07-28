// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for MobileComposeOverlay component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import type { ComposeTab, ComposeTabConfig } from '../types';
import FileText from 'lucide-react/icons/file-text';
import ListChecks from 'lucide-react/icons/list-checks';
import Calendar from 'lucide-react/icons/calendar';
import Target from 'lucide-react/icons/target';

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockToast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({ isAuthenticated: true, user: { id: 1, first_name: 'Alice', avatar: '/alice.png' } })),
  useToast: vi.fn(() => mockToast),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
  useTenant: () => ({ tenant: { id: 2, name: 'Test', slug: 'test', tagline: null }, branding: { name: 'Test', logo_url: null }, tenantSlug: 'test', tenantPath: (p: string) => '/test' + p, isLoading: false, hasFeature: vi.fn(() => true), hasModule: vi.fn(() => true) }),
}));

vi.mock('@/components/compose/ComposeSubmitContext', () => ({
  useComposeSubmit: vi.fn(() => ({
    registration: null,
    register: vi.fn(),
    unregister: vi.fn(),
  })),
}));

import { useComposeSubmit } from '../ComposeSubmitContext';
import { MobileComposeOverlay } from '../MobileComposeOverlay';

const sampleTabs: ComposeTabConfig[] = [
  { key: 'post', label: 'Post', icon: FileText },
  { key: 'listing', label: 'Listing', icon: ListChecks },
  { key: 'event', label: 'Event', icon: Calendar },
  { key: 'goal', label: 'Goal', icon: Target },
];

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  activeTab: 'post' as ComposeTab,
  onTabChange: vi.fn(),
  tabs: sampleTabs,
  headerTitle: 'Create Post',
  children: <div data-testid="compose-body">Body content</div>,
};

describe('MobileComposeOverlay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders children when open', () => {
    render(<MobileComposeOverlay {...defaultProps} />);
    expect(screen.getByTestId('compose-body')).toBeInTheDocument();
  });

  it('renders the header title', () => {
    render(<MobileComposeOverlay {...defaultProps} />);
    expect(screen.getByText('Create Post')).toBeInTheDocument();
  });

  // A 'renders the template picker slot' test was removed here, along with the
  // templatePicker prop it passed. The Template button was deliberately removed
  // from the composer in c363aefb3, and MobileComposeOverlayProps no longer
  // declares that slot — the test was asserting a feature that had been dropped
  // on purpose, so it is deleted rather than restored.

  it('renders close button with aria-label', () => {
    render(<MobileComposeOverlay {...defaultProps} />);
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = vi.fn();
    render(<MobileComposeOverlay {...defaultProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not render overlay content when closed', () => {
    render(<MobileComposeOverlay {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId('compose-body')).not.toBeInTheDocument();
  });

  it('renders submit button when registration is present', () => {
    vi.mocked(useComposeSubmit).mockReturnValue({
      registration: {
        canSubmit: true,
        isSubmitting: false,
        onSubmit: vi.fn(),
        buttonLabel: 'Publish',
        gradientClass: 'from-accent to-accent-gradient-end',
      },
      register: vi.fn(),
      unregister: vi.fn(),
    });

    render(<MobileComposeOverlay {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  it('does not render submit button when no registration', () => {
    vi.mocked(useComposeSubmit).mockReturnValue({
      registration: null,
      register: vi.fn(),
      unregister: vi.fn(),
    });
    render(<MobileComposeOverlay {...defaultProps} />);
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
  });
});
