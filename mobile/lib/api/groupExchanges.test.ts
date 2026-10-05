// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const mockPost = jest.fn();

jest.mock('@/lib/api/client', () => ({
  api: {
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

import { createGroupExchange, previewGroupExchange } from './groupExchanges';

describe('groupExchanges API', () => {
  beforeEach(() => {
    mockPost.mockReset().mockResolvedValue({ data: { id: 9 } });
  });

  it('posts create group exchange payloads to the V2 endpoint', async () => {
    const payload = {
      title: 'Community garden workday',
      description: 'Prepare beds together.',
      split_type: 'equal' as const,
      total_hours: 6,
    };

    await createGroupExchange(payload);

    expect(mockPost).toHaveBeenCalledWith('/api/v2/group-exchanges', payload);
  });

  it('sends the durable creation key in the body and header', async () => {
    const payload = {
      title: 'Community garden workday',
      split_type: 'equal' as const,
      total_hours: 6,
    };

    await createGroupExchange(payload, 'mobile-group-exchange-create-123');

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v2/group-exchanges',
      { ...payload, idempotency_key: 'mobile-group-exchange-create-123' },
      { headers: { 'Idempotency-Key': 'mobile-group-exchange-create-123' } },
    );
  });

  it('asks the server to preview a split, writing nothing', async () => {
    const preview = {
      lines: [{ user_id: 1, name: 'Mary Byrne', role: 'provider', hours: 2, verb: 'earns' }],
      community_fund_hours: 6,
      totals: { earned: 2, paid: 8, to_fund: 6 },
      problem: null,
    };
    mockPost.mockResolvedValueOnce({ data: preview });
    const payload = {
      split_type: 'workshop' as const,
      total_hours: 2,
      participants: [{ user_id: 1, role: 'provider' as const, hours: 2, weight: 1 }],
    };

    const response = await previewGroupExchange(payload);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith('/api/v2/group-exchanges/preview', payload);
    expect(response.data.community_fund_hours).toBe(6);
  });

  it.each(['workshop', 'team', 'equal', 'weighted', 'custom'] as const)('accepts the %s kind when creating', async kind => {
    await createGroupExchange({ title: 'Kind check', split_type: kind, total_hours: 2 });

    expect(mockPost).toHaveBeenCalledWith('/api/v2/group-exchanges', expect.objectContaining({ split_type: kind }));
  });
});
