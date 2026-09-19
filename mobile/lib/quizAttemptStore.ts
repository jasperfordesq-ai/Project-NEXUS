// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { CREATION_DRAFT_MAX_CHARACTERS, loadCreationDraft, saveCreationDraft, type CreationDraftScope } from '@/lib/creationDraftStore';
import { mutationIdempotencyKey } from '@/lib/utils/idempotencyKey';
import type { QuizAttemptResult } from '@/lib/api/courses';

export interface QuizAttemptScope { tenantId: number; userId: number; quizId: number }
export type QuizAnswers = Record<string, string | string[]>;
export interface SavedQuizAttempt extends QuizAttemptScope {
  version: 1;
  key: string;
  answers: QuizAnswers;
  status: 'pending' | 'acknowledged' | 'rejected';
  result?: QuizAttemptResult;
  rejectionCode?: string;
}

export class QuizAttemptStorageError extends Error {}
export class QuizAttemptTooLargeError extends QuizAttemptStorageError {}
export class PendingQuizAttemptConflict extends Error {}
const operations = new Map<string, Promise<void>>();

function draftScope(scope: QuizAttemptScope): CreationDraftScope {
  if (![scope.tenantId, scope.userId, scope.quizId].every(id => Number.isSafeInteger(id) && id > 0)) {
    throw new QuizAttemptStorageError('Invalid quiz attempt owner');
  }
  return { kind: 'quiz-attempt', tenantId: scope.tenantId, userId: scope.userId, contextId: scope.quizId };
}

async function ordered<T>(scope: QuizAttemptScope, operation: () => Promise<T>): Promise<T> {
  draftScope(scope);
  const key = `${scope.tenantId}:${scope.userId}:${scope.quizId}`;
  const next = (operations.get(key) ?? Promise.resolve()).then(operation);
  const settled = next.then(() => undefined, () => undefined);
  operations.set(key, settled);
  try { return await next; }
  finally { if (operations.get(key) === settled) operations.delete(key); }
}

function validAnswers(value: unknown): value is QuizAnswers {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.entries(value).every(([id, answer]) => /^\d+$/.test(id)
      && (typeof answer === 'string' || (Array.isArray(answer) && answer.every(item => typeof item === 'string'))));
}

function validResult(value: unknown): value is QuizAttemptResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as QuizAttemptResult;
  return Number.isSafeInteger(result.attempt_id) && result.attempt_id > 0
    && Number.isFinite(result.score_percent) && result.score_percent >= 0 && result.score_percent <= 100
    && typeof result.passed === 'boolean' && typeof result.needs_review === 'boolean';
}

async function read(scope: QuizAttemptScope): Promise<SavedQuizAttempt | null> {
  const value = await loadCreationDraft<SavedQuizAttempt>(draftScope(scope), { required: true });
  if (value === null) return null;
  if (value.version !== 1 || value.tenantId !== scope.tenantId || value.userId !== scope.userId || value.quizId !== scope.quizId
      || typeof value.key !== 'string' || value.key.length < 8 || value.key.length > 191 || !validAnswers(value.answers)
      || !['pending', 'acknowledged', 'rejected'].includes(value.status)
      || (value.status === 'rejected' && (typeof value.rejectionCode !== 'string' || !value.rejectionCode))
      || (value.status === 'acknowledged' && !validResult(value.result))) {
    throw new QuizAttemptStorageError('Invalid saved quiz attempt');
  }
  return value;
}

function fingerprint(answers: QuizAnswers): string {
  return JSON.stringify(Object.fromEntries(Object.entries(answers).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)));
}

export function loadQuizAttempt(scope: QuizAttemptScope): Promise<SavedQuizAttempt | null> {
  return ordered(scope, () => read(scope));
}

/** Persist before sending; never replace an unresolved attempt with different answers. */
export function prepareQuizAttempt(scope: QuizAttemptScope, answers: QuizAnswers): Promise<SavedQuizAttempt> {
  return ordered(scope, async () => {
    if (!validAnswers(answers)) throw new QuizAttemptStorageError('Invalid quiz answers');
    const existing = await read(scope);
    if (existing?.status === 'pending') {
      if (fingerprint(existing.answers) !== fingerprint(answers)) throw new PendingQuizAttemptConflict('Resolve the pending quiz attempt first');
      return existing;
    }
    const pending: SavedQuizAttempt = {
      ...scope, version: 1, key: mutationIdempotencyKey('mobile-quiz-attempt'),
      answers: JSON.parse(JSON.stringify(answers)) as QuizAnswers, status: 'pending',
    };
    // Leave space for the result receipt so an accepted attempt can also be acknowledged.
    if (Array.from(JSON.stringify(pending)).length > CREATION_DRAFT_MAX_CHARACTERS - 512) {
      throw new QuizAttemptTooLargeError('Quiz answers exceed device recovery capacity');
    }
    if (!await saveCreationDraft(draftScope(scope), pending)) throw new QuizAttemptStorageError('Quiz attempt could not be saved');
    return pending;
  });
}

/** Keep the receipt durable: failed acknowledgement leaves the original replayable key. */
export function acknowledgeQuizAttempt(scope: QuizAttemptScope, key: string, result: QuizAttemptResult): Promise<void> {
  return ordered(scope, async () => {
    if (!validResult(result)) throw new QuizAttemptStorageError('Invalid quiz attempt receipt');
    const current = await read(scope);
    if (!current || current.key !== key) throw new QuizAttemptStorageError('Quiz attempt identity changed');
    if (!await saveCreationDraft(draftScope(scope), { ...current, status: 'acknowledged', result })) {
      throw new QuizAttemptStorageError('Quiz attempt receipt could not be saved');
    }
  });
}

/** Only call after an authoritative response establishes that this key created no attempt. */
export function rejectQuizAttempt(scope: QuizAttemptScope, key: string, rejectionCode: string): Promise<void> {
  return ordered(scope, async () => {
    const current = await read(scope);
    if (!current || current.key !== key || current.status === 'acknowledged' || !rejectionCode.trim()) {
      throw new QuizAttemptStorageError('Quiz attempt rejection does not match a pending identity');
    }
    if (!await saveCreationDraft(draftScope(scope), { ...current, status: 'rejected', rejectionCode })) {
      throw new QuizAttemptStorageError('Quiz attempt rejection could not be saved');
    }
  });
}
