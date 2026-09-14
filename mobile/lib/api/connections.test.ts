// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { declineConnection, getConnections, removeConnection } from './connections';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('connections api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requests accepted connections with pagination params', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [] });

    await getConnections('accepted', 'cursor-1');

    expect(api.get).toHaveBeenCalledWith('/api/v2/connections', {
      status: 'accepted',
      per_page: '20',
      cursor: 'cursor-1',
    });
  });

  it('omits cursor when loading the first page', async () => {
    (api.get as jest.Mock).mockResolvedValueOnce({ data: [] });

    await getConnections('pending_received');

    expect(api.get).toHaveBeenCalledWith('/api/v2/connections', {
      status: 'pending_received',
      per_page: '20',
    });
  });

  it('uses the dedicated decline endpoint for received requests', async () => {
    (api.post as jest.Mock).mockResolvedValueOnce(undefined);

    await declineConnection(42);

    expect(api.post).toHaveBeenCalledWith('/api/v2/connections/42/decline', {});
  });

  it('binds removal to the relationship state shown by the native action', async () => {
    (api.delete as jest.Mock).mockResolvedValue(undefined);

    await removeConnection(42, 'pending');
    await removeConnection(43, 'accepted');

    expect(api.delete).toHaveBeenNthCalledWith(1, '/api/v2/connections/42?expected_status=pending');
    expect(api.delete).toHaveBeenNthCalledWith(2, '/api/v2/connections/43?expected_status=accepted');
  });
});
