// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { executeEventPeopleOperation, recoverEventPeopleOperation } from '../eventPeopleOperation';
import { loadEventPeopleOperation, type EventPeopleIntent, type EventPeopleScope,
  type SavedEventPeopleOperation } from '../eventPeopleOperationStore';

/** Mount inside an owner-keyed workspace. Loading never replays a saved mutation. */
export function useEventPeopleOperations(scope: EventPeopleScope, permitted: boolean, onAccepted: () => void) {
  const mounted = useRef(true);
  const allowed = useRef(permitted); allowed.current = permitted;
  const locked = useRef(false);
  const readGeneration = useRef(0);
  const [saved, setSaved] = useState<SavedEventPeopleOperation | null>(null);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const { tenantId, userId, eventId } = scope;
  const reload = useCallback(async () => {
    if (!mounted.current) return;
    const generation = ++readGeneration.current;
    if (mounted.current) { setReady(false); setStorageFailed(false); }
    try {
      const operation = await loadEventPeopleOperation({ tenantId, userId, eventId });
      if (mounted.current && generation === readGeneration.current) { setSaved(operation); setReady(true); }
    } catch {
      if (mounted.current && generation === readGeneration.current) setStorageFailed(true);
    }
  }, [tenantId, userId, eventId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; readGeneration.current += 1; };
  }, [reload]);
  async function submit(intent?: EventPeopleIntent) {
    if (!mounted.current || locked.current || !allowed.current || !ready || storageFailed) return;
    locked.current = true; setBusy(true); setOperationFailed(false);
    try {
      const current = () => mounted.current && allowed.current;
      const owner = { tenantId, userId, eventId };
      if (intent) await executeEventPeopleOperation(owner, intent, current);
      else await recoverEventPeopleOperation(owner, current);
      if (mounted.current) onAccepted();
    } catch (error) {
      if (mounted.current) setOperationFailed(true);
      throw error;
    } finally {
      await reload();
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { saved, ready, storageFailed, operationFailed, busy, reload, submit,
    blocked: !ready || storageFailed || busy || saved?.status === 'pending' || !permitted };
}
