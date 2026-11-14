// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import type { User } from '@/types/api';

const { mockApi } = vi.hoisted(() => ({ mockApi: { get: vi.fn() } }));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/contexts', () => createMockContexts({
  useAuth: () => ({
    user: { id: 7 } as unknown as User,
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
    tenant: { id: 106, name: 'Riverside Timebank', slug: 'riverside' },
    branding: { name: 'Riverside Timebank' },
    tenantPath: (p: string) => `/riverside${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  }),
}));

import { CommunityAnniversary } from './CommunityAnniversary';

const reply = (anniversary_years: number | null | undefined) => ({
  success: true,
  data: { month: '2026-11', hours_shared: 0, new_members: 0, new_listings: 0, anniversary_years },
});

describe('CommunityAnniversary', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    localStorage.clear();
  });

  it("celebrates the community's birthday in its anniversary month", async () => {
    mockApi.get.mockResolvedValueOnce(reply(3));
    render(<CommunityAnniversary />);

    const card = await screen.findByTestId('community-anniversary');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/community/this-month');
    expect(card).toHaveTextContent('Riverside Timebank is 3 this month');
    expect(card).toHaveTextContent('Thank you to everyone who has given an hour along the way.');
  });

  it('says "one" for the first birthday', async () => {
    mockApi.get.mockResolvedValueOnce(reply(1));
    render(<CommunityAnniversary />);
    expect(await screen.findByRole('heading', { name: 'Riverside Timebank is one this month' })).toBeInTheDocument();
  });

  it.each([null, undefined, 0])('shows nothing when the server gives no anniversary (%s)', async (years) => {
    mockApi.get.mockResolvedValueOnce(reply(years));
    render(<CommunityAnniversary />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-anniversary')).toBeNull();
  });

  it('shows nothing if the month cannot be loaded', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    render(<CommunityAnniversary />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-anniversary')).toBeNull();
  });

  it('stays closed once the member closes it, until the next birthday', async () => {
    mockApi.get.mockResolvedValue(reply(3));
    const first = render(<CommunityAnniversary />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('community-anniversary')).toBeNull();
    first.unmount();

    render(<CommunityAnniversary />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId('community-anniversary')).toBeNull();

    // A year later it is a new birthday, and it shows again.
    mockApi.get.mockResolvedValue(reply(4));
    render(<CommunityAnniversary />);
    expect(await screen.findByTestId('community-anniversary')).toHaveTextContent('Riverside Timebank is 4 this month');
  });
});
