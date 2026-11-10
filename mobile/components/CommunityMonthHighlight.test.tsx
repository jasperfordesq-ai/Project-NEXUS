// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockGet = jest.fn();
let mockTenant: { id: number; name: string; branding: { primary_color?: string } } | null = { id: 2, name: 'hOUR Timebank', branding: {} };
let mockListingsOn = true;

jest.mock('@/lib/api/community', () => ({ getCommunityThisMonth: () => mockGet() }));
jest.mock('@/lib/context/TenantContext', () => ({
  useOptionalTenantContext: () => (mockTenant ? { tenant: mockTenant, hasModule: (name: string) => name !== 'listings' || mockListingsOn } : null),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key === 'monthHighlight.title' ? `${String(opts?.month)} in ${String(opts?.community)}` : key,
  }),
}));
jest.mock('@/lib/utils/dateLocale', () => ({ dateLocale: () => 'en-IE' }));

import CommunityMonthHighlight from './CommunityMonthHighlight';

beforeEach(() => {
  mockGet.mockReset();
  mockTenant = { id: 2, name: 'hOUR Timebank', branding: {} };
  mockListingsOn = true;
});

describe('CommunityMonthHighlight', () => {
  it('shows what the community has shared this month, under "{month} in {community}"', async () => {
    mockGet.mockResolvedValue({ data: { month: '2026-11', hours_shared: 12.5, new_members: 3, new_listings: 7 } });
    const screen = render(<CommunityMonthHighlight />);

    expect(await screen.findByTestId('community-month-highlight')).toBeTruthy();
    expect(screen.getByText('November in hOUR Timebank')).toBeTruthy();
    expect(screen.getByLabelText('12.5 monthHighlight.hours')).toBeTruthy();
    expect(screen.getByLabelText('3 monthHighlight.members')).toBeTruthy();
    expect(screen.getByLabelText('7 monthHighlight.listings')).toBeTruthy();
  });

  it('leaves out a total still at zero — "0" reads as a scolding, not a welcome', async () => {
    mockGet.mockResolvedValue({ data: { month: '2026-11', hours_shared: 4, new_members: 0, new_listings: 0 } });
    const screen = render(<CommunityMonthHighlight />);

    expect(await screen.findByTestId('community-month-hours')).toBeTruthy();
    expect(screen.queryByTestId('community-month-members')).toBeNull();
    expect(screen.queryByTestId('community-month-listings')).toBeNull();
  });

  it('shows nothing at all in a quiet month', async () => {
    mockGet.mockResolvedValue({ data: { month: '2026-11', hours_shared: 0, new_members: 0, new_listings: 0 } });
    const screen = render(<CommunityMonthHighlight />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId('community-month-highlight')).toBeNull();
  });

  it('shows nothing when the totals cannot be loaded', async () => {
    mockGet.mockRejectedValue(new Error('offline'));
    const screen = render(<CommunityMonthHighlight />);

    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(screen.queryByTestId('community-month-highlight')).toBeNull();
  });

  it('leaves out new offers and requests where the community has them switched off', async () => {
    mockListingsOn = false;
    mockGet.mockResolvedValue({ data: { month: '2026-11', hours_shared: 2, new_members: 1, new_listings: 9 } });
    const screen = render(<CommunityMonthHighlight />);

    expect(await screen.findByTestId('community-month-members')).toBeTruthy();
    expect(screen.queryByTestId('community-month-listings')).toBeNull();
  });

  it('reads the totals again when Home is pulled to refresh', async () => {
    mockGet.mockResolvedValue({ data: { month: '2026-11', hours_shared: 2, new_members: 1, new_listings: 1 } });
    const screen = render(<CommunityMonthHighlight refreshKey={0} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));

    screen.rerender(<CommunityMonthHighlight refreshKey={1} />);
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(2));
  });
});
