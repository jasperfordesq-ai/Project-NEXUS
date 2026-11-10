// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FederationHubPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@/test/test-utils';
import type { ReactNode } from 'react';

// Mock API module
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();

vi.mock('@/lib/api', () => ({
  api: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Mock contexts - must include ToastProvider since test-utils.tsx uses it
vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test', name: 'Test User' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,

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

vi.mock('@/contexts/ToastContext', () => ({
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  })),
  ToastProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatRelativeTime: vi.fn(() => '2 hours ago'),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

type UiStubProps = {
  children?: ReactNode;
  className?: string;
  role?: string;
  href?: string;
  to?: string;
  name?: string;
  src?: string;
  startContent?: ReactNode;
  onPress?: () => void;
  onClick?: () => void;
  isDisabled?: boolean;
  disabled?: boolean;
  'aria-label'?: string;
};

vi.mock('@/components/ui', () => ({
  GlassCard: ({ children, className, role }: UiStubProps) => (
    <div className={className} role={role}>
      {children}
    </div>
  ),
  Button: ({
    children,
    className,
    startContent,
    onPress,
    onClick,
    isDisabled,
    disabled,
    href,
    to,
  }: UiStubProps) => (
    <button
      className={className}
      disabled={isDisabled || disabled}
      type="button"
      onClick={onPress ?? onClick}
      data-href={href ?? to}
    >
      {startContent}
      {children}
    </button>
  ),
  Chip: ({ children, className }: UiStubProps) => <span className={className}>{children}</span>,
  Spinner: ({ className, 'aria-label': ariaLabel }: UiStubProps) => (
    <span className={className} role="status" aria-label={ariaLabel ?? 'loading'} />
  ),
  Avatar: ({ name, src, className }: UiStubProps) => (
    <span className={className} data-src={src} aria-label={name} />
  ),
}));

vi.mock('@/components/navigation', () => ({
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock('@/components/seo', () => ({ PageMeta: () => null }));

vi.mock('@/lib/motion', () => {  const motionProps = new Set(['variants', 'initial', 'animate', 'layout', 'transition', 'exit', 'whileHover', 'whileTap', 'whileInView', 'viewport', 'custom']);  const filterMotion = (props: Record<string, unknown>) => {    const filtered: Record<string, unknown> = {};    for (const [k, v] of Object.entries(props)) {      if (!motionProps.has(k)) filtered[k] = v;    }    return filtered;  };  return {    motion: {      div: ({ children, ...props }: Record<string, unknown>) => <div {...filterMotion(props)}>{children as ReactNode}</div>,    },    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,  };});

import FederationHubPage from './FederationHubPage';

describe('FederationHubPage', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows loading state initially', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { enabled: false, tenant_federation_enabled: false },
    });

    render(<FederationHubPage />);
    expect(screen.getByText('Loading federation data...')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Loading federation data...')).not.toBeInTheDocument();
    });
  });

  it('shows breadcrumbs', async () => {
    mockApiGet.mockResolvedValue({
      success: true,
      data: { enabled: false, tenant_federation_enabled: false },
    });

    render(<FederationHubPage />);
    expect(screen.getByTestId('breadcrumbs')).toBeInTheDocument();
    expect(screen.getByText('Federation')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Loading federation data...')).not.toBeInTheDocument();
    });
  });

  it('shows error state when API fails', async () => {
    mockApiGet.mockRejectedValueOnce(new Error('Network error'));

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Unable to Load')).toBeInTheDocument();
    });
    expect(screen.getByText('An error occurred. Please try again.')).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
  });

  it('shows Federation Not Available when tenant federation is disabled', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: false,
        tenant_federation_enabled: false,
        partnerships_count: 0,
      },
    });

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Federation Not Available')).toBeInTheDocument();
    });
  });

  it('shows hero section with Enable Federation button when not opted in', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: false,
        tenant_federation_enabled: true,
        partnerships_count: 0,
      },
    });

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Federation Network')).toBeInTheDocument();
    });
    expect(screen.getByText('Connect with Communities Worldwide')).toBeInTheDocument();
    expect(screen.getByText('Enable Federation')).toBeInTheDocument();
  });

  it('shows How It Works cards when not opted in', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: false,
        tenant_federation_enabled: true,
        partnerships_count: 0,
      },
    });

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('How It Works')).toBeInTheDocument();
    });
    expect(screen.getByText('Discover Partners')).toBeInTheDocument();
    expect(screen.getByText('Meet Members')).toBeInTheDocument();
    expect(screen.getByText('Exchange Services')).toBeInTheDocument();
  });

  it('shows dashboard when opted in with partner communities', async () => {
    // First call: status
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: true,
        tenant_federation_enabled: true,
        partnerships_count: 2,
      },
    });
    // Second call: partners
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 1,
          name: 'Partner Community A',
          logo: null,
          location: 'Dublin',
          tagline: 'A great community',
          federation_level: 2,
          federation_level_name: 'Standard',
          member_count: 50,
        },
      ],
    });
    // Third call: activity
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [],
    });

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Federation Network')).toBeInTheDocument();
    });
    // Quick links section
    expect(screen.getByText('Explore Network')).toBeInTheDocument();
    // Partner communities section
    expect(screen.getByText('Partner Community A')).toBeInTheDocument();
  });

  // Recent activity tiles were all grey; each kind now has its own colour.
  it('colours each kind of recent activity', async () => {
    mockApiGet.mockResolvedValueOnce({ success: true, data: { enabled: true, tenant_federation_enabled: true, partnerships_count: 1 } });
    mockApiGet.mockResolvedValueOnce({ success: true, data: [] });
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: [
        { id: 1, type: 'transaction_received', title: 'Hours received', description: 'From a partner', created_at: '2026-11-01T10:00:00Z' },
        { id: 2, type: 'member_joined', title: 'New member', description: 'Joined', created_at: '2026-11-01T11:00:00Z' },
      ],
    });

    render(<FederationHubPage />);

    const tiles = await screen.findAllByTestId('federation-activity-tile');
    expect(tiles[0]!.className).toContain('bg-emerald-100');
    expect(tiles[1]!.className).toContain('bg-pink-100');
  });

  it('shows quick navigation links when opted in', async () => {
    mockApiGet.mockResolvedValueOnce({
      success: true,
      data: {
        enabled: true,
        tenant_federation_enabled: true,
        partnerships_count: 0,
      },
    });
    mockApiGet.mockResolvedValueOnce({ success: true, data: [] });
    mockApiGet.mockResolvedValueOnce({ success: true, data: [] });

    render(<FederationHubPage />);

    await waitFor(() => {
      expect(screen.getByText('Explore Network')).toBeInTheDocument();
    });
    // Quick link titles - some may appear in both title and description,
    // so use getAllByText where needed
    expect(screen.getByText('Federation Members')).toBeInTheDocument();
    expect(screen.getAllByText(/Federation Messages/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Federation Listings')).toBeInTheDocument();
    expect(screen.getByText('Federation Events')).toBeInTheDocument();
    expect(screen.getByText('Federation Settings')).toBeInTheDocument();
  });
});
