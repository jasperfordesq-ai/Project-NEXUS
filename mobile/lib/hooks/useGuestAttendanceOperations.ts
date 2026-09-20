// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '../api/client';
import type { RegistrationGuestAttendanceIntent } from '../api/eventRegistration';
import { executeGuestAttendanceOperation, recoverGuestAttendanceOperation, reviewGuestAttendanceOperation,
  loadGuestAttendanceOperation, type GuestAttendanceScope, type SavedGuestAttendanceOperation } from '../eventGuestAttendanceOperation';

type Receipt = Awaited<ReturnType<typeof executeGuestAttendanceOperation>>;
type State = { epoch: number; saved: SavedGuestAttendanceOperation | null; ready: boolean; storageFailed: boolean;
  busy: boolean; operationFailed: boolean; errorStatus: number | null };
const empty = (epoch: number): State => ({ epoch, saved: null, ready: false, storageFailed: false, busy: false, operationFailed: false, errorStatus: null });

/** active must represent both screen focus and foreground. Loading never replays work. */
export function useGuestAttendanceOperations(scope: GuestAttendanceScope, permitted: boolean, active: boolean, onAccepted: (receipt: Receipt) => void) {
  const { tenantId, userId, eventId, guestId } = scope;
  const valid = [tenantId, userId, eventId, guestId].every(id => Number.isSafeInteger(id) && id > 0);
  const identity = JSON.stringify([tenantId, userId, eventId, guestId, permitted, active]);
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
      const saved = await loadGuestAttendanceOperation({ tenantId, userId, eventId, guestId });
      if (isCurrent() && request === current.current.read) setState(previous => ({ ...previous, epoch, saved, ready: true }));
    } catch {
      if (isCurrent() && request === current.current.read) setState(previous => ({ ...previous, epoch, saved: null, ready: false, storageFailed: true }));
    }
  }, [tenantId, userId, eventId, guestId, epoch, isCurrent]);
  useEffect(() => {
    current.current.mounted = true;
    return () => { current.current.mounted = false; };
  }, []);
  useEffect(() => { setState(empty(epoch)); void reload(); }, [epoch, reload]);
  const visible = isCurrent() && state.epoch === epoch ? state : empty(epoch);
  async function perform(kind: 'submit' | 'recover' | 'review', intent?: RegistrationGuestAttendanceIntent) {
    if (!isCurrent() || current.current.locked || !visible.ready || visible.storageFailed) return;
    if (kind === 'submit' && (!intent || visible.saved?.status === 'pending' || visible.saved?.status === 'rejected')) return;
    if (kind === 'recover' && visible.saved?.status !== 'pending') return;
    if (kind === 'review' && visible.saved?.status !== 'rejected') return;
    current.current.locked = true;
    setState(previous => ({ ...previous, busy: true, operationFailed: false, errorStatus: null }));
    try {
      const owner = { tenantId, userId, eventId, guestId };
      if (kind === 'review') await reviewGuestAttendanceOperation(owner, visible.saved!.key, isCurrent);
      else {
        const receipt = kind === 'submit' ? await executeGuestAttendanceOperation(owner, intent!, isCurrent)
          : await recoverGuestAttendanceOperation(owner, isCurrent);
        if (isCurrent()) callback.current(receipt);
      }
    } catch (error) {
      if (isCurrent()) setState(previous => ({ ...previous, operationFailed: true, errorStatus: error instanceof ApiResponseError ? error.status : null }));
    } finally {
      await reload();
      if (isCurrent()) { current.current.locked = false; setState(previous => ({ ...previous, busy: false })); }
    }
  }
  return { ...visible, reload, submit: (intent: RegistrationGuestAttendanceIntent) => perform('submit', intent),
    recover: () => perform('recover'), review: () => perform('review'),
    blocked: !visible.ready || visible.storageFailed || visible.busy || visible.saved?.status === 'pending' || visible.saved?.status === 'rejected' };
}
