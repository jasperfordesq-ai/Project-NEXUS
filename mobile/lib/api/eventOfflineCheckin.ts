// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import i18n from 'i18next';
import { reportSentryMessage } from '@/lib/observability/report';
import { z } from 'zod';
import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export const EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION = 1 as const;
export type OfflineAttendanceOperation = 'check_in' | 'check_out' | 'no_show' | 'undo';

const nullableString = z.string().nullable();
const headers = {
  'X-Events-Contract': '2',
  'X-Event-Checkin-Contract': String(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
};

const deviceSchema = z.object({
  id: z.number().int().positive(),
  public_id: z.string().uuid(),
  label: z.string().min(1),
  registered_by_user_id: z.number().int().positive(),
  version: z.number().int().positive(),
  status: z.enum(['active', 'revoked', 'expired']),
  registered_at: z.string(),
  expires_at: z.string(),
  rotated_at: nullableString,
  revoked_at: nullableString,
  revocation_reason: nullableString,
}).strict();

const workspaceSchema = z.object({
  contract_version: z.literal(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  occurrence_key: z.string().min(1),
  manifest_version: z.number().int().nonnegative(),
  limits: z.object({
    replay_window_minutes: z.number().int().positive(),
    batch_max_items: z.number().int().positive().max(500),
  }).strict(),
  devices: z.array(deviceSchema),
  recent_batches: z.array(z.object({
    id: z.number().int().positive(),
    device_id: z.number().int().positive(),
    client_batch_id: z.string(),
    manifest_version: z.number().int().nonnegative(),
    item_count: z.number().int().positive(),
    status: z.enum(['pending', 'processing', 'completed', 'dead_letter']),
    counts: z.object({
      synced: z.number().int().nonnegative(),
      conflict: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
      pending: z.number().int().nonnegative(),
    }).strict(),
    created_at: z.string(),
    completed_at: nullableString,
    dead_lettered_at: nullableString,
    terminal_code: nullableString,
  }).strict()).max(50),
  open_conflicts: z.number().int().nonnegative(),
  permissions: z.object({
    manage_devices: z.literal(true),
    download_manifest: z.literal(true),
    sync_offline_queue: z.literal(true),
    resolve_conflicts: z.literal(true),
    manual_fallback_required: z.literal(true),
  }).strict(),
  privacy: z.object({
    device_secrets_redacted: z.literal(true),
    credential_secrets_redacted: z.literal(true),
    contact_fields_redacted: z.literal(true),
    wallet_effects_supported: z.literal(false),
  }).strict(),
}).strict();

const manifestSchema = z.object({
  schema_version: z.literal(2),
  tenant_id: z.number().int().positive(),
  event_id: z.number().int().positive(),
  occurrence_key: z.string().min(1),
  manifest_version: z.number().int().nonnegative(),
  device: z.object({ id: z.number().int().positive(), version: z.number().int().positive() }).strict(),
  generated_at: z.string(),
  expires_at: z.string(),
  credential_verification: z.object({
    format: z.literal('nqx2'),
    algorithm: z.literal('Ed25519'),
    keys: z.array(z.object({
      kid: z.string().regex(/^[0-9a-f]{16}$/),
      alg: z.literal('Ed25519'),
      public_key: z.string().min(40),
    }).strict()).min(1),
  }).strict(),
  registrations: z.array(z.object({
    registration_id: z.number().int().positive(),
    user_id: z.number().int().positive(),
    display_name: z.string(),
    credential_version: z.number().int().positive(),
    credential_fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
    credential_verifier: z.string().regex(/^[0-9a-f]{64}$/),
    attendance_status: z.string().nullable(),
    attendance_version: z.number().int().nonnegative(),
  }).strict()),
  privacy: z.object({
    credential_contains_pii: z.literal(false),
    encrypted_at_rest_required: z.literal(true),
  }).strict(),
}).strict();

const batchSchema = z.object({
  contract_version: z.literal(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  batch: z.object({
    id: z.number().int().positive(),
    client_batch_id: z.string().min(1),
    status: z.enum(['pending', 'processing', 'completed', 'dead_letter']),
    item_count: z.number().int().positive(),
    accepted_count: z.number().int().nonnegative(),
    conflict_count: z.number().int().nonnegative(),
    rejected_count: z.number().int().nonnegative(),
    created_at: nullableString,
    completed_at: nullableString,
  }).strict(),
  items: z.array(z.object({
    id: z.number().int().positive(),
    position: z.number().int().positive(),
    client_nonce: z.string().min(8),
    operation: z.enum(['check_in', 'check_out', 'no_show', 'undo']),
    observed_at: z.string(),
    expected_attendance_version: z.number().int().nonnegative(),
    state: z.enum(['pending', 'synced', 'conflict', 'rejected']),
    decision_version: z.number().int().positive().nullable(),
    code: nullableString,
    reason: nullableString,
    decided_at: nullableString,
  }).strict()),
  privacy: z.object({
    credential_redacted: z.literal(true),
    attendee_identity_redacted: z.literal(true),
  }).strict(),
}).strict();

const conflictListSchema = z.object({
  contract_version: z.literal(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  items: z.array(z.object({
    item_id: z.number().int().positive(),
    batch_id: z.number().int().positive(),
    client_batch_id: z.string(),
    member: z.object({ id: z.number().int().positive(), display_name: z.string() }).strict(),
    operation: z.enum(['check_in', 'check_out', 'no_show', 'undo']),
    observed_at: z.string(),
    submitted_reason: nullableString,
    expected_attendance_version: z.number().int().nonnegative(),
    current_attendance: z.object({ state: z.string(), version: z.number().int().nonnegative() }).strict(),
    conflict: z.object({ decision_version: z.number().int().positive(), code: z.string(), decided_at: z.string() }).strict(),
    device: z.object({ id: z.number().int().positive(), label: nullableString }).strict(),
  }).strict()),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  per_page: z.number().int().positive(),
  privacy: z.object({
    credential_redacted: z.literal(true),
    contact_fields_redacted: z.literal(true),
    free_text_member_profile_redacted: z.literal(true),
  }).strict(),
}).strict();

const deviceMutationSchema = z.object({
  contract_version: z.literal(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  device: z.object({
    id: z.number().int().positive(),
    public_id: z.string().uuid().optional(),
    label: z.string().optional(),
    version: z.number().int().positive(),
    status: z.enum(['active', 'revoked', 'expired']),
    expires_at: z.string().optional(),
    revoked_at: nullableString.optional(),
    secret: nullableString.optional(),
    secret_one_shot: z.boolean().optional(),
    purge_local_data_required: z.boolean().optional(),
  }).strict(),
  manifest_version: z.number().int().nonnegative().optional(),
}).strict();

const credentialMutationSchema = z.object({
  contract_version: z.literal(EVENT_OFFLINE_CHECKIN_CONTRACT_VERSION),
  event_id: z.number().int().positive(),
  credential: z.object({
    id: z.number().int().positive(),
    registration_id: z.number().int().positive().optional(),
    version: z.number().int().positive(),
    status: z.enum(['active', 'rotated', 'revoked', 'expired']),
    expires_at: z.string().optional(),
    revoked_at: nullableString.optional(),
    token: nullableString.optional(),
    token_one_shot: z.boolean().optional(),
    contains_pii: z.literal(false).optional(),
  }).strict().nullable(),
  manifest_version: z.number().int().nonnegative().optional(),
}).strict();

const envelope = <T extends z.ZodTypeAny>(schema: T) => z.object({ data: schema }).passthrough();

export type MobileOfflineWorkspace = z.infer<typeof workspaceSchema>;
export type MobileOfflineManifest = z.infer<typeof manifestSchema>;
export type MobileOfflineBatch = z.infer<typeof batchSchema>;
export type MobileOfflineConflicts = z.infer<typeof conflictListSchema>;
export type MobileEventCheckinCredentialResponse = z.infer<typeof credentialMutationSchema>;

function parse<T>(endpoint: string, schema: z.ZodType<T>, value: unknown): T {
  const parsed = envelope(schema).safeParse(value);
  if (parsed.success) return parsed.data.data;
  reportSentryMessage('Event offline check-in contract drift', {
    level: 'warning',
    tags: { module: 'events', contract_version: '1' },
    extra: {
      endpoint: endpoint.replace(/\/\d+(?=\/|$)/g, '/{id}'),
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code })),
    },
  });
  throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_CHECKIN_CONTRACT_DRIFT');
}

function options(idempotencyKey?: string) {
  return { headers: { ...headers, ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) } };
}

export async function getOfflineCheckinWorkspace(eventId: number): Promise<MobileOfflineWorkspace> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin`;
  return parse(endpoint, workspaceSchema, await api.get<unknown>(endpoint, undefined, options()));
}

export async function getMyEventCheckinCredential(
  eventId: number,
): Promise<MobileEventCheckinCredentialResponse> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/credentials/me`;
  return parse(endpoint, credentialMutationSchema, await api.get<unknown>(endpoint, undefined, options()));
}

