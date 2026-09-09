// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import userEvent from '@testing-library/user-event';
import { createMockContexts } from '@/test/mock-contexts';

const mockNavigate = vi.fn();
const mockLogout = vi.fn();
const disabledModules = vi.hoisted(() => new Set<string>());

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/lib/helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/helpers')>()),
  resolveAvatarUrl: vi.fn(() => null),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Partner Admin', avatar_url: null, avatar: null },
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
      tenant: { id: 2, name: 'Test Timebank', slug: 'test' },
      tenantPath: (path: string) => `/test${path}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn((module: string) => !disabledModules.has(module)),
    }),
  }),
);

import { PartnersHeader } from './PartnersHeader';

describe('PartnersHeader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    disabledModules.clear();
  });

  it('renders enabled member controls and returns to admin', async () => {
    const user = userEvent.setup();
    render(<PartnersHeader sidebarCollapsed={false} />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByText('Test Timebank')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    await user.click(screen.getAllByRole('button')[0]!);
    expect(mockNavigate).toHaveBeenCalledWith('/test/admin');
  });

  it('hides notifications and profile controls when their modules are disabled', async () => {
    disabledModules.add('notifications');
    disabledModules.add('profile');
    const user = userEvent.setup();

    render(<PartnersHeader sidebarCollapsed={false} />);

    expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
    await user.click(screen.getByText('Partner Admin').closest('button')!);
    expect(screen.queryByText(/my.?profile/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/sign.?out/i)).toBeInTheDocument();
  });
});
