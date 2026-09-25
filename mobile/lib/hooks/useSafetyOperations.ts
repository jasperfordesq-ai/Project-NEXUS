// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '../api/client';
import { executeSafetyOperation, recoverSafetyOperation,
  loadSafetyOperation, discardRejectedSafetyOperation, type SafetyOperationScope, type SafetyOperationIntent, type SavedSafetyOperation } from '../eventSafetyOperation';

type Acknowledgement = Awaited<ReturnType<typeof executeSafetyOperation>>;
type State = { epoch: number; saved: SavedSafetyOperation | null; ready: boolean; storageFailed: boolean;
  busy: boolean; operationFailed: boolean; errorStatus: number | null };
const empty = (epoch: number): State => ({ epoch, saved: null, ready: false, storageFailed: false, busy: false, operationFailed: false, errorStatus: null });

/** active must represent both screen focus and foreground. Loading never replays work. */
export function useSafetyOperations(scope: SafetyOperationScope, permitted: boolean, active: boolean, onAccepted: (acknowledgement: Acknowledgement, intent: SafetyOperationIntent) => void) {
  const { tenantId, userId, eventId } = scope;
  const valid = [tenantId, userId, eventId].every(id => Number.isSafeInteger(id) && id > 0);
  const identity = JSON.stringify([tenantId, userId, eventId, permitted, active]);
  const current = useRef({ identity, epoch: 0, mounted: true, locked: false, read: 0 });
  if (current.current.identity !== identity) current.current = { ...current.current, identity, epoch: current.current.epoch + 1, locked: false, read: 0 };
  const epoch = current.current.epoch;
  const [state, setState] = useState<State>(empty(0));
  const callback = useRef(onAccepted); callback.current = onAccepted;
  const isCurrent = useCallback(() => current.current.mounted && current.current.epoch === epoch && valid && permitted && active,
    [epoch, valid, permitted, active]);
  const reload = useCallback(async () => {
    if (!isCurrent()) return;
    const request = ++current.current.read;
    setState(previous => ({ ...(previous.epoch === epoch ? previous : empty(epoch)), ready: false, storageFailed: false }));
    try {
      const saved = await loadSafetyOperation({ tenantId, userId, eventId });
      if (isCurrent() && request === current.current.read) setState(previous => ({ ...previous, epoch, saved, ready: true }));
    } catch {
      if (isCurrent() && request === current.current.read) setState(previous => ({ ...previous, epoch, saved: null, ready: false, storageFailed: true }));
    }
  }, [tenantId, userId, eventId, epoch, isCurrent]);
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  useEffect(() => { setState(empty(epoch)); void reload(); }, [epoch, reload]);
  const visible = isCurrent() && state.epoch === epoch ? state : empty(epoch);
  async function perform(kind: 'submit' | 'recover' | 'discard', intent?: SafetyOperationIntent) {
    if (!isCurrent() || current.current.locked || !visible.ready || visible.storageFailed) return;
    if (kind === 'submit' && (!intent || ['pending', 'rejected'].includes(visible.saved?.status ?? ''))) return;
    if (kind === 'recover' && visible.saved?.status !== 'pending') return;
    if (kind === 'discard' && visible.saved?.status !== 'rejected') return;
    current.current.locked = true;
    setState(previous => ({ ...previous, busy: true, operationFailed: false, errorStatus: null }));
    try {
      const owner = { tenantId, userId, eventId };
      if (kind === 'discard') {
        await discardRejectedSafetyOperation(owner, visible.saved!.key, isCurrent);
        return;
      }
      const acceptedIntent = kind === 'submit' ? intent! : visible.saved!.status === 'pending' ? visible.saved!.intent : null;
      if (!acceptedIntent) return;
      const acknowledgement = kind === 'submit' ? await executeSafetyOperation(owner, acceptedIntent, isCurrent)
          : await recoverSafetyOperation(owner, isCurrent);
      if (isCurrent()) callback.current(acknowledgement, acceptedIntent);
    } catch (error) {
      if (isCurrent()) setState(previous => ({ ...previous, operationFailed: true, errorStatus: error instanceof ApiResponseError ? error.status : null }));
    } finally {
      await reload();
      if (isCurrent()) { current.current.locked = false; setState(previous => ({ ...previous, busy: false })); }
    }
  }
  return { ...visible, reload, submit: (intent: SafetyOperationIntent) => perform('submit', intent),
    recover: () => perform('recover'), discard: () => perform('discard'),
    blocked: !visible.ready || visible.storageFailed || visible.busy || ['pending', 'rejected'].includes(visible.saved?.status ?? '') };
}
