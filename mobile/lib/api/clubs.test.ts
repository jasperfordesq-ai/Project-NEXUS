// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { getClubs } from './clubs';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn() } }));

it('loads and normalises the public club directory', async () => {
  (api.get as jest.Mock).mockResolvedValue({
    data: [{ id: 4, name: 'Garden Club', member_count: 12 }],
    meta: { current_page: 2, total: 21, has_more: true },
  });
  await expect(getClubs({ search: 'garden', page: 2 })).resolves.toEqual({
    items: [{ id: 4, name: 'Garden Club', member_count: 12 }],
    page: 2,
    total: 21,
    hasMore: true,
  });
  expect(api.get).toHaveBeenCalledWith('/api/v2/clubs', { search: 'garden', page: '2', per_page: '20' });
});
