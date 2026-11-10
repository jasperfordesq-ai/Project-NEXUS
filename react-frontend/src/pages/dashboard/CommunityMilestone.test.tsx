// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { mockApi } = vi.hoisted(() => ({
  mockApi: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));

vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: { id: 7, first_name: 'Maeve', name: 'Maeve Byrne' } as unknown as User,
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

import { CommunityMilestone, milestoneReached } from './CommunityMilestone';

const stats = (hours: number, scope = 'tenant') =>
  mockApi.get.mockResolvedValue({ success: true, data: { hours_exchanged: hours, scope } });

describe('milestoneReached', () => {
  it('is the largest round number the community has passed', () => {
    expect(milestoneReached(99)).toBeNull();
    expect(milestoneReached(100)).toBe(100);
    expect(milestoneReached(1234)).toBe(1000);
    expect(milestoneReached(250000)).toBe(100000);
  });

  it('is nothing for a missing or broken figure', () => {
    expect(milestoneReached(null)).toBeNull();
    expect(milestoneReached(Number.NaN)).toBeNull();
  });
});

describe('CommunityMilestone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('celebrates the milestone the community has reached', async () => {
    stats(1234);
    render(<CommunityMilestone />);
    const card = await screen.findByTestId('community-milestone');
    expect(card).toHaveTextContent('1,000');
    expect(card).toHaveTextContent('Hour Timebank');
  });

  it('says nothing below the first milestone', async () => {
    stats(42);
    render(<CommunityMilestone />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-milestone')).toBeNull();
  });

  it('never celebrates a platform-wide total as if it were this community\'s', async () => {
    stats(50000, 'platform');
    render(<CommunityMilestone />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-milestone')).toBeNull();
  });

  it('stays closed once the member closes it, until the next milestone', async () => {
    stats(1234);
    const first = render(<CommunityMilestone />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('community-milestone')).toBeNull();
    first.unmount();

    render(<CommunityMilestone />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('community-milestone')).toBeNull();

    stats(2600);
    render(<CommunityMilestone />);
    expect(await screen.findByTestId('community-milestone')).toHaveTextContent('2,500');
  });
});
