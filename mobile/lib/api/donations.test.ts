// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { getDonationReceipt } from './donations';

jest.mock('@/lib/api/client', () => ({ api: { get: jest.fn() } }));

it('loads only the authenticated donor receipt', async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { id: 9, donor_name: 'Alex', amount: 25, currency: 'EUR', status: 'completed' } });
  await expect(getDonationReceipt(9)).resolves.toMatchObject({ id: 9, donor_name: 'Alex' });
  expect(api.get).toHaveBeenCalledWith('/api/v2/donations/9/receipt');
});
