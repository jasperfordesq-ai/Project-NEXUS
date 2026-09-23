// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef, useState } from 'react';
import { discardRejectedAgendaOperation, executeAgendaOperation, recoverAgendaOperation, reviewAgendaOperation } from '../eventAgendaOperation';
import { loadAgendaOperation, type AgendaOperationScope, type AgendaOperationIntent,
  type SavedAgendaOperation } from '../eventAgendaOperation';

type Receipt = Awaited<ReturnType<typeof executeAgendaOperation>>;
/** Mount within an owner/event keyed panel. Loading never sends a mutation. */
export function useAgendaOperations(scope: AgendaOperationScope, permitted: boolean,
  onAccepted: (receipt: Receipt) => void) {
  const mounted = useRef(true);
  const allowed = useRef(permitted); allowed.current = permitted;
  const locked = useRef(false);
  const generation = useRef(0);
  const [saved, setSaved] = useState<SavedAgendaOperation | null>(null);
  const [ready, setReady] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [operationFailed, setOperationFailed] = useState(false);
  const { tenantId, userId, eventId } = scope;
  const reload = useCallback(async () => {
    if (!mounted.current) return;
    const request = ++generation.current;
    setReady(false); setStorageFailed(false);
    try {
      const loaded = await loadAgendaOperation({ tenantId, userId, eventId });
      if (mounted.current && request === generation.current) { setSaved(loaded); setReady(true); }
    } catch {
      if (mounted.current && request === generation.current) setStorageFailed(true);
    }
  }, [tenantId, userId, eventId]);
  useEffect(() => {
    mounted.current = true;
    void reload();
    return () => { mounted.current = false; generation.current += 1; };
  }, [reload]);
  async function submit(intent?: AgendaOperationIntent) {
    if (!mounted.current || !allowed.current || locked.current || !ready || storageFailed
      || saved?.status === 'rejected' || (intent && saved?.status === 'pending')) return;
    locked.current = true; setBusy(true); setOperationFailed(false);
    try {
      const current = () => mounted.current && allowed.current;
      const owner = { tenantId, userId, eventId };
      const response = intent ? await executeAgendaOperation(owner, intent, current)
        : await recoverAgendaOperation(owner, current);
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
  async function review() {
    if (!mounted.current || !allowed.current || locked.current || saved?.status !== 'rejected') return;
    locked.current = true; setBusy(true); setOperationFailed(false);
    try {
      await reviewAgendaOperation({ tenantId, userId, eventId }, saved.key, () => mounted.current && allowed.current);
    } catch (error) {
      if (mounted.current) setOperationFailed(true);
      throw error;
    } finally {
      await reload(); locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  async function discard(key: string) {
    if (!mounted.current || !allowed.current || locked.current || !ready || storageFailed
      || saved?.key !== key || (saved.status !== 'rejected' && saved.status !== 'review')) return false;
    locked.current = true; setBusy(true); setOperationFailed(false);
    try {
      const current = () => mounted.current && allowed.current;
      await discardRejectedAgendaOperation({ tenantId, userId, eventId }, key, current);
      return current();
    } catch (error) {
      if (mounted.current) setOperationFailed(true);
      throw error;
    } finally {
      await reload(); locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return { saved, ready, storageFailed, busy, operationFailed, reload, submit, review, discard,
    blocked: !ready || storageFailed || busy || saved?.status === 'pending' || saved?.status === 'rejected' || !permitted };
}
