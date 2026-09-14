// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/api/client', () => ({
  api: { get: jest.fn(), post: jest.fn() },
}));

jest.mock('@/lib/constants', () => ({
  API_V2: '/api/v2',
}));

import { api } from '@/lib/api/client';
import { createPoll, getRankedPollResults, rankPoll } from './polls';

describe('createPoll', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('posts a standard poll payload to the V2 polls endpoint', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 8 } });

    await createPoll({
      question: 'Which lunch should we host?',
      options: ['Soup', 'Sandwiches'],
      description: 'Choose one',
    });

    expect(api.post).toHaveBeenCalledWith('/api/v2/polls', {
      poll_type: 'standard',
      is_anonymous: false,
      question: 'Which lunch should we host?',
      options: ['Soup', 'Sandwiches'],
      description: 'Choose one',
    });
  });

  it('binds a durable creation key in the header and body', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: { id: 8 } });
    await createPoll({ question: 'Rank these', options: ['A', 'B'], poll_type: 'ranked', is_anonymous: true }, 'poll-key-123');
    expect(api.post).toHaveBeenCalledWith('/api/v2/polls', {
      question: 'Rank these', options: ['A', 'B'], poll_type: 'ranked', is_anonymous: true,
      idempotency_key: 'poll-key-123',
    }, { headers: { 'Idempotency-Key': 'poll-key-123' } });
  });

  it('serializes a ranked preference order into contiguous server ranks', async () => {
    (api.post as jest.Mock).mockResolvedValue({ data: {} });
    await rankPoll(8, [12, 10, 11]);
    expect(api.post).toHaveBeenCalledWith('/api/v2/polls/8/rank', {
      rankings: [
        { option_id: 12, rank: 1 },
        { option_id: 10, rank: 2 },
        { option_id: 11, rank: 3 },
      ],
    });
  });

  it('loads the authoritative ranked results after a poll closes', async () => {
    (api.get as jest.Mock).mockResolvedValue({ data: {} });
    await getRankedPollResults(8);
    expect(api.get).toHaveBeenCalledWith('/api/v2/polls/8/ranked-results');
  });
});
