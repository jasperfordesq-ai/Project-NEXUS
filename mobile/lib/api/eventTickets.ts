// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

const count = z.number().int().nonnegative();
const credits = z.string().regex(/^\d+\.\d{2}$/);
const instant = z.string().datetime({ offset: true }).nullable();

const refundPolicySchema = z.object({
  cutoff_at: instant,
  organizer_cancel_refundable: z.boolean(),
  execution_status: z.string().min(1),
}).strict();

const availabilitySchema = z.object({
  eligibility: z.object({
    eligible: z.boolean(),
    reasons: z.array(z.string().min(1)),
  }).strict(),
  allocation_remaining: count,
  member_remaining: count,
  sales_window_open: z.boolean(),
  materialization_supported: z.boolean(),
  gateway_status: z.string().min(1),
  attendance_reward_included: z.literal(false),
  refund_policy: refundPolicySchema,
}).strict();

export const mobileEventTicketTypeSchema = z.object({
  id: z.number().int().positive(),
  version: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().nullable(),
  kind: z.enum(['free', 'time_credit']),
  unit_price_credits: credits,
  allocation_limit: count,
  sales_opens_at: instant,
  sales_closes_at: instant,
  per_member_limit: count,
  refund_cutoff_at: instant,
  organizer_cancel_refundable: z.boolean(),
  status: z.enum(['draft', 'active', 'paused', 'archived']),
  availability: availabilitySchema,
  eligibility_policy: z.object({
    approved_member_required: z.boolean(),
    minimum_account_age_days: count,
    required_group_ids: z.array(z.number().int().positive()),
  }).strict().nullable(),
}).strict();

export const mobileEventTicketEntitlementSchema = z.object({
  id: z.number().int().positive(),
  ticket_type_id: z.number().int().positive(),
  units: z.number().int().positive(),
  kind: z.enum(['free', 'time_credit']),
  unit_price_credits: credits,
  total_price_credits: credits,
  status: z.enum(['confirmed', 'cancelled']),
  version: z.number().int().positive(),
  confirmed_at: instant,
  cancelled_at: instant,
}).strict();

export const mobileEventTicketCatalogueSchema = z.object({
  contract_version: z.literal(1),
  event_id: z.number().int().positive(),
  currency: z.literal('time_credit'),
  payment_gateway: z.object({
    free_supported: z.literal(true),
    time_credit_supported: z.literal(false),
    money_supported: z.literal(false),
  }).strict(),
  permissions: z.object({
    manage: z.boolean(),
    reconcile: z.boolean(),
    allocate_self: z.boolean(),
  }).strict(),
  ticket_types: z.array(mobileEventTicketTypeSchema),
  own_entitlements: z.array(mobileEventTicketEntitlementSchema),
}).strict();

const responseMetaSchema = z.object({ base_url: z.string() }).passthrough();
const catalogueEnvelopeSchema = z.object({
  data: mobileEventTicketCatalogueSchema,
  meta: responseMetaSchema,
}).strict();
const entitlementMutationSchema = z.object({
  entitlement: mobileEventTicketEntitlementSchema,
  confirmed_units_after: count,
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
}).strict();
const mutationEnvelopeSchema = z.object({
  data: entitlementMutationSchema,
  meta: responseMetaSchema,
}).strict();

export type MobileEventTicketCatalogue = z.infer<typeof mobileEventTicketCatalogueSchema>;
export type MobileEventTicketType = z.infer<typeof mobileEventTicketTypeSchema>;
export type MobileEventTicketEntitlement = z.infer<typeof mobileEventTicketEntitlementSchema>;
export type MobileEventTicketMutation = z.infer<typeof entitlementMutationSchema>;

function stableEndpoint(endpoint: string): string {
  return endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}');
}

function parseContract<T>(endpoint: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Event tickets contract drift', {
    level: 'warning',
    tags: { module: 'events', endpoint: stableEndpoint(endpoint) },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_TICKETS_CONTRACT_DRIFT');
}

function idempotency(key: string) {
  return { headers: { 'Idempotency-Key': key } };
}

export async function getEventTickets(eventId: number): Promise<MobileEventTicketCatalogue> {
  const endpoint = `${API_V2}/events/${eventId}/tickets`;
  const response = await api.get<unknown>(endpoint);
  return parseContract(endpoint, catalogueEnvelopeSchema, response).data;
}

export async function allocateFreeEventTicket(
  eventId: number,
  ticketTypeId: number,
  units: number,
  idempotencyKey: string,
): Promise<MobileEventTicketMutation> {
  const endpoint = `${API_V2}/events/${eventId}/tickets/${ticketTypeId}/allocate`;
  const response = await api.post<unknown>(endpoint, { units }, idempotency(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data;
}

export async function cancelEventTicket(
  eventId: number,
  entitlementId: number,
  expectedVersion: number,
  reason: string,
  idempotencyKey: string,
): Promise<MobileEventTicketMutation> {
  const endpoint = `${API_V2}/events/${eventId}/ticket-entitlements/${entitlementId}/cancel`;
  const response = await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
    reason,
  }, idempotency(idempotencyKey));
  return parseContract(endpoint, mutationEnvelopeSchema, response).data;
}
