// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

const mockNavigate = vi.fn();
const disabledModules = vi.hoisted(() => new Set<string>());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogout = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: {
        id: 1,
        name: 'Alice Smith',
        avatar_url: null,
        avatar: null,
      },
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantSlug: 'hour-timebank',
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn((module: string) => !disabledModules.has(module)),
    }),
  })
);

// resolveAvatarUrl may call URL helpers; stub it while preserving all other exports.
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: vi.fn(() => null),
  };
});

import { BrokerHeader } from './BrokerHeader';

describe('BrokerHeader', () => {
  const onSidebarToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    disabledModules.clear();
  });

  it('renders a <header> element', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the tenant name', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByText('hOUR Timebank')).toBeInTheDocument();
  });

  it('renders the user name', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    // Name is hidden on mobile, shown on sm+ — getByText finds it regardless of visibility
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders a notifications button', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('navigates to dashboard when back-to-site button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);
    // The back-to-site button has an ArrowLeft icon; pick the button containing "back"
    const backBtn = screen.getAllByRole('button').find((b) =>
      /back/i.test(b.getAttribute('aria-label') || b.textContent || '')
    );
    // It may not have an aria-label; it's the one before the tenant name.
    // Navigate by pressing all buttons that are NOT the sidebar toggle and NOT icon-only notifications
    // Simpler: press the back arrow button (startContent=ArrowLeft, no aria-label for the back text)
    // The sidebar toggle is only shown when onSidebarToggle is provided
    const [backButton] = screen.getAllByRole('button');
    await user.click(backButton);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/dashboard');
  });

  it('renders a sidebar toggle button when onSidebarToggle is provided', () => {
    render(<BrokerHeader sidebarCollapsed={false} onSidebarToggle={onSidebarToggle} />);
    expect(screen.getByRole('button', { name: /toggle.*(sidebar|menu)/i })).toBeInTheDocument();
  });

  it('calls onSidebarToggle when the menu button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} onSidebarToggle={onSidebarToggle} />);
    await user.click(screen.getByRole('button', { name: /toggle.*(sidebar|menu)/i }));
    expect(onSidebarToggle).toHaveBeenCalled();
  });

  it('does NOT render a sidebar toggle button when onSidebarToggle is absent', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.queryByRole('button', { name: /toggle.*(sidebar|menu)/i })).not.toBeInTheDocument();
  });

  it('navigates to notifications when notifications button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/notifications');
  });

  it('calls logout when the sign-out dropdown item is activated', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);

    // Open the user dropdown — find the button that contains the avatar/user-name area
    // It doesn't have an aria-label, so we target by text content
    const avatarButton = screen.getByText('Alice Smith').closest('button');
    expect(avatarButton).not.toBeNull();
    await user.click(avatarButton!);

    // After opening, the DropdownMenu renders items in a portal
    const signOutItem = await screen.findByText(/sign.?out/i);
    await user.click(signOutItem);
    expect(mockLogout).toHaveBeenCalled();
  });

  it('navigates to profile when My Profile dropdown item is activated', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);

    const avatarButton = screen.getByText('Alice Smith').closest('button');
    await user.click(avatarButton!);

    const profileItem = await screen.findByText(/my.?profile/i);
    await user.click(profileItem);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/profile');
  });

  it('hides notifications and profile controls when their modules are disabled', async () => {
    disabledModules.add('notifications');
    disabledModules.add('profile');
    const user = userEvent.setup();

    render(<BrokerHeader sidebarCollapsed={false} />);

    expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
    await user.click(screen.getByText('Alice Smith').closest('button')!);
    expect(screen.queryByText(/my.?profile/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/sign.?out/i)).toBeInTheDocument();
  });
});
