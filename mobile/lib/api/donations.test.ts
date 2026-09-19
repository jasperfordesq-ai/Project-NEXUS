// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { getDonationReceipt } from './donations';

jest.mock('@/lib/api/client', () => ({ ...jest.requireActual('@/lib/api/client'), api: { get: jest.fn() } }));

const receipt = {
  donation_id: 9, donor_name: 'Alex', amount: '25.50', currency: 'EUR', status: 'completed',
  tenant_name: 'Local community', payment_reference: 'donation-reference-9', payment_method: 'card',
  date: '2026-09-19 10:00:00', message: '', is_anonymous: false, donor_email: 'synthetic@example.invalid',
};

beforeEach(() => jest.clearAllMocks());

it('loads only the authenticated donor receipt', async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: receipt });
  await expect(getDonationReceipt(9)).resolves.toEqual({
    id: 9, donor_name: 'Alex', amount: 25.5, currency: 'EUR', status: 'completed',
    community_name: 'Local community', reference: 'donation-reference-9', payment_method: 'card',
    date: receipt.date, message: '',
  });
  expect(api.get).toHaveBeenCalledWith('/api/v2/donations/9/receipt');
});

it('accepts an unwrapped receipt without inventing a reference or message', async () => {
  (api.get as jest.Mock).mockResolvedValue({ ...receipt, payment_reference: '', message: null });
  await expect(getDonationReceipt(9)).resolves.toMatchObject({ reference: '', message: null });
});

it.each(['', 'not money', null, -1, 'Infinity', '25.50oops'])('rejects malformed amount %p instead of rendering it as zero', async amount => {
  (api.get as jest.Mock).mockResolvedValue({ data: { ...receipt, amount } });
  await expect(getDonationReceipt(9)).rejects.toMatchObject({ code: 'DONATION_RECEIPT_CONTRACT_DRIFT' });
});

it('refuses a receipt for a different requested donation', async () => {
  (api.get as jest.Mock).mockResolvedValue({ data: { ...receipt, donation_id: 10 } });
  await expect(getDonationReceipt(9)).rejects.toMatchObject({ code: 'DONATION_RECEIPT_CONTRACT_DRIFT' });
});

it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid id %p before transport', async id => {
  await expect(getDonationReceipt(id)).rejects.toMatchObject({ code: 'DONATION_RECEIPT_INVALID_ID' });
  expect(api.get).not.toHaveBeenCalled();
});
