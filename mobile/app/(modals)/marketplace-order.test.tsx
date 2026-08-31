// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
let mockParams: Record<string, string> = { id: '42' };
let mockUser = { id: 7 };

jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
  useLocalSearchParams: () => mockParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, isAuthenticated: true, isLoading: false }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', textMuted: '#666' }),
}));

jest.mock('@/lib/api/marketplace', () => ({
  getMarketplaceOrder: jest.fn(),
}));

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => 'View');
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

import MarketplaceOrderRoute from './marketplace-order';
import { getMarketplaceOrder } from '@/lib/api/marketplace';

describe('MarketplaceOrderRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '42' };
    mockUser = { id: 7 };
  });

  it('resolves a seller notification to Sales and preserves the exact order', async () => {
    jest.mocked(getMarketplaceOrder).mockResolvedValue({
      data: { id: 42, seller: { id: 7 }, buyer: { id: 9 } },
    } as never);

    render(<MarketplaceOrderRoute />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-orders',
      params: { mode: 'sales', order_id: '42' },
    }));
  });

  it('resolves a buyer notification to Purchases and preserves the exact order', async () => {
    jest.mocked(getMarketplaceOrder).mockResolvedValue({
      data: { id: 42, seller: { id: 8 }, buyer: { id: 7 } },
    } as never);

    render(<MarketplaceOrderRoute />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/marketplace-orders',
      params: { mode: 'purchases', order_id: '42' },
    }));
  });

  it('fails closed without calling the API for a malformed order id', () => {
    mockParams = { id: '../admin' };
    const { getByTestId } = render(<MarketplaceOrderRoute />);

    expect(getMarketplaceOrder).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(getByTestId('marketplace-order-unavailable')).toBeTruthy();
  });
});
