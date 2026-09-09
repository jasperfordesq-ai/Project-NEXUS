// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const mockNavigate = vi.fn();
const disabledModules = vi.hoisted(() => new Set<string>());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: (url: string | null | undefined) => url ?? null,
  };
});

const mockLogout = vi.fn();

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Jasper Ford', avatar_url: null, avatar: null },
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'authenticated' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn((module: string) => !disabledModules.has(module)),
    }),
  })
);

import { SuperAdminHeader } from './SuperAdminHeader';

describe('SuperAdminHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disabledModules.clear();
  });

  it('renders the header element', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('shows the tenant name from context', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    expect(screen.getByText('hOUR Timebank')).toBeInTheDocument();
  });

  it('shows user name in the avatar button area', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    expect(screen.getByText('Jasper Ford')).toBeInTheDocument();
  });

  it('renders a back-to-admin button', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    // aria-label is set on the back button
    expect(screen.getByRole('button', { name: /back.*admin/i })).toBeInTheDocument();
  });

  it('navigates to admin when back-to-admin button is pressed', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    const backBtn = screen.getByRole('button', { name: /back.*admin/i });
    fireEvent.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/admin');
  });

  it('renders a notifications button', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('button', { name: /notification/i })).toBeInTheDocument();
  });

  it('navigates to notifications when notifications button is pressed', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    const notifBtn = screen.getByRole('button', { name: /notification/i });
    fireEvent.click(notifBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/notifications');
  });

  it('renders a sidebar toggle button when onSidebarToggle is provided', () => {
    const onToggle = vi.fn();
    render(<SuperAdminHeader sidebarCollapsed={false} onSidebarToggle={onToggle} />);
    expect(screen.getByRole('button', { name: /toggle.*sidebar/i })).toBeInTheDocument();
  });

  it('calls onSidebarToggle when the toggle button is pressed', () => {
    const onToggle = vi.fn();
    render(<SuperAdminHeader sidebarCollapsed={false} onSidebarToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /toggle.*sidebar/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does NOT render a sidebar toggle button when onSidebarToggle is omitted', () => {
    render(<SuperAdminHeader sidebarCollapsed={false} />);
    expect(screen.queryByRole('button', { name: /toggle.*sidebar/i })).not.toBeInTheDocument();
  });

  it('hides notifications and profile controls when their modules are disabled', async () => {
    disabledModules.add('notifications');
    disabledModules.add('profile');

    render(<SuperAdminHeader sidebarCollapsed={false} />);

    expect(screen.queryByRole('button', { name: /notification/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Jasper Ford').closest('button')!);
    expect(screen.queryByText(/my.?profile/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/sign.?out/i)).toBeInTheDocument();
  });

});
