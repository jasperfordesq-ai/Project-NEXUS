// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';

const { mockApi, tenantState } = vi.hoisted(() => ({
  mockApi: { get: vi.fn() },
  tenantState: { listings: true },
}));

vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/contexts', () => createMockContexts({
  useTenant: () => ({
    tenant: { id: 2, name: 'Hour Timebank', slug: 'test' },
    branding: { name: 'Hour Timebank' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn((key: string) => (key === 'listings' ? tenantState.listings : true)),
  }),
}));

import { CommunityMonthHighlight } from './CommunityMonthHighlight';

const month = (data: Partial<{ hours_shared: number; new_members: number; new_listings: number }>) => ({
  success: true,
  data: { month: '2026-11', hours_shared: 0, new_members: 0, new_listings: 0, ...data },
});

describe('CommunityMonthHighlight', () => {
  beforeEach(() => {
    mockApi.get.mockReset();
    tenantState.listings = true;
  });

  it("shows this month's hours, new members and new offers for the community", async () => {
    mockApi.get.mockResolvedValueOnce(month({ hours_shared: 42.5, new_members: 9, new_listings: 12 }));
    render(<CommunityMonthHighlight />);

    const card = await screen.findByTestId('community-month-highlight');
    expect(mockApi.get).toHaveBeenCalledWith('/v2/community/this-month');
    expect(within(card).getByRole('heading', { name: /Hour Timebank/ })).toBeInTheDocument();
    expect(within(card).getByText('42.5')).toBeInTheDocument();
    expect(within(card).getByText('Hours shared')).toBeInTheDocument();
    expect(within(card).getByText('9')).toBeInTheDocument();
    expect(within(card).getByText('New members')).toBeInTheDocument();
    expect(within(card).getByText('12')).toBeInTheDocument();
    expect(within(card).getByText('New offers and requests')).toBeInTheDocument();
  });

  it('names the month in the heading', async () => {
    mockApi.get.mockResolvedValueOnce(month({ new_members: 1 }));
    render(<CommunityMonthHighlight />);
    const expected = new Date(2026, 10, 1).toLocaleDateString('en', { month: 'long' });
    expect(await screen.findByRole('heading', { name: new RegExp(expected) })).toBeInTheDocument();
  });

  it('leaves out a total that is still zero, rather than showing "0"', async () => {
    mockApi.get.mockResolvedValueOnce(month({ hours_shared: 0, new_members: 5, new_listings: 1 }));
    render(<CommunityMonthHighlight />);
    const card = await screen.findByTestId('community-month-highlight');
    expect(within(card).queryByText('Hours shared')).toBeNull();
    expect(within(card).getByText('New members')).toBeInTheDocument();
    expect(within(card).getByText('New offers and requests')).toBeInTheDocument();
  });

  it('shows nothing in a quiet month, rather than a row of zeros', async () => {
    mockApi.get.mockResolvedValueOnce(month({}));
    render(<CommunityMonthHighlight />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-month-highlight')).toBeNull();
  });

  it('shows nothing if the totals cannot be loaded', async () => {
    mockApi.get.mockRejectedValueOnce(new Error('offline'));
    render(<CommunityMonthHighlight />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
    expect(screen.queryByTestId('community-month-highlight')).toBeNull();
  });

  it('leaves out offers and requests where the community has switched them off', async () => {
    tenantState.listings = false;
    mockApi.get.mockResolvedValueOnce(month({ hours_shared: 3, new_members: 2, new_listings: 5 }));
    render(<CommunityMonthHighlight />);
    const card = await screen.findByTestId('community-month-highlight');
    expect(within(card).queryByText('New offers and requests')).toBeNull();
  });
});