export async function issueMyEventCheckinCredential(
  eventId: number,
  idempotencyKey: string,
): Promise<MobileEventCheckinCredentialResponse> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/credentials`;
  return parse(endpoint, credentialMutationSchema, await api.post<unknown>(
    endpoint,
    {},
    options(idempotencyKey),
  ));
}

export async function rotateMyEventCheckinCredential(
  eventId: number,
  credentialId: number,
  expectedVersion: number,
  idempotencyKey: string,
): Promise<MobileEventCheckinCredentialResponse> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/credentials/${credentialId}/rotate`;
  return parse(endpoint, credentialMutationSchema, await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
  }, options(idempotencyKey)));
}

export async function revokeMyEventCheckinCredential(
  eventId: number,
  credentialId: number,
  expectedVersion: number,
  reason: string,
): Promise<MobileEventCheckinCredentialResponse> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/credentials/${credentialId}/revoke`;
  return parse(endpoint, credentialMutationSchema, await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
    reason,
  }, options()));
}

export async function registerOfflineCheckinDevice(
  eventId: number,
  label: string,
  idempotencyKey: string,
) {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/devices`;
  return parse(endpoint, deviceMutationSchema, await api.post<unknown>(
    endpoint,
    { label },
    options(idempotencyKey),
  ));
}

