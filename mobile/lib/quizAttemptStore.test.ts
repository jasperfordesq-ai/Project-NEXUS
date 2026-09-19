// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { storage } from '@/lib/storage';
import { acknowledgeQuizAttempt, loadQuizAttempt, prepareQuizAttempt, rejectQuizAttempt, PendingQuizAttemptConflict, QuizAttemptTooLargeError } from './quizAttemptStore';

jest.mock('@/lib/storage', () => ({ storage: { get: jest.fn(), set: jest.fn(), getJson: jest.fn(), setJson: jest.fn(), remove: jest.fn() } }));
const values = new Map<string, string>();
const scope = { tenantId: 2, userId: 7, quizId: 44 };
const result = { attempt_id: 19, score_percent: 80, passed: true, needs_review: false };

it('rejects oversized answers before any write and preserves the previous receipt', async () => {
  const prior = await prepareQuizAttempt(scope, { '1': 'A' });
  await acknowledgeQuizAttempt(scope, prior.key, result);
  jest.mocked(storage.set).mockClear();
  jest.mocked(storage.setJson).mockClear();
  await expect(prepareQuizAttempt(scope, { '1': 'x'.repeat(11200) })).rejects.toBeInstanceOf(QuizAttemptTooLargeError);
  expect(storage.set).not.toHaveBeenCalled();
  expect(storage.setJson).not.toHaveBeenCalled();
  await expect(loadQuizAttempt(scope)).resolves.toMatchObject({ key: prior.key, status: 'acknowledged', result });
});

it('can acknowledge a large Unicode answer without exhausting receipt space', async () => {
  const answers = { '1': '😀'.repeat(10000) };
  const pending = await prepareQuizAttempt(scope, answers);
  await acknowledgeQuizAttempt(scope, pending.key, { ...result, attempt_id: Number.MAX_SAFE_INTEGER, score_percent: 99.123456789 });
  await expect(loadQuizAttempt(scope)).resolves.toMatchObject({ status: 'acknowledged', answers });
});

beforeEach(() => {
  jest.resetAllMocks();
  values.clear();
  jest.mocked(storage.get).mockImplementation(async key => values.get(key) ?? null);
  jest.mocked(storage.set).mockImplementation(async (key, value) => { values.set(key, value); });
  jest.mocked(storage.getJson).mockImplementation(async key => {
    const raw = values.get(key); return raw === undefined ? null : JSON.parse(raw);
  });
  jest.mocked(storage.setJson).mockImplementation(async (key, value) => { values.set(key, JSON.stringify(value)); });
  jest.mocked(storage.remove).mockImplementation(async key => { values.delete(key); });
});

it('restores the durable identity and answers and isolates owner, community and quiz', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A', '2': ['B', 'C'] });
  await expect(loadQuizAttempt(scope)).resolves.toEqual(pending);
  for (const other of [{ ...scope, userId: 8 }, { ...scope, tenantId: 3 }, { ...scope, quizId: 45 }]) {
    await expect(loadQuizAttempt(other)).resolves.toBeNull();
  }
});

it('serializes simultaneous preparations to one identity', async () => {
  const [first, second] = await Promise.all([prepareQuizAttempt(scope, { '1': 'A' }), prepareQuizAttempt(scope, { '1': 'A' })]);
  expect(second.key).toBe(first.key);
});

it('preserves an uncertain attempt instead of silently replacing its answers', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  await expect(prepareQuizAttempt(scope, { '1': 'B' })).rejects.toBeInstanceOf(PendingQuizAttemptConflict);
  await expect(loadQuizAttempt(scope)).resolves.toEqual(pending);
});

it('acknowledges durably and permits a fresh intentional attempt afterwards', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  await acknowledgeQuizAttempt(scope, pending.key, result);
  await expect(loadQuizAttempt(scope)).resolves.toMatchObject({ key: pending.key, status: 'acknowledged', result });
  expect((await prepareQuizAttempt(scope, { '1': 'A' })).key).not.toBe(pending.key);
});

it('does not mint a replacement key when required storage reads fail', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  jest.mocked(storage.get).mockRejectedValueOnce(new Error('Storage unavailable'));
  await expect(prepareQuizAttempt(scope, { '1': 'A' })).rejects.toThrow('Storage unavailable');
  await expect(loadQuizAttempt(scope)).resolves.toEqual(pending);
});

it('rejects preparation when the durable manifest cannot be committed', async () => {
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Write failed'));
  await expect(prepareQuizAttempt(scope, { '1': 'A' })).rejects.toThrow('could not be saved');
  await expect(loadQuizAttempt(scope)).resolves.toBeNull();
});

it('retains the pending replay identity if acknowledging the result fails', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Write failed'));
  await expect(acknowledgeQuizAttempt(scope, pending.key, result)).rejects.toThrow('could not be saved');
  await expect(loadQuizAttempt(scope)).resolves.toEqual(pending);
});

it('rejects corrupt record ownership and invalid receipt identities', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  await expect(acknowledgeQuizAttempt(scope, 'different-key', result)).rejects.toThrow('identity changed');
  const chunkKey = [...values.keys()].find(key => key.endsWith('_0'))!;
  values.set(chunkKey, JSON.stringify({ ...pending, userId: 8 }));
  await expect(loadQuizAttempt(scope)).rejects.toThrow('Invalid saved quiz attempt');
});

it('preserves a definite rejection and permits a corrected attempt with a new identity', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  await rejectQuizAttempt(scope, pending.key, 'VALIDATION_FAILED');
  await expect(loadQuizAttempt(scope)).resolves.toMatchObject({ status: 'rejected', rejectionCode: 'VALIDATION_FAILED', answers: { '1': 'A' } });
  const corrected = await prepareQuizAttempt(scope, { '1': 'B' });
  expect(corrected.key).not.toBe(pending.key);
  await expect(rejectQuizAttempt(scope, pending.key, 'VALIDATION_FAILED')).rejects.toThrow();
  await expect(loadQuizAttempt(scope)).resolves.toEqual(corrected);
});

it('does not release an unresolved identity when saving rejection fails', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  jest.mocked(storage.setJson).mockRejectedValueOnce(new Error('Write failed'));
  await expect(rejectQuizAttempt(scope, pending.key, 'MAX_ATTEMPTS_REACHED')).rejects.toThrow();
  await expect(loadQuizAttempt(scope)).resolves.toEqual(pending);
});

it('cannot overwrite an acknowledged receipt with a rejection', async () => {
  const pending = await prepareQuizAttempt(scope, { '1': 'A' });
  await acknowledgeQuizAttempt(scope, pending.key, result);
  await expect(rejectQuizAttempt(scope, pending.key, 'VALIDATION_FAILED')).rejects.toThrow();
  await expect(loadQuizAttempt(scope)).resolves.toMatchObject({ status: 'acknowledged', result });
});
