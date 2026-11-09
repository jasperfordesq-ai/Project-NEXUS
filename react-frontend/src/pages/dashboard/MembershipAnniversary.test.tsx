// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { authState } = vi.hoisted(() => ({
  authState: { user: { id: 7, first_name: 'Maeve', name: 'Maeve Byrne', created_at: '2025-11-07T10:00:00Z' } as Record<string, unknown> | null },
}));

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: authState.user as unknown as User,
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
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding: { name: 'Hour Timebank' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { MembershipAnniversary } from './MembershipAnniversary';

describe('MembershipAnniversary', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 9, 12, 0));
    try { localStorage.clear(); } catch { /* ignore */ }
    authState.user = { id: 7, first_name: 'Maeve', name: 'Maeve Byrne', created_at: '2025-11-07T10:00:00Z' };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('celebrates in the week after the day the member joined, a year or more ago', () => {
    render(<MembershipAnniversary />);
    const card = screen.getByTestId('membership-anniversary');
    expect(card).toHaveTextContent('Happy anniversary!');
    expect(card).toHaveTextContent('Hour Timebank');
    expect(card).toHaveTextContent('2025');
  });

  it('says nothing on other days of the year', () => {
    authState.user = { id: 7, first_name: 'Maeve', created_at: '2025-10-01T10:00:00Z' };
    render(<MembershipAnniversary />);
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
  });

  it('says nothing in the first year', () => {
    authState.user = { id: 7, first_name: 'Maeve', created_at: '2026-11-05T10:00:00Z' };
    render(<MembershipAnniversary />);
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
  });

  it('says nothing before the day itself', () => {
    authState.user = { id: 7, first_name: 'Maeve', created_at: '2025-11-12T10:00:00Z' };
    render(<MembershipAnniversary />);
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
  });

  it('stays closed for the rest of that anniversary once the member closes it', () => {
    const { unmount } = render(<MembershipAnniversary />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
    unmount();
    render(<MembershipAnniversary />);
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
  });

  it('says nothing when the join date is unknown', () => {
    authState.user = { id: 7, first_name: 'Maeve' };
    render(<MembershipAnniversary />);
    expect(screen.queryByTestId('membership-anniversary')).toBeNull();
  });
});
