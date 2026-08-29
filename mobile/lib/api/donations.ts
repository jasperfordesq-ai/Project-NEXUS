// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
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

export async function getDonationReceipt(id: number): Promise<DonationReceipt> {
  const response = await api.get<DonationReceipt | { data: DonationReceipt }>(`${API_V2}/donations/${id}/receipt`);
  return response && typeof response === 'object' && 'data' in response ? response.data : response;
}