export async function revokeOfflineCheckinDevice(
  eventId: number,
  deviceId: number,
  expectedVersion: number,
  reason: string,
  idempotencyKey: string,
) {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/devices/${deviceId}/revoke`;
  return parse(endpoint, deviceMutationSchema, await api.post<unknown>(endpoint, {
    expected_version: expectedVersion,
    reason,
  }, options(idempotencyKey)));
}

export async function downloadOfflineCheckinManifest(
  eventId: number,
  deviceSecret: string,
): Promise<MobileOfflineManifest> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/manifest`;
  return parse(endpoint, manifestSchema, await api.post<unknown>(
    endpoint,
    { device_secret: deviceSecret },
    options(),
  ));
}

export async function syncOfflineCheckinBatch(eventId: number, input: {
  deviceSecret: string;
  clientBatchId: string;
  manifestVersion: number;
  items: {
    client_nonce: string;
    operation: OfflineAttendanceOperation;
    observed_at: string;
    expected_attendance_version: number;
    credential_fingerprint: string;
    credential_hash_reference: string;
    reason?: string;
  }[];
}): Promise<MobileOfflineBatch> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/sync`;
  return parse(endpoint, batchSchema, await api.post<unknown>(endpoint, {
    device_secret: input.deviceSecret,
    client_batch_id: input.clientBatchId,
    manifest_version: input.manifestVersion,
    items: input.items,
  }, options()));
}

export async function getOfflineCheckinConflicts(eventId: number): Promise<MobileOfflineConflicts> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/conflicts`;
  return parse(endpoint, conflictListSchema, await api.get<unknown>(endpoint, undefined, options()));
}

export async function resolveOfflineCheckinConflict(eventId: number, itemId: number, input: {
  expectedDecisionVersion: number;
  expectedAttendanceVersion: number;
  disposition: 'apply' | 'reject';
  reason: string;
  idempotencyKey: string;
}): Promise<MobileOfflineConflicts> {
  const endpoint = `${API_V2}/events/${eventId}/offline-checkin/conflicts/${itemId}`;
  return parse(endpoint, conflictListSchema, await api.post<unknown>(endpoint, {
    expected_decision_version: input.expectedDecisionVersion,
    expected_attendance_version: input.expectedAttendanceVersion,
    disposition: input.disposition,
    reason: input.reason,
  }, options(input.idempotencyKey)));
}
