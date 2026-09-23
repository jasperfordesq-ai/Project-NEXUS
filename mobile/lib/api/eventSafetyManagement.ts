// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { z } from 'zod';
import i18n from 'i18next';
import { api, ApiResponseError } from './client';
import { API_V2 } from '@/lib/constants';
import { eventSafetyRequestOptions, parseEventSafety } from './eventSafety';

const id = z.number().int().positive().safe();
const revision = z.number().int().nonnegative().safe().nullable();
const date = z.string().datetime({ offset: true });
const age = z.number().int().min(0).max(125).nullable();
const byteLimited = (maximum: number) => z.string().refine(value => new TextEncoder().encode(value).length <= maximum);
export const safetyRequirementDraftSchema = z.object({
  minimum_age: age, guardian_consent_required: z.boolean(), minor_age_threshold: age,
  code_of_conduct_required: z.boolean(), code_of_conduct_text: byteLimited(100000).nullable(),
  // PHP trims ASCII whitespace and NUL before checking the version byte limit.
  // Preserve the request value so persisted retries send the original payload.
  code_of_conduct_text_version: z.string().refine(value => new TextEncoder().encode(value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '')).length <= 64).nullable(),
}).strict().superRefine((draft, context) => {
  if (draft.guardian_consent_required ? !draft.minor_age_threshold : draft.minor_age_threshold !== null)
    context.addIssue({ code: 'custom', path: ['minor_age_threshold'], message: 'Invalid guardian threshold' });
  if (draft.code_of_conduct_required
    ? !draft.code_of_conduct_text?.trim() || !draft.code_of_conduct_text_version?.trim()
    : draft.code_of_conduct_text !== null || draft.code_of_conduct_text_version !== null)
    context.addIssue({ code: 'custom', path: ['code_of_conduct_text'], message: 'Invalid conduct requirements' });
});
export type SafetyRequirementDraft = z.infer<typeof safetyRequirementDraftSchema>;
export const safetyReviewDecisions = ['deny', 'remove'] as const;
export const safetyReviewReasons = ['safeguarding_policy', 'minimum_age', 'guardian_consent', 'code_of_conduct', 'conduct_violation', 'safety_review', 'user_block'] as const;
const decision = z.enum(safetyReviewDecisions);
const reason = z.enum(safetyReviewReasons);
const status = z.enum(['active', 'withdrawn', 'expired']);
export const safetyReviewInputSchema = z.object({
  user_id: id, decision, reason_code: reason, effective_from: date, effective_until: date.nullable(), expected_version: revision,
}).strict().refine(value => value.effective_until === null || Date.parse(value.effective_until) > Date.parse(value.effective_from), { path: ['effective_until'] });
export type SafetyReviewInput = z.infer<typeof safetyReviewInputSchema>;
const actor = z.object({ id, display_name: z.string() }).strict();
const review = z.object({
  denial: z.object({ id, decision, reason_code: reason, status, decision_version: id,
    effective_from: date, effective_until: date.nullable(), reviewed_at: date }).strict(),
  member: z.object({ id, display_name: z.string(), avatar_url: z.string().nullable() }).strict(),
  reviewer: actor,
  history: z.array(z.object({ decision_version: id, decision, reason_code: reason, status,
    action: z.enum(['recorded', 'withdrawn', 'expired']), effective_from: date,
    effective_until: date.nullable(), reviewed_at: date, reviewer: actor }).strict()),
}).strict();
export const safetyReviewsSchema = z.object({ items: z.array(review).max(100), total: z.number().int().nonnegative().safe(), page: id, per_page: id.max(100) }).strict();
export type SafetyReviews = z.infer<typeof safetyReviewsSchema>;
function invalid(): never { throw new ApiResponseError(422, i18n.t('common:errors.contractDrift'), undefined, 'EVENT_SAFETY_CONTRACT_DRIFT'); }
function identity(eventId: number, key?: string) {
  if (!id.safeParse(eventId).success || (key !== undefined && !/^[A-Za-z0-9._:-]{1,191}$/.test(key))) invalid();
}
function input<T>(schema: z.ZodType<T>, value: unknown): T { const parsed = schema.safeParse(value); if (!parsed.success) invalid(); return parsed.data; }
function reviews(response: unknown, page: number, perPage: number): { data: SafetyReviews } {
  const { data } = input(z.object({ data: safetyReviewsSchema }), response);
  // The server may cap page size through tenant-independent configuration.
  if (data.page !== page || data.per_page > perPage || data.items.length > data.per_page
    || data.items.length > data.total || new Set(data.items.map(item => item.denial.id)).size !== data.items.length) invalid();
  return { data };
}
export async function saveEventSafetyDraft(eventId: number, draft: SafetyRequirementDraft, expectedRevision: number | null, key: string) {
  identity(eventId, key);
  const payload = { ...input(safetyRequirementDraftSchema, draft), expected_revision: input(revision, expectedRevision) };
  const endpoint = `${API_V2}/events/${eventId}/safety/requirements`;
  return parseEventSafety(endpoint, await api.put<unknown>(endpoint, payload, eventSafetyRequestOptions(key)), eventId);
}
export async function publishEventSafety(eventId: number, expectedRevision: number, expectedVersion: number, key: string) {
  identity(eventId, key);
  const payload = { expected_revision: input(id, expectedRevision), expected_version: input(id, expectedVersion) };
  const endpoint = `${API_V2}/events/${eventId}/safety/requirements/publish`;
  return parseEventSafety(endpoint, await api.post<unknown>(endpoint, payload, eventSafetyRequestOptions(key)), eventId);
}
export async function archiveEventSafety(eventId: number, expectedRevision: number, expectedVersion: number, key: string) {
  identity(eventId, key);
  const payload = { expected_revision: input(id, expectedRevision), expected_version: input(id, expectedVersion) };
  const endpoint = `${API_V2}/events/${eventId}/safety/requirements/archive`;
  return parseEventSafety(endpoint, await api.post<unknown>(endpoint, payload, eventSafetyRequestOptions(key)), eventId);
}
export async function getEventSafetyReviews(eventId: number, page = 1, perPage = 25) {
  identity(eventId); input(id, page); input(id.max(100), perPage);
  const response = await api.get<unknown>(`${API_V2}/events/${eventId}/safety/reviews`, { page: String(page), per_page: String(perPage) }, eventSafetyRequestOptions());
  return reviews(response, page, perPage);
}
/** Mutation responses are the current first review page, not an immutable receipt. */
export async function recordEventSafetyReview(eventId: number, payload: SafetyReviewInput, key: string) {
  identity(eventId, key);
  const response = await api.post<unknown>(`${API_V2}/events/${eventId}/safety/reviews`, input(safetyReviewInputSchema, payload), eventSafetyRequestOptions(key));
  return reviews(response, 1, 25);
}
export async function withdrawEventSafetyReview(eventId: number, denialId: number, expectedVersion: number, key: string) {
  identity(eventId, key); input(id, denialId); input(id, expectedVersion);
  const response = await api.delete<unknown>(`${API_V2}/events/${eventId}/safety/reviews/${denialId}`, {
    ...eventSafetyRequestOptions(key), body: { expected_version: expectedVersion },
  });
  return reviews(response, 1, 25);
}
