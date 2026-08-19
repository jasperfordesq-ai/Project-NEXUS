// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

const nullableString = z.string().nullable();

export const mobileEventTemplateConfigurationSchema = z.object({
  title: z.string(),
  description: z.string(),
  location: nullableString,
  max_attendees: z.number().int().positive().nullable(),
  timezone: z.string().min(1),
  all_day: z.boolean(),
  is_online: z.boolean(),
  allow_remote_attendance: z.boolean(),
}).passthrough();

export const mobileEventTemplateSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(['active', 'archived']),
  current_version: z.number().int().positive(),
  source_event: z.object({
    id: z.number().int().positive(),
    title: z.string(),
  }).passthrough(),
  version: z.object({
    number: z.number().int().positive(),
    configuration: mobileEventTemplateConfigurationSchema,
    snapshot: z.object({ immutable: z.literal(true) }).passthrough(),
    copied_fields: z.array(z.string()),
    skipped_fields: z.array(z.string()),
  }).passthrough(),
  usage: z.object({
    materialization_count: z.number().int().nonnegative(),
    audit_entry_count: z.number().int().nonnegative(),
  }).passthrough(),
  capabilities: z.object({
    materialize: z.boolean(),
    view_audit: z.boolean(),
  }).passthrough(),
}).passthrough();

export const mobileEventTemplateAuditSchema = z.object({
  id: z.number().int().positive(),
  action: z.enum(['captured', 'revised', 'archived', 'materialized']),
  template_version: z.number().int().positive(),
  source_event_id: z.number().int().positive(),
  materialized_event_id: z.number().int().positive().nullable(),
  evidence: z.record(z.string(), z.unknown()),
  created_at: nullableString,
  immutable: z.literal(true),
}).strict();

const templateListEnvelopeSchema = z.object({
  data: z.array(mobileEventTemplateSchema),
  meta: z.object({
    per_page: z.number().int().positive(),
    next_cursor: nullableString,
    has_more: z.boolean(),
  }).passthrough(),
}).passthrough();
const templateHistoryEnvelopeSchema = z.object({
  data: z.array(mobileEventTemplateAuditSchema),
  meta: z.object({
    per_page: z.number().int().positive(),
    next_cursor: nullableString,
    has_more: z.boolean(),
  }).passthrough(),
}).passthrough();

export const mobileEventTemplatePreviewSchema = z.object({
  kind: z.literal('materialization'),
  template_id: z.number().int().positive(),
  template_version: z.number().int().positive(),
  configuration: mobileEventTemplateConfigurationSchema,
  schedule: z.object({
    start_at: z.string().datetime({ offset: true }),
    end_at: z.string().datetime({ offset: true }).nullable(),
    timezone: z.string().min(1),
    all_day: z.boolean(),
  }).strict(),
  override_fields: z.array(z.string()),
  checklist: z.array(z.object({
    code: z.string(),
    passed: z.boolean(),
  }).strict()),
  will_create: z.object({
    publication_status: z.literal('draft'),
    publish: z.literal(false),
    register: z.literal(false),
    notify: z.literal(false),
    federate: z.literal(false),
  }).passthrough(),
}).passthrough();

export const mobileEventTemplateMaterializationSchema = z.object({
  created_event: z.object({
    id: z.number().int().positive(),
    title: z.string(),
    publication_status: z.literal('draft'),
    operational_status: z.literal('scheduled'),
  }).passthrough(),
  changed: z.boolean(),
  idempotent_replay: z.boolean(),
  workflow: z.object({
    fresh_draft: z.literal(true),
    published: z.literal(false),
    registrations_copied: z.literal(false),
    notifications_sent: z.literal(false),
    federated: z.literal(false),
  }).strict(),
}).passthrough();

const previewEnvelopeSchema = z.object({ data: mobileEventTemplatePreviewSchema }).passthrough();
const materializationEnvelopeSchema = z.object({ data: mobileEventTemplateMaterializationSchema }).passthrough();

export type MobileEventTemplate = z.infer<typeof mobileEventTemplateSchema>;
export type MobileEventTemplateAudit = z.infer<typeof mobileEventTemplateAuditSchema>;
export type MobileEventTemplatePreview = z.infer<typeof mobileEventTemplatePreviewSchema>;
export type MobileEventTemplateMaterialization = z.infer<typeof mobileEventTemplateMaterializationSchema>;

export interface MobileEventTemplateInput {
  template_version: number;
  start_time: string;
  end_time: string | null;
  overrides: {
    title?: string;
    timezone?: string;
  };
}

function stableEndpoint(endpoint: string): string {
  return endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}');
}

function parseContract<T>(endpoint: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  reportSentryMessage('Event templates contract drift', {
    level: 'warning',
    tags: { module: 'events', endpoint: stableEndpoint(endpoint) },
    extra: {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
      })),
    },
  });
  throw new ApiResponseError(422, 'EVENTS_CONTRACT_DRIFT');
}

export async function getEventTemplates(cursor?: string | null) {
  const endpoint = `${API_V2}/event-templates`;
  const params: Record<string, string> = { status: 'active', per_page: '20' };
  if (cursor) params.cursor = cursor;
  const response = await api.get<unknown>(endpoint, params);
  return parseContract(endpoint, templateListEnvelopeSchema, response);
}

export async function getEventTemplateHistory(templateId: number, cursor?: string | null) {
  const endpoint = `${API_V2}/event-templates/${templateId}/history`;
  const params: Record<string, string> = { per_page: '50' };
  if (cursor) params.cursor = cursor;
  const response = await api.get<unknown>(endpoint, params);
  return parseContract(endpoint, templateHistoryEnvelopeSchema, response);
}

export async function previewEventTemplate(
  templateId: number,
  input: MobileEventTemplateInput,
): Promise<MobileEventTemplatePreview> {
  const endpoint = `${API_V2}/event-templates/${templateId}/materialization-preview`;
  const response = await api.post<unknown>(endpoint, input);
  return parseContract(endpoint, previewEnvelopeSchema, response).data;
}

export async function materializeEventTemplate(
  templateId: number,
  input: MobileEventTemplateInput,
  idempotencyKey: string,
): Promise<MobileEventTemplateMaterialization> {
  const endpoint = `${API_V2}/event-templates/${templateId}/materializations`;
  const response = await api.post<unknown>(endpoint, input, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  return parseContract(endpoint, materializationEnvelopeSchema, response).data;
}
