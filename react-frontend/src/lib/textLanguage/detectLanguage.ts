// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which language a piece of member content is written in, as the server's
 * language service (the community's Google translation engine) says.
 *
 * Owner, 9 Nov 2026: "if my language is set to English and the text is
 * English, there's no need for a translate button. If … text anywhere on the
 * site is in a different language, then there should be a translate button."
 * The words alone cannot always tell (`isClearlyWrittenIn` keeps the button on
 * short texts such as "Media Test Group"), so the server is asked.
 *
 *  - Every text a page shows is asked about in ONE request (up to 50 at a time),
 *    gathered over a few milliseconds.
 *  - An answer is remembered for the rest of the visit, and the server
 *    remembers it for months, so a text is asked about once.
 *  - Any failure answers "not known" (null); the Translate button then stays,
 *    exactly as before this existed.
 *
 * Tests: the shared test setup replaces this module with one that knows
 * nothing, so components behave as before unless a test opts in with
 * `vi.unmock('@/lib/textLanguage/detectLanguage')`.
 */

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { isMostlyEverydayWords } from './textLanguage';

export interface DetectedLanguage {
  language: string;
  confidence: number;
}

/** At or above this, Google's answer is taken as it is; below it, the words must agree. */
export const SURE_CONFIDENCE = 0.7;

const BATCH_SIZE = 50;
const GATHER_MS = 30;
const TIMEOUT_MS = 8000;
/** The server looks at the first 300 characters; there is no need to send more. */
const MAX_TEXT_LENGTH = 1000;

const known = new Map<string, DetectedLanguage | null>();
const asking = new Map<string, Promise<DetectedLanguage | null>>();
let queue: Array<{ text: string; resolve: (answer: DetectedLanguage | null) => void }> = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function keyOf(text: string): string {
  return text.trim().slice(0, MAX_TEXT_LENGTH);
}

function toAnswer(value: unknown): DetectedLanguage | null {
  if (!value || typeof value !== 'object') return null;
  const { language, confidence } = value as { language?: unknown; confidence?: unknown };
  if (typeof language !== 'string' || language.trim() === '') return null;
  return { language: language.trim().toLowerCase(), confidence: Number(confidence) || 0 };
}

async function ask(batch: typeof queue): Promise<void> {
  let answers: Array<DetectedLanguage | null> | null = null;
  try {
    const response = await api.post<{ detections?: unknown }>(
      '/v2/ugc-language',
      { texts: batch.map((item) => item.text) },
      { timeout: TIMEOUT_MS },
    );
    const detections = response.success ? response.data?.detections : null;
    if (Array.isArray(detections)) answers = batch.map((_, index) => toAnswer(detections[index]));
  } catch {
    answers = null;
  }
  batch.forEach((item, index) => {
    const answer = answers ? answers[index] ?? null : null;
    // A failure is remembered for this visit too: asking again on every
    // re-render would only repeat it. The button stays meanwhile.
    known.set(item.text, answer);
    asking.delete(item.text);
    item.resolve(answer);
  });
}

function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  while (queue.length > 0) {
    void ask(queue.splice(0, BATCH_SIZE));
  }
}

/** The remembered answer: undefined when not asked yet, null when not known. */
export function knownTextLanguage(text: string): DetectedLanguage | null | undefined {
  return known.get(keyOf(text));
}

export function detectTextLanguage(text: string): Promise<DetectedLanguage | null> {
  const key = keyOf(text);
  if (known.has(key)) return Promise.resolve(known.get(key) ?? null);
  const pending = asking.get(key);
  if (pending) return pending;
  const promise = new Promise<DetectedLanguage | null>((resolve) => {
    queue.push({ text: key, resolve });
    if (queue.length >= BATCH_SIZE) flush();
    else if (!timer) timer = setTimeout(flush, GATHER_MS);
  });
  asking.set(key, promise);
  return promise;
}

/** For tests. */
export function forgetTextLanguages(): void {
  known.clear();
  asking.clear();
  queue = [];
  if (timer) clearTimeout(timer);
  timer = null;
}

function baseLanguage(code: string | null | undefined): string {
  return (code ?? '').trim().slice(0, 2).toLowerCase();
}

/**
 * Is everything shown (title, body…) written in the reader's language? Only
 * when every part has an answer in that language — sure enough, or unsure but
 * made of the reader's everyday words. Anything not known answers false, so
 * the Translate button stays.
 */
export function writtenInReaderLanguage(
  parts: readonly string[],
  answers: ReadonlyArray<DetectedLanguage | null | undefined>,
  readerLocale: string | null | undefined,
  vocabulary: ReadonlySet<string> | null | undefined,
): boolean {
  const reader = baseLanguage(readerLocale);
  if (!reader || parts.length === 0 || answers.length < parts.length) return false;
  return parts.every((part, index) => {
    const answer = answers[index];
    if (!answer || baseLanguage(answer.language) !== reader) return false;
    return answer.confidence >= SURE_CONFIDENCE || isMostlyEverydayWords(part, vocabulary);
  });
}

/**
 * The answers for a set of texts. `settled` is false while any is still being
 * asked about; when `enabled` is false nothing is asked and it is settled with
 * no answers.
 */
export function useTextLanguages(
  texts: readonly string[],
  enabled: boolean,
): { settled: boolean; answers: Array<DetectedLanguage | null> } {
  const key = JSON.stringify(texts);
  const [fetched, setFetched] = useState<{ key: string; answers: Array<DetectedLanguage | null> } | null>(null);

  const remembered = enabled ? texts.map((text) => knownTextLanguage(text)) : [];
  const allRemembered = remembered.every((answer) => answer !== undefined);

  useEffect(() => {
    if (!enabled || allRemembered) return undefined;
    let cancelled = false;
    void Promise.all(texts.map((text) => detectTextLanguage(text))).then((answers) => {
      if (!cancelled) setFetched({ key, answers });
    });
    return () => { cancelled = true; };
    // `key` stands for the texts' contents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, allRemembered]);

  if (!enabled) return { settled: true, answers: [] };
  if (allRemembered) return { settled: true, answers: remembered.map((answer) => answer ?? null) };
  if (fetched?.key === key) return { settled: true, answers: fetched.answers };
  return { settled: false, answers: [] };
}
