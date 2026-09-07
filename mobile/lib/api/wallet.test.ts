// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  ApiResponseError: class ApiResponseError extends Error {
    status!: number;
    constructor(status: number, message: string) { super(message); this.status = status; this.name = 'ApiResponseError'; }
  },
  registerUnauthorizedCallback: jest.fn(),
}));
jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
  API_BASE_URL: 'https://test.api',
  STORAGE_KEYS: { AUTH_TOKEN: 'auth_token', REFRESH_TOKEN: 'refresh_token', TENANT_SLUG: 'tenant_slug', USER_DATA: 'user_data' },
  TIMEOUTS: { API_REQUEST: 15_000 },
  DEFAULT_TENANT: 'test-tenant',
}));

import { api } from '@/lib/api/client';
import { donateWalletCredits, getWalletBalance, getWalletTransactions, searchWalletUsers, transferWalletCredits } from './wallet';
import type { WalletBalanceResponse, WalletTransactionsResponse } from './wallet';

const mockBalanceResponse: WalletBalanceResponse = {
  data: {
    balance: 12,
    total_credits: 20,
    total_debits: 8,
    currency: 'hours',
  },
};

const mockTransactionsResponse: WalletTransactionsResponse = {
  data: [
    {
      id: 1,
      type: 'credit',
      amount: 2,
      description: 'Helped with gardening',
      other_user: { id: 5, name: 'Carol', avatar_url: null },
      created_at: '2026-02-01T10:00:00Z',
      status: 'completed',
      transaction_type: 'exchange',
      category_id: null,
    },
  ],
  meta: { per_page: 20, has_more: false },
};

describe('getWalletBalance', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls /api/v2/wallet/balance and returns balance data', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockBalanceResponse);
    const result = await getWalletBalance();
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/balance');
    expect(result.data.balance).toBe(12);
    expect(result.data.currency).toBe('hours');
  });

  it('propagates errors from the API', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('Unauthorized'));
    await expect(getWalletBalance()).rejects.toThrow('Unauthorized');
  });
});

describe('getWalletTransactions', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('calls /api/v2/wallet/transactions with defaults when no args given', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    const result = await getWalletTransactions();
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/transactions', {
      per_page: '20',
      type: 'all',
    });
    expect(result.data).toHaveLength(1);
  });

  it('includes cursor when provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    await getWalletTransactions('cursor-abc');
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/transactions', {
      per_page: '20',
      type: 'all',
      cursor: 'cursor-abc',
    });
  });

  it('passes custom perPage and type=sent', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    await getWalletTransactions(undefined, 10, 'sent');
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/transactions', {
      per_page: '10',
      type: 'sent',
    });
  });

  it('passes type=received correctly', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    await getWalletTransactions(undefined, 20, 'received');
    const params = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(params.type).toBe('received');
  });

  it('omits cursor when not provided', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    await getWalletTransactions();
    const params = (api.get as jest.Mock).mock.calls[0][1] as Record<string, string>;
    expect(params).not.toHaveProperty('cursor');
  });

  it('propagates errors from the API', async () => {
    (api.get as jest.Mock).mockRejectedValue(new Error('Service error'));
    await expect(getWalletTransactions()).rejects.toThrow('Service error');
  });

  it('passes all three args together correctly', async () => {
    (api.get as jest.Mock).mockResolvedValue(mockTransactionsResponse);
    await getWalletTransactions('next-cursor', 50, 'received');
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/transactions', {
      per_page: '50',
      type: 'received',
      cursor: 'next-cursor',
    });
  });
});

describe('wallet mutations and search', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('searches wallet recipients with query and limit params', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: { users: [] } });
    await searchWalletUsers('jasper', 5);
    expect(api.get).toHaveBeenCalledWith('/api/v2/wallet/user-search', {
      q: 'jasper',
      limit: '5',
    });
  });

  it('posts transfer payload to the v2 wallet transfer endpoint', async () => {
    const payload = { recipient: 12, amount: 2, description: 'Garden help' };
    (api.post as jest.Mock).mockResolvedValue({ success: true });
    await transferWalletCredits(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/wallet/transfer', payload, undefined);
  });

  it('carries a transfer operation id in the header as well as the body', async () => {
    const payload = { recipient: 12, amount: 2, description: 'Garden help', idempotency_key: 'op-1' };
    (api.post as jest.Mock).mockResolvedValue({ success: true });
    await transferWalletCredits(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/wallet/transfer', payload, {
      headers: { 'Idempotency-Key': 'op-1' },
    });
  });

  it('posts donation payload to the v2 wallet donation endpoint', async () => {
    const payload = { recipient_type: 'community_fund' as const, amount: 1.5, message: 'Thank you' };
    (api.post as jest.Mock).mockResolvedValue({ success: true });
    await donateWalletCredits(payload);
    expect(api.post).toHaveBeenCalledWith('/api/v2/wallet/donate', payload);
  });
});
