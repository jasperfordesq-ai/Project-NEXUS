// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ─── Mock api ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url: string | null) => url ?? null),
}));

// ─── Navigation ──────────────────────────────────────────────────────────────
const mockNavigate = vi.fn();

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return { ...orig, useNavigate: () => mockNavigate };
});

// ─── Contexts ────────────────────────────────────────────────────────────────
const mockLogout = vi.fn();
const disabledModules = vi.hoisted(() => new Set<string>());
const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  showToast: vi.fn(),
};

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Alice Admin', avatar_url: null, avatar: null },
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useToast: () => mockToast,
    useTenant: () => ({
      tenant: { id: 2, name: 'Hour Timebank', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: (module: string) => !disabledModules.has(module),
    }),
  })
);

// ─── Stub heavy HeroUI components ────────────────────────────────────────────
vi.mock('@/components/ui', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...orig,
    Button: ({
      children,
      onPress,
      'aria-label': ariaLabel,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      isIconOnly: _isIconOnly,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      startContent: _startContent,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      variant: _variant,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      size: _size,
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
      onPress?: () => void;
      children?: React.ReactNode;
      isIconOnly?: boolean;
      startContent?: React.ReactNode;
      variant?: string;
      size?: string;
    }) => (
      <button aria-label={ariaLabel} onClick={onPress}>
        {children}
      </button>
    ),
    Avatar: ({ name, src }: { name?: string; src?: string }) => (
      <img data-testid="avatar" alt={name ?? ''} src={src || undefined} />
    ),
    Dropdown: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dropdown">{children}</div>
    ),
    DropdownTrigger: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="dropdown-trigger">{children}</div>
    ),
    DropdownMenu: ({
      children,
      onAction,
    }: {
      children: React.ReactNode;
      onAction?: (key: string) => void;
    }) => (
      <div data-testid="dropdown-menu" onClick={(e) => {
        const key = (e.target as HTMLElement).getAttribute('data-key');
        if (key && onAction) onAction(key);
      }}>
        {children}
      </div>
    ),
    DropdownItem: ({
      children,
      id,
    }: {
      children: React.ReactNode;
      id?: string;
    }) => (
      <div data-testid={`dropdown-item-${id}`} data-key={id} role="menuitem">
        {children}
      </div>
    ),
  };
});

// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@/components/ui/Button', () => ({
  Button: ({
    children,
    onPress,
    'aria-label': ariaLabel,
    startContent,
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    onPress?: () => void;
    children?: React.ReactNode;
    isIconOnly?: boolean;
    startContent?: React.ReactNode;
    variant?: string;
    size?: string;
    className?: string;
  }) => (
    <button aria-label={ariaLabel} onClick={onPress}>
      {startContent}
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/Avatar', () => ({
  Avatar: ({ name, src }: { name?: string; src?: string }) => (
    <img data-testid="avatar" alt={name ?? ''} src={src || undefined} />
  ),
}));

vi.mock('@/components/ui/Dropdown', () => ({
  Dropdown: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown">{children}</div>
  ),
  DropdownTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-trigger">{children}</div>
  ),
  DropdownMenu: ({
    children,
    onAction,
  }: {
    children: React.ReactNode;
    onAction?: (key: string) => void;
  }) => (
    <div data-testid="dropdown-menu" onClick={(e) => {
      const key = (e.target as HTMLElement).getAttribute('data-key');
      if (key && onAction) onAction(key);
    }}>
      {children}
    </div>
  ),
  DropdownItem: ({
    children,
    id,
  }: {
    children: React.ReactNode;
    id?: string;
  }) => (
    <div data-testid={`dropdown-item-${id}`} data-key={id} role="menuitem">
      {children}
    </div>
  ),
}));

