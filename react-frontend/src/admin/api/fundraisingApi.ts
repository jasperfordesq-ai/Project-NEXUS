// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api';
import type { Handover, HandoverListData, HandoverMethod, HistoryItem } from '@/lib/fundraisingTypes';

export interface RecordHandoverBody {
  amount: number;
  handed_over_on: string;
  method: HandoverMethod;
  reference: string;
  note?: string;
}

/** Fundraising history and hand-overs for community admins. Kept out of adminApi.ts on purpose. */
export const adminFundraising = {
  history: (givingDayId: number) =>
    api.get<{ items: HistoryItem[] }>(`/v2/admin/volunteering/giving-days/${givingDayId}/history`),
  handovers: (givingDayId: number) =>
    api.get<HandoverListData>(`/v2/admin/volunteering/giving-days/${givingDayId}/handovers`),
  recordHandover: (givingDayId: number, body: RecordHandoverBody) =>
    api.post<Handover>(`/v2/admin/volunteering/giving-days/${givingDayId}/handovers`, body),
  cancelHandover: (handoverId: number, reason: string) =>
    api.post<Handover>(`/v2/admin/volunteering/handovers/${handoverId}/cancel`, { reason }),
};
