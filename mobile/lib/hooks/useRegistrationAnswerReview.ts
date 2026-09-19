// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '@/lib/api/client';
import { reviewOrganizerRegistrationAnswers, type RegistrationAnswerAccess } from '@/lib/api/eventRegistration';

type Answers = Awaited<ReturnType<typeof reviewOrganizerRegistrationAnswers>>['data']['answers'];
interface Scope { tenantId: number; userId: number; eventId: number; submissionId: number; revision: number }
type Result = { epoch: number; status: 'idle' | 'loading' | 'ready' | 'failed'; answers: Answers | null; errorStatus: number | null };
/** Audited reads are explicit and memory-only. The caller supplies focus/foreground state. */
export function useRegistrationAnswerReview(scope: Scope, permitted: boolean, sensitive: boolean, active: boolean) {
  const valid = Object.values(scope).every(id => Number.isSafeInteger(id) && id > 0);
  const identity = JSON.stringify([scope.tenantId, scope.userId, scope.eventId, scope.submissionId, scope.revision, permitted, sensitive, active]);
  const current = useRef({ identity, epoch: 0, locked: false, mounted: true });
  if (current.current.identity !== identity) {
    current.current = { ...current.current, identity, epoch: current.current.epoch + 1, locked: false };
  }
  const [result, setResult] = useState<Result>({ epoch: 0, status: 'idle', answers: null, errorStatus: null });
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; current.current.epoch += 1; };
  }, []);
  useEffect(() => {
    setResult({ epoch: current.current.epoch, status: 'idle', answers: null, errorStatus: null });
  }, [identity]);
  function clear() {
    if (!current.current.mounted || current.current.identity !== identity) return;
    current.current.epoch += 1; current.current.locked = false;
    setResult({ epoch: current.current.epoch, status: 'idle', answers: null, errorStatus: null });
  }
  async function open(evidence: RegistrationAnswerAccess) {
    if (!current.current.mounted || current.current.identity !== identity || !valid || !permitted || !active || current.current.locked
      || (evidence.include_sensitive && !sensitive)) return;
    const epoch = current.current.epoch;
    current.current.locked = true;
    setResult({ epoch, status: 'loading', answers: null, errorStatus: null });
    const isCurrent = () => current.current.mounted && current.current.epoch === epoch;
    try {
      const response = await reviewOrganizerRegistrationAnswers(scope.eventId, scope.submissionId, evidence);
      if (isCurrent()) setResult({ epoch, status: 'ready', answers: response.data.answers, errorStatus: null });
    } catch (error) {
      if (isCurrent()) setResult({ epoch, status: 'failed', answers: null,
        errorStatus: error instanceof ApiResponseError ? error.status : null });
    } finally {
      if (isCurrent()) current.current.locked = false;
    }
  }
  const visible = active && permitted && valid && result.epoch === current.current.epoch;
  return { status: visible ? result.status : 'idle', answers: visible ? result.answers : null,
    errorStatus: visible ? result.errorStatus : null, open, clear };
}
