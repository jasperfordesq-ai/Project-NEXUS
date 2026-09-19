// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { executeEventSessionOperation, recoverEventSessionOperation } from '../eventSessionOperation';
import { loadEventSessionOperation, type EventSessionScope, type EventSessionIntent,
  type SavedEventSessionOperation } from '../eventSessionOperationStore';

type Receipt = Awaited<ReturnType<typeof executeEventSessionOperation>>;
/** Mount within an owner/event/session keyed panel. Loading never sends a mutation. */
export function useEventSessionOperations(scope: EventSessionScope, permitted: boolean,
  onAccepted: (receipt: Receipt) => void) {
  const mounted = useRef(true);
  const allowed = useRef(permitted); allowed.current = permitted;
  const locked = useRef(false);
  const generation = useRef(0);
  const [saved, setSaved] = useState<SavedEventSessionOperation | null>(null);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const { tenantId, userId, eventId, sessionId } = scope;
  const reload = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setReady(false); setStorageFailed(false);
    try {
      const loaded = await loadEventSessionOperation({ tenantId, userId, eventId, sessionId });
      if (mounted.current && request === generation.current) { setSaved(loaded); setReady(true); }
    } catch {
      if (mounted.current && request === generation.current) setStorageFailed(true);
    }
  }, [tenantId, userId, eventId, sessionId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current += 1; };
  }, [reload]);
  async function submit(intent?: EventSessionIntent) {
    if (!mounted.current || !allowed.current || locked.current || !ready || storageFailed
      || (intent && saved?.status === 'pending')) return;
    locked.current = true; setBusy(true); setOperationFailed(false);
    try {
      const current = () => mounted.current && allowed.current;
      const owner = { tenantId, userId, eventId, sessionId };
      const response = intent ? await executeEventSessionOperation(owner, intent, current)
        : await recoverEventSessionOperation(owner, current);
      if (current()) onAccepted(response);
    } catch (error) {
      if (mounted.current) setOperationFailed(true);
      throw error;
    } finally {
      await reload();
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { saved, ready, storageFailed, busy, operationFailed, reload, submit,
    blocked: !ready || storageFailed || busy || saved?.status === 'pending' || !permitted };
}
