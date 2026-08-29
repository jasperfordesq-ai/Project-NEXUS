// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { getPartnerVenuePass, getPartnerVenues, getPartnerVenueVisits, rotatePartnerVenuePass } from './venues';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn(), post: jest.fn() } }));

it('uses the member venue directory, pass, visit, and rotation contracts', async () => {
  (api.get as jest.Mock)
    .mockResolvedValueOnce({ data: { venues: [{ id: 2, name: 'Community Café' }] } })
    .mockResolvedValueOnce({ data: { token: 'abc', qr_url: 'https://example.org/venues/checkin/abc', status: 'active', last_used_at: null } })
    .mockResolvedValueOnce({ data: { visits: [{ id: 5, venue_id: 2, venue_name: 'Community Café', visited_on: '2026-08-28' }] } });
  (api.post as jest.Mock).mockResolvedValue({ data: { token: 'new', qr_url: 'https://example.org/venues/checkin/new', status: 'active', last_used_at: null } });

  await expect(getPartnerVenues()).resolves.toEqual([{ id: 2, name: 'Community Café' }]);
  await expect(getPartnerVenuePass()).resolves.toMatchObject({ token: 'abc' });
  await expect(getPartnerVenueVisits()).resolves.toHaveLength(1);
  await expect(rotatePartnerVenuePass()).resolves.toMatchObject({ token: 'new' });
  expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/partner-venues');
  expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/partner-venues/pass');
  expect(api.get).toHaveBeenNthCalledWith(3, '/api/v2/partner-venues/my-visits');
  expect(api.post).toHaveBeenCalledWith('/api/v2/partner-venues/pass/rotate', {});
});
