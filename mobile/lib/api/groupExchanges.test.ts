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

import { createGroupExchange } from './groupExchanges';

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
});
