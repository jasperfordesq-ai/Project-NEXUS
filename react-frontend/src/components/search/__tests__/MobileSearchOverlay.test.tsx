// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMockContexts } from '@/test/mock-contexts';

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, first_name: 'Alice' } as never,
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn(() => true),
    }),
  }),
);

import { MobileSearchOverlay } from '../MobileSearchOverlay';

function renderOverlay() {
  return render(
    <MobileSearchOverlay
      isOpen
      onClose={vi.fn()}
      value=""
      onValueChange={vi.fn()}
      placeholder="Search listings"
      recentKey="listings"
    />,
  );
}

describe('MobileSearchOverlay recent searches (F-109)', () => {
  beforeEach(() => localStorage.clear());

  it("does not show another member's or another community's recent searches", () => {
    localStorage.setItem('nexus:recent-searches:listings', JSON.stringify(['unscoped secret']));
    localStorage.setItem('nexus:recent-searches:listings:t2:u7', JSON.stringify(['other member']));
    localStorage.setItem('nexus:recent-searches:listings:t3:u1', JSON.stringify(['other community']));

    renderOverlay();

    expect(screen.queryByText('unscoped secret')).not.toBeInTheDocument();
    expect(screen.queryByText('other member')).not.toBeInTheDocument();
    expect(screen.queryByText('other community')).not.toBeInTheDocument();
  });

  it("shows this member's own recent searches in this community", () => {
    localStorage.setItem('nexus:recent-searches:listings:t2:u1', JSON.stringify(['my search']));

    renderOverlay();

    expect(screen.getByText('my search')).toBeInTheDocument();
  });
});
