// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import i18n from 'i18next';
import { z } from 'zod';
import { api, ApiResponseError } from './client';
import { API_V2 } from '@/lib/constants';

const count = z.number().int().nonnegative();
export const deliveryStates = ['pending', 'retry', 'processing', 'delivered', 'dead_letter'] as const;
const timestamp = z.string().nullable();
const summarySchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  federation_version: z.number().int().positive(),
  visibility: z.enum(['none', 'listed', 'joinable']),
  configured_partners: count,
  recipient_partners: count,
  health: z.enum(['healthy', 'delivering', 'degraded', 'withdrawn', 'not_configured']),
  counts: z.object({ pending: count, retry: count, processing: count, delivered: count, dead_letter: count }),
  partners: z.array(z.object({
    partner_id: count,
    partner_name: z.string().nullable(),
    partner_status: z.string(),
    events_enabled: z.boolean(),
    action: z.enum(['upsert', 'tombstone']).nullable(),
    delivery_status: z.enum(deliveryStates).nullable(),
    attempts: count,
    max_attempts: z.number().int().positive(),
    available_at: timestamp,
    next_attempt_at: timestamp,
    last_attempt_at: timestamp,
    delivered_at: timestamp,
    dead_lettered_at: timestamp,
    error_code: z.string().nullable(),
  })),
  generated_at: timestamp,
});
export type EventFederationSummary = z.infer<typeof summarySchema>;

export async function getEventFederationStatus(eventId: number): Promise<{ data: EventFederationSummary }> {
  if (!Number.isSafeInteger(eventId) || eventId <= 0) throw new ApiResponseError(422, i18n.t('events:detail.invalidId'));
  const response = await api.get<unknown>(`${API_V2}/events/${eventId}/federation-status`);
  const parsed = z.object({ data: summarySchema }).safeParse(response);
  if (!parsed.success || parsed.data.data.event_id !== eventId) {
    throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_FEDERATION_CONTRACT_DRIFT');
  }
  return parsed.data;
}
