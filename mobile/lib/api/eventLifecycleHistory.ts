// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

const publicationState = z.enum(['draft', 'pending_review', 'published', 'archived']);
const operationalState = z.enum(['scheduled', 'postponed', 'cancelled', 'completed']);

export const mobileEventLifecycleHistoryEntrySchema = z.object({
  id: z.number().int().positive(),
  lifecycle_version: z.number().int().positive(),
  publication: z.object({ from: publicationState, to: publicationState }).strict(),
  operational: z.object({ from: operationalState, to: operationalState }).strict(),
  reason: z.string().nullable(),
  actor: z.object({
    id: z.number().int().positive(),
    display_name: z.string().nullable(),
  }).strict(),
  evidence: z.object({
    axes_changed: z.array(z.enum(['publication', 'operational'])),
    cascade: z.object({
      reminders_cancelled: z.number().int().nonnegative().optional(),
      waitlist_cancelled: z.number().int().nonnegative().optional(),
      registrations_cancelled: z.number().int().nonnegative().optional(),
    }).strict(),
    series: z.object({
      root_event_id: z.number().int().positive(),
      member_type: z.enum(['template', 'occurrence']),
    }).strict().nullable(),
    notifications_suppressed: z.boolean(),
  }).strict(),
  created_at: z.string().datetime({ offset: true }).nullable(),
  immutable: z.literal(true),
}).strict();

const envelopeSchema = z.object({
  data: z.array(mobileEventLifecycleHistoryEntrySchema).max(20),
  meta: z.object({
    per_page: z.literal(20),
    next_cursor: z.string().nullable(),
    has_more: z.boolean(),
  }).passthrough(),
}).strict();

export type MobileEventLifecycleHistoryEntry = z.infer<typeof mobileEventLifecycleHistoryEntrySchema>;
export type MobileEventLifecycleHistoryResponse = z.infer<typeof envelopeSchema>;

export async function getEventLifecycleHistory(
  eventId: number,
  cursor?: string,
): Promise<MobileEventLifecycleHistoryResponse> {
  const endpoint = `${API_V2}/events/${eventId}/lifecycle-history`;
  const params: Record<string, string> = { per_page: '20' };
  if (cursor) params.cursor = cursor;
  const response = await api.get<unknown>(endpoint, params);
  const parsed = envelopeSchema.safeParse(response);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Events lifecycle history contract drift', {
    level: 'warning',
    tags: {
      module: 'events',
      contract_version: '1',
      endpoint: `${API_V2}/events/{id}/lifecycle-history`,
    },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, 'EVENTS_CONTRACT_DRIFT');
}
