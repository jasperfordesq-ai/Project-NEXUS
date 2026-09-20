// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '@/lib/api/client';
import { prepareOrganizerRegistrationExport, type RegistrationAnswerAccess } from '@/lib/api/eventRegistration';
import { shareAuditedCsv } from '@/lib/shareAuditedCsv';
interface Scope { tenantId: number; userId: number; eventId: number }
type Result = { epoch: number; status: 'idle' | 'loading' | 'failed'; errorStatus: number | null; unavailable: boolean };
export function useRegistrationExport(scope: Scope, permitted: boolean, sensitive: boolean, active: boolean) {
  const valid = Object.values(scope).every(id => Number.isSafeInteger(id) && id > 0);
  const identity = JSON.stringify([scope.tenantId, scope.userId, scope.eventId, permitted, sensitive, active]);
  const current = useRef({ identity, epoch: 0, locked: false, mounted: true });
  if (current.current.identity !== identity) current.current = { ...current.current, identity, epoch: current.current.epoch + 1, locked: false };
  const idle = (epoch: number): Result => ({ epoch, status: 'idle', errorStatus: null, unavailable: false });
  const [result, setResult] = useState<Result>(idle(0));
  useEffect(() => { current.current.mounted = true; return () => { current.current.mounted = false; current.current.epoch += 1; }; }, []);
  useEffect(() => { setResult(idle(current.current.epoch)); }, [identity]);
  async function open(evidence: RegistrationAnswerAccess) {
    if (!current.current.mounted || current.current.identity !== identity || !valid || !permitted || !active || current.current.locked
      || (evidence.include_sensitive && !sensitive)) return;
    const epoch = current.current.epoch;
    const isCurrent = () => current.current.mounted && current.current.epoch === epoch;
    current.current.locked = true; setResult({ ...idle(epoch), status: 'loading' });
    try {
      await shareAuditedCsv(() => prepareOrganizerRegistrationExport(scope.eventId, evidence, isCurrent), isCurrent);
      // Expo reports dismissal too; never label this as a successful save/send.
      if (isCurrent()) setResult(idle(epoch));
    } catch (error) {
      if (isCurrent()) setResult({ epoch, status: 'failed', errorStatus: error instanceof ApiResponseError ? error.status : null,
        unavailable: error instanceof Error && error.message === 'sharing_unavailable' });
    } finally { if (isCurrent()) current.current.locked = false; }
  }
  return { ...(active && permitted && valid && result.epoch === current.current.epoch ? result : idle(current.current.epoch)), open };
}
