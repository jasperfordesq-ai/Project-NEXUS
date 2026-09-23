// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { api, ApiResponseError } from './client';
import { getEventSafety } from './eventSafety';
import { saveEventSafetyDraft, publishEventSafety, archiveEventSafety, getEventSafetyReviews, recordEventSafetyReview, withdrawEventSafetyReview } from './eventSafetyManagement';
jest.mock('./client', () => ({ ...jest.requireActual('./client'), api: { get: jest.fn(), put: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
const safety = require('../../../contracts/events/v2/event-safety.json');
const headers = { 'X-Events-Contract': '2', 'X-Event-Safety-Contract': '1', 'Idempotency-Key': 'safety-key' };
const draft = { minimum_age: null, guardian_consent_required: false, minor_age_threshold: null, code_of_conduct_required: false, code_of_conduct_text: null, code_of_conduct_text_version: null };
const review = { user_id: 9, decision: 'deny' as const, reason_code: 'safety_review' as const, effective_from: '2026-09-23T12:00:00+00:00', effective_until: null, expected_version: null };
const item = { denial: { id: 4, decision: 'deny', reason_code: 'safety_review', status: 'active', decision_version: 1, effective_from: review.effective_from, effective_until: null, reviewed_at: review.effective_from },
  member: { id: 9, display_name: 'Synthetic member', avatar_url: null }, reviewer: { id: 3, display_name: 'Synthetic organiser' }, history: [] };
const page = { items: [item], total: 1, page: 1, per_page: 25 };
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(api.put).mockResolvedValue({ data: safety }); jest.mocked(api.post).mockResolvedValue({ data: safety });
  jest.mocked(api.get).mockResolvedValue({ data: page }); jest.mocked(api.delete).mockResolvedValue({ data: page });
});
it('saves the complete draft with its revision and stable idempotency key', async () => {
  await saveEventSafetyDraft(101, draft, null, 'safety-key');
  expect(api.put).toHaveBeenCalledWith('/api/v2/events/101/safety/requirements', { ...draft, expected_revision: null }, { headers });
});
it.each([['publish', publishEventSafety], ['archive', archiveEventSafety]] as const)('preserves both concurrency versions for %s', async (action, operation) => {
  await operation(101, 3, 2, 'safety-key');
  expect(api.post).toHaveBeenCalledWith(`/api/v2/events/101/safety/requirements/${action}`, { expected_revision: 3, expected_version: 2 }, { headers });
});
it.each([
  { minimum_age: -1 }, { minimum_age: 126 }, { minimum_age: 1.5 },
  { guardian_consent_required: true }, { minor_age_threshold: 16 },
  { guardian_consent_required: true, minor_age_threshold: 0 },
  { code_of_conduct_required: true }, { code_of_conduct_text: 'Unexpected hidden text' },
  { code_of_conduct_required: true, code_of_conduct_text: 'é'.repeat(50001), code_of_conduct_text_version: 'v1' },
  { code_of_conduct_required: true, code_of_conduct_text: 'Conduct', code_of_conduct_text_version: 'é'.repeat(33) },
  { private_notes: 'unsupported' },
])('rejects invalid requirements before sending %j', async change => {
  await expect(saveEventSafetyDraft(101, { ...draft, ...change }, null, 'safety-key')).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.put).not.toHaveBeenCalled();
});
it('preserves exact conduct wording and supports a valid guardian threshold', async () => {
  const body = { ...draft, guardian_consent_required: true, minor_age_threshold: 18, code_of_conduct_required: true, code_of_conduct_text: '  Exact text\nwith accents é.  ', code_of_conduct_text_version: 'v1' };
  await saveEventSafetyDraft(101, body, 4, 'safety-key');
  expect(api.put).toHaveBeenCalledWith(expect.anything(), { ...body, expected_revision: 4 }, expect.anything());
});
it('rejects a valid Safety response belonging to a different event', async () => {
  jest.mocked(api.put).mockResolvedValue({ data: { ...safety, event_id: 102 } });
  await expect(saveEventSafetyDraft(101, draft, null, 'safety-key')).rejects.toMatchObject({ code: 'EVENT_SAFETY_CONTRACT_DRIFT' });
  jest.mocked(api.get).mockResolvedValue({ data: { ...safety, event_id: 102 } });
  await expect(getEventSafety(101)).rejects.toMatchObject({ code: 'EVENT_SAFETY_CONTRACT_DRIFT' });
});
it('accepts the server byte limit after trimming version padding without changing the request', async () => {
  const body = { ...draft, code_of_conduct_required: true, code_of_conduct_text: 'Exact wording', code_of_conduct_text_version: ` ${'é'.repeat(32)} ` };
  await saveEventSafetyDraft(101, body, 4, 'safety-key');
  expect(api.put).toHaveBeenCalledWith(expect.anything(), { ...body, expected_revision: 4 }, expect.anything());
});
it('negotiates contracts and requests the exact review page, accepting a server page-size cap', async () => {
  jest.mocked(api.get).mockResolvedValue({ data: { ...page, page: 2, per_page: 10, total: 11 } });
  expect((await getEventSafetyReviews(101, 2)).data.per_page).toBe(10);
  expect(api.get).toHaveBeenCalledWith('/api/v2/events/101/safety/reviews', { page: '2', per_page: '25' }, { headers: { 'X-Events-Contract': '2', 'X-Event-Safety-Contract': '1' } });
});
it.each([{ page: 2 }, { per_page: 26 }, { total: 0 }, { items: [item, item] }, { guardian_email: 'hidden@example.test' }, { items: [{ ...item, private_notes: 'not supported' }] }])('rejects misleading or overexposed review data %j', async change => {
  jest.mocked(api.get).mockResolvedValue({ data: { ...page, ...change } });
  await expect(getEventSafetyReviews(101)).rejects.toMatchObject({ code: 'EVENT_SAFETY_CONTRACT_DRIFT' });
});
it('records a reviewed decision and withdraws it with the expected version in the DELETE body', async () => {
  jest.mocked(api.post).mockResolvedValue({ data: page });
  await recordEventSafetyReview(101, review, 'safety-key');
  expect(api.post).toHaveBeenCalledWith('/api/v2/events/101/safety/reviews', review, { headers });
  await withdrawEventSafetyReview(101, 4, 1, 'safety-key');
  expect(api.delete).toHaveBeenCalledWith('/api/v2/events/101/safety/reviews/4', { headers, body: { expected_version: 1 } });
});
it.each([{ user_id: 0 }, { decision: 'allow' }, { reason_code: 'free_text' }, { effective_from: '2026-09-23T12:00:00' }, { effective_until: review.effective_from }, { expected_version: -1 }])('rejects invalid review requests %j', async change => {
  await expect(recordEventSafetyReview(101, { ...review, ...change } as never, 'safety-key')).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.post).not.toHaveBeenCalled();
});
it('preserves server conflicts for explicit review rather than treating them as success', async () => {
  const conflict = new ApiResponseError(409, 'Conflict', undefined, 'EVENT_SAFETY_CONFLICT');
  jest.mocked(api.put).mockRejectedValue(conflict);
  await expect(saveEventSafetyDraft(101, draft, 2, 'safety-key')).rejects.toBe(conflict);
});
it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])('does not send for invalid event %s', async eventId => {
  await expect(getEventSafetyReviews(eventId)).rejects.toBeInstanceOf(ApiResponseError); expect(api.get).not.toHaveBeenCalled();
});
it('does not send empty operation keys or nonpositive transition versions', async () => {
  await expect(publishEventSafety(101, 1, 1, '')).rejects.toBeInstanceOf(ApiResponseError);
  await expect(archiveEventSafety(101, 0, 1, 'safety-key')).rejects.toBeInstanceOf(ApiResponseError);
  expect(api.post).not.toHaveBeenCalled();
});