describe('AdminHeader', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    disabledModules.clear();
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 0)
    );
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle: number) => {
      window.clearTimeout(handle);
    });
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: (callback: IdleRequestCallback) =>
        window.setTimeout(() => callback({
          didTimeout: false,
          timeRemaining: () => 50,
        } as IdleDeadline), 0),
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: (handle: number) => window.clearTimeout(handle),
    });
    // The header fetches open support-request stats on mount; default to a
    // resolved empty payload so the indicator effect never throws.
    mockApi.get.mockResolvedValue({ success: true, data: { open: 0 } });
  });

  it('renders as a header element', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('uses an opaque token-backed header surface so page content cannot show through while scrolling', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('bg-[var(--surface-solid)]');
    expect(header.className).not.toContain('bg-surface/90');
    expect(header.className).not.toContain('backdrop-blur');
  });

  it('shows the tenant name', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(screen.getByText('Hour Timebank')).toBeInTheDocument();
  });

  it('shows the logged-in user name', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });

  it('renders a back-to-site button that navigates to tenant dashboard', async () => {
    const user = userEvent.setup();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    // Find the back button by its aria-label (from i18n admin_nav namespace)
    const backBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('back') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('site')
    );
    expect(backBtn).toBeDefined();

    if (backBtn) {
      await user.click(backBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/dashboard');
    }
  });

  it('shows hamburger toggle button when onSidebarToggle is provided', async () => {
    const mockToggle = vi.fn();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} onSidebarToggle={mockToggle} />);

    // Find toggle button by aria-label (toggle_sidebar from i18n)
    const toggleBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('toggle') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('sidebar') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('menu')
    );
    expect(toggleBtn).toBeDefined();
  });

  it('calls onSidebarToggle when hamburger is clicked', async () => {
    const user = userEvent.setup();
    const mockToggle = vi.fn();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} onSidebarToggle={mockToggle} />);

    const toggleBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('toggle') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('sidebar') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('menu')
    );

    if (toggleBtn) {
      await user.click(toggleBtn);
      expect(mockToggle).toHaveBeenCalledTimes(1);
    }
  });

  it('does not show hamburger toggle when onSidebarToggle is not provided', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const toggleBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('toggle') ||
               btn.getAttribute('aria-label')?.toLowerCase().includes('sidebar')
    );
    expect(toggleBtn).toBeUndefined();
  });

  it('renders notifications button', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const notifBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('notification')
    );
    expect(notifBtn).toBeDefined();
  });

  it('hides notifications and profile controls when their modules are disabled', async () => {
    disabledModules.add('notifications');
    disabledModules.add('profile');
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(screen.getAllByRole('button').some(
      (button) => button.getAttribute('aria-label')?.toLowerCase().includes('notification'),
    )).toBe(false);
    expect(screen.queryByTestId('dropdown-item-profile')).not.toBeInTheDocument();
    expect(screen.getByTestId('dropdown-item-logout')).toBeInTheDocument();
  });

  it('navigates to notifications when bell button is clicked', async () => {
    const user = userEvent.setup();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const notifBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('notification')
    );

    if (notifBtn) {
      await user.click(notifBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/notifications');
    }
  });

  it('renders a support-requests button that navigates to the support reports area', async () => {
    const user = userEvent.setup();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const supportBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('support')
    );
    expect(supportBtn).toBeDefined();

    if (supportBtn) {
      await user.click(supportBtn);
      expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/admin/support-reports');
    }
  });

  it('shows the open support-request count as a red indicator', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: { open: 3 } });
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(await screen.findByText('3')).toBeInTheDocument();
  });

  it('hides the indicator when there are no open support requests', async () => {
    mockApi.get.mockResolvedValue({ success: true, data: { open: 0 } });
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const supportBtn = screen.getAllByRole('button').find(
      (btn) => btn.getAttribute('aria-label')?.toLowerCase().includes('support')
    );
    expect(supportBtn).toBeDefined();
    expect(supportBtn?.textContent).not.toMatch(/\d/);
  });

  it('renders dropdown menu items for profile and sign-out', async () => {
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    expect(screen.getByTestId('dropdown-item-profile')).toBeInTheDocument();
    expect(screen.getByTestId('dropdown-item-logout')).toBeInTheDocument();
  });

  it('calls logout when sign-out menu item is clicked', async () => {
    const user = userEvent.setup();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const logoutItem = screen.getByTestId('dropdown-item-logout');
    await user.click(logoutItem);

    expect(mockLogout).toHaveBeenCalled();
  });

  it('navigates to profile when profile menu item is clicked', async () => {
    const user = userEvent.setup();
    const { AdminHeader } = await import('./AdminHeader');
    render(<AdminHeader sidebarCollapsed={false} />);

    const profileItem = screen.getByTestId('dropdown-item-profile');
    await user.click(profileItem);

    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/profile');
  });
});
