// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { randomUUID } from 'expo-crypto';
import {
  registerOfflineCheckinDevice, rotateOfflineCheckinDevice,
  downloadOfflineCheckinManifest, getOfflineCheckinWorkspace,
} from '@/lib/api/eventOfflineCheckin';
import {
  getPendingOfflineRegistration, updatePendingOfflineRegistration,
  completeOfflineRegistration, loadMobileOfflineSessionForReview,
  activateMobileOfflineSession, type PendingOfflineRegistration,
} from '@/lib/eventOfflineCheckinStore';

/** A user-invoked attempt; loading the screen must never call this automatically. */
export async function recoverOfflineRegistration(
  eventId: number,
  action: 'resume' | 'reauthorize',
  isCurrent: () => boolean,
) {
  let pending = await getPendingOfflineRegistration(eventId);
  if (!pending || !isCurrent()) throw new Error('offline_registration_changed');

  const check = async () => {
    if (!isCurrent()) throw new Error('offline_registration_changed');
    const current = await getPendingOfflineRegistration(eventId);
    if (!isCurrent() || JSON.stringify(current) !== JSON.stringify(pending)) {
      throw new Error('offline_registration_changed');
    }
  };
  const save = async (next: PendingOfflineRegistration) => {
    await check();
    pending = await updatePendingOfflineRegistration(pending!, next);
    if (!isCurrent()) throw new Error('offline_registration_changed');
  };

  if (pending.stage === 'reauthorize') {
    if (action !== 'reauthorize') return { pending, session: null, workspace: null };
    const previous = await loadMobileOfflineSessionForReview(eventId, pending.device.id);
    if (previous.session) throw new Error('offline_registration_existing_session');
    await save({ ...pending, stage: 'rotate', idempotencyKey: `mobile-offline-rotate-${randomUUID()}` });
  }

  if (pending.stage === 'register' || pending.stage === 'rotate') {
    const request = pending;
    await check();
    const result = request.stage === 'register'
      ? await registerOfflineCheckinDevice(eventId, request.label, request.idempotencyKey)
      : await rotateOfflineCheckinDevice(eventId, request.device.id, request.device.version, request.idempotencyKey);
    if (result.event_id !== eventId || result.device.status !== 'active'
      || (request.stage === 'rotate' && (result.device.id !== request.device.id || result.device.version !== request.device.version + 1))) {
      throw new Error('offline_registration_response_mismatch');
    }
    const device = { id: result.device.id, version: result.device.version };
    await save(result.device.secret
      ? { ...request, stage: 'activate', device, secret: result.device.secret }
      : { ...request, stage: 'reauthorize', device });
  }

  if (pending.stage !== 'activate') return { pending, session: null, workspace: null };
  const activation = pending;
  await check();
  const workspace = await getOfflineCheckinWorkspace(eventId);
  await check();
  const device = workspace.devices.find(item => item.id === activation.device.id);
  if (!device || device.status !== 'active' || device.version !== activation.device.version) {
    throw new Error('offline_registration_device_changed');
  }
  const existing = await loadMobileOfflineSessionForReview(eventId, activation.device.id);
  await check();
  let session = existing.session;
  if (session) {
    // Completion may have failed after activation. Never empty a subsequently used queue.
    if (existing.inactive || session.deviceVersion !== activation.device.version || session.deviceSecret !== activation.secret) {
      throw new Error('offline_registration_existing_session');
    }
  } else {
    const manifest = await downloadOfflineCheckinManifest(eventId, activation.secret);
    await check();
    if (manifest.device.id !== activation.device.id || manifest.device.version !== activation.device.version) {
      throw new Error('offline_registration_response_mismatch');
    }
    await activateMobileOfflineSession(activation.secret, manifest, workspace);
    await check();
    const restored = await loadMobileOfflineSessionForReview(eventId, activation.device.id);
    session = restored.session;
    if (!session || restored.inactive || session.deviceSecret !== activation.secret || session.deviceVersion !== activation.device.version) {
      throw new Error('offline_registration_activation_unverified');
    }
  }
  await check();
  await completeOfflineRegistration(activation);
  return { pending: null, session, workspace };
}
