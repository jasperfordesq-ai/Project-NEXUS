// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiResponseError } from '../api/client';
import type { InvitationCampaignIntent, OrganizerInvitationCampaign } from '../api/eventRegistration';
import { executeInvitationCampaignOperation, recoverInvitationCampaignOperation,
  loadInvitationCampaignOperation, reviewInvitationCampaignOperation, type InvitationCampaignScope, type SavedInvitationCampaignOperation } from '../eventInvitationCampaignOperation';

type Receipt = Awaited<ReturnType<typeof executeInvitationCampaignOperation>>;
type State = { epoch: number; saved: SavedInvitationCampaignOperation | null; ready: boolean; storageFailed: boolean;
  busy: boolean; operationFailed: boolean; errorStatus: number | null };
const empty = (epoch: number): State => ({ epoch, saved: null, ready: false, storageFailed: false, busy: false, operationFailed: false, errorStatus: null });

/** active must represent both screen focus and foreground. Loading never replays work. */
export function useInvitationCampaignOperations(scope: InvitationCampaignScope, permitted: boolean, active: boolean, onAccepted: (receipt: Receipt) => void, onReviewed?: (campaign: OrganizerInvitationCampaign) => void) {
  const { tenantId, userId, eventId } = scope;
  const valid = [tenantId, userId, eventId].every(id => Number.isSafeInteger(id) && id > 0);
  const identity = JSON.stringify([tenantId, userId, eventId, permitted, active]);
  const current = useRef({ identity, epoch: 0, mounted: true, locked: false, read: 0 });
  if (current.current.identity !== identity) current.current = { ...current.current, identity, epoch: current.current.epoch + 1, locked: false, read: 0 };
  const epoch = current.current.epoch;
  const [state, setState] = useState<State>(empty(0));
  const reviewedCallback = useRef(onReviewed); reviewedCallback.current = onReviewed;
  const callback = useRef(onAccepted); callback.current = onAccepted;
  const isCurrent = useCallback(() => current.current.mounted && current.current.epoch === epoch && valid && permitted && active,
    [epoch, valid, permitted, active]);
  const reload = useCallback(async () => {
    if (!isCurrent()) return;
    const request = ++current.current.read;
    setState(previous => ({ ...(previous.epoch === epoch ? previous : empty(epoch)), ready: false, storageFailed: false }));
    try {
      const saved = await loadInvitationCampaignOperation({ tenantId, userId, eventId });
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
  async function perform(kind: 'submit' | 'recover' | 'review', intent?: InvitationCampaignIntent) {
    if (!isCurrent() || current.current.locked || !visible.ready || visible.storageFailed) return;
    if (kind === 'submit' && (!intent || ['pending', 'rejected'].includes(visible.saved?.status ?? ''))) return;
    if (kind === 'recover' && visible.saved?.status !== 'pending') return;
    if (kind === 'review' && visible.saved?.status !== 'rejected') return;
    current.current.locked = true;
    setState(previous => ({ ...previous, busy: true, operationFailed: false, errorStatus: null }));
    try {
      const owner = { tenantId, userId, eventId };
      if (kind === 'review') {
        const campaign = await reviewInvitationCampaignOperation(owner, visible.saved!.key, isCurrent);
        if (isCurrent()) reviewedCallback.current?.(campaign);
        return;
      }
      const receipt = kind === 'submit' ? await executeInvitationCampaignOperation(owner, intent!, isCurrent)
          : await recoverInvitationCampaignOperation(owner, isCurrent);
      if (isCurrent()) callback.current(receipt);
    } catch (error) {
      const attempted = kind === 'submit' ? intent : visible.saved?.status === 'pending' ? visible.saved.intent : undefined;
      const explainedRejection = kind !== 'review' && attempted && attempted.action !== 'preview' && error instanceof ApiResponseError && error.status === 409
        && error.code === 'EVENT_REGISTRATION_CONFLICT' && error.field === 'expected_campaign_revision';
      if (isCurrent()) setState(previous => ({ ...previous, operationFailed: !explainedRejection, errorStatus: error instanceof ApiResponseError ? error.status : null }));
    } finally {
      await reload();
      if (isCurrent()) { current.current.locked = false; setState(previous => ({ ...previous, busy: false })); }
    }
  }
  return { ...visible, reload, submit: (intent: InvitationCampaignIntent) => perform('submit', intent),
    recover: () => perform('recover'), review: () => perform('review'),
    blocked: !visible.ready || visible.storageFailed || visible.busy || ['pending', 'rejected'].includes(visible.saved?.status ?? '') };
}
