// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for QuickCreateMenu component
 * Verifies modal rendering, feature/module gating, and navigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QuickCreateMenu } from '../QuickCreateMenu';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
const mockHasFeature = vi.fn();
const mockHasModule = vi.fn();
const mockTenantPath = vi.fn((p: string) => `/test${p}`);

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: mockHasFeature,
    hasModule: mockHasModule,
    tenantPath: mockTenantPath,
  }),

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

vi.mock('lucide-react', () => ({
  ListTodo: () => <span data-testid="icon-list" />,
  Calendar: () => <span data-testid="icon-calendar" />,
  Users: () => <span data-testid="icon-users" />,
  Target: () => <span data-testid="icon-target" />,
  X: () => <span data-testid="icon-close" />,
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => <div {...props}>{children}</div>,
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MemoryRouter initialEntries={['/test']}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('QuickCreateMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: all features/modules enabled
    mockHasFeature.mockReturnValue(true);
    mockHasModule.mockReturnValue(true);
  });

  it('renders when open', () => {
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.getByText('Create New')).toBeTruthy();
  });

  it('does not render when closed', () => {
    const { container } = render(
      <W>
        <QuickCreateMenu isOpen={false} onClose={vi.fn()} />
      </W>
    );
    expect(container.textContent).not.toContain('Create New');
  });

  it('shows all options when features enabled', () => {
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.getByText('New offer or request')).toBeTruthy();
    expect(screen.getByText('New Event')).toBeTruthy();
    expect(screen.getByText('New Group')).toBeTruthy();
    expect(screen.getByText('New Goal')).toBeTruthy();
  });

  it('renders an opaque, scrollable bottom sheet with unclipped action cards', () => {
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );

    const dialog = screen.getByRole('dialog', { name: 'Create New' });
    expect(dialog).toHaveAttribute('data-placement', 'bottom');
    expect(dialog).toHaveClass('bg-[var(--surface-dropdown)]', 'overflow-hidden');

    const options = screen.getByTestId('quick-create-options');
    expect(options).toHaveClass('grid-cols-2');

    for (const label of ['New offer or request', 'New Event', 'New Group', 'New Goal']) {
      expect(screen.getByText(label).closest('button')).toHaveClass(
        'h-auto',
        'min-h-[116px]',
        'w-full',
        'overflow-visible',
      );
    }

    expect(screen.getByText('Offer or request a service')).toHaveClass(
      'text-sm',
      'text-theme-muted',
    );
  });

  it('hides event option when events feature disabled', () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'events');
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.getByText('New offer or request')).toBeTruthy();
    expect(screen.queryByText('New Event')).toBeNull();
  });

  it('hides group option when groups feature disabled', () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'groups');
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.getByText('New offer or request')).toBeTruthy();
    expect(screen.queryByText('New Group')).toBeNull();
  });

  it('hides listing option when listings module disabled', () => {
    mockHasModule.mockImplementation((module: string) => module !== 'listings');
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.queryByText('New offer or request')).toBeNull();
    expect(screen.getByText('New Event')).toBeTruthy();
  });

  it('displays option descriptions', () => {
    render(
      <W>
        <QuickCreateMenu isOpen={true} onClose={vi.fn()} />
      </W>
    );
    expect(screen.getByText('Offer or request a service')).toBeTruthy();
    expect(screen.getByText('Organise a community event')).toBeTruthy();
  });
});
