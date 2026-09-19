// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { z } from 'zod';
import i18n from 'i18next';
import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface DonationReceipt {
  id: number;
  donor_name: string;
  amount: number;
  currency: string;
  date: string;
  community_name: string;
  message: string | null;
  status: string;
  payment_method: string;
  reference: string;
}

const receiptSchema = z.object({
  donation_id: z.number().int().positive(),
  donor_name: z.string(),
  amount: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+(?:\.\d+)?$/)])
    .transform(Number).refine(Number.isFinite),
  currency: z.string().regex(/^[a-zA-Z]{3}$/),
  date: z.string().min(1),
  tenant_name: z.string(),
  message: z.string().nullable(),
  status: z.string().min(1),
  payment_method: z.string().nullable(),
  payment_reference: z.string(),
});

export async function getDonationReceipt(id: number): Promise<DonationReceipt> {
  const response = await api.get<unknown>(`${API_V2}/donations/${id}/receipt`);
  const body = response && typeof response === 'object' && 'data' in response ? response.data : response;
  const parsed = receiptSchema.safeParse(body);
  if (!parsed.success || parsed.data.donation_id !== id) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'DONATION_RECEIPT_CONTRACT_DRIFT');
  }
  const receipt = parsed.data;
  return {
    id: receipt.donation_id, donor_name: receipt.donor_name, amount: receipt.amount,
    currency: receipt.currency, date: receipt.date, community_name: receipt.tenant_name,
    message: receipt.message, status: receipt.status, payment_method: receipt.payment_method ?? '',
    reference: receipt.payment_reference,
  };
}
