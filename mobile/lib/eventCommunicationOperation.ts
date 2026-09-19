// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import {
  createEventCommunication, reviseEventCommunication, scheduleEventCommunication,
  cancelEventCommunication, retryEventCommunication, type MobileEventBroadcast,
} from '@/lib/api/eventCommunications';
import {
  acknowledgeEventCommunicationOperation, loadEventCommunicationOperation,
  prepareEventCommunicationOperation, type EventCommunicationIntent,
  type EventCommunicationScope, type SavedEventCommunicationOperation,
} from '@/lib/eventCommunicationOperationStore';

export class EventCommunicationOperationBusy extends Error {}
export class EventCommunicationOperationDeparted extends Error {}
export class NoPendingEventCommunicationOperation extends Error {}
const active = new Set<string>();

async function run(
  scope: EventCommunicationScope,
  isCurrent: () => boolean,
  reserve: () => Promise<SavedEventCommunicationOperation | null>,
): Promise<MobileEventBroadcast> {
  const owner = `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
  if (!isCurrent()) throw new EventCommunicationOperationDeparted();
  if (active.has(owner)) throw new EventCommunicationOperationBusy();
  active.add(owner);
  try {
    const saved = await reserve();
    // Secure storage can outlive the route/account that started the action.
    if (!isCurrent()) throw new EventCommunicationOperationDeparted();
    if (!saved || saved.status !== 'pending') throw new NoPendingEventCommunicationOperation();
    const { intent, key } = saved;
    let broadcast: MobileEventBroadcast;
    switch (intent.action) {
      case 'create': broadcast = await createEventCommunication(scope.eventId, intent.input, key); break;
      case 'revise': broadcast = await reviseEventCommunication(intent.broadcastId, intent.expectedVersion, intent.input, key); break;
      case 'schedule': broadcast = await scheduleEventCommunication(intent.broadcastId, intent.expectedVersion, intent.scheduledAt, key); break;
      case 'cancel': broadcast = await cancelEventCommunication(intent.broadcastId, intent.expectedVersion, intent.reason, key); break;
      case 'retry': broadcast = await retryEventCommunication(intent.broadcastId, intent.expectedVersion, key); break;
    }
    // Once accepted, record the receipt even if the caller has since departed.
    // Transport, contract, and receipt-storage errors leave the exact request pending.
    await acknowledgeEventCommunicationOperation(scope, key, {
      id: broadcast.id, event_id: broadcast.event_id, version: broadcast.version, status: broadcast.status,
    });
    return broadcast;
  } finally {
    active.delete(owner);
  }
}

/** Caller must provide a live route/account identity predicate and suppress stale UI updates. */
export function executeEventCommunicationOperation(
  scope: EventCommunicationScope, intent: EventCommunicationIntent, isCurrent: () => boolean,
): Promise<MobileEventBroadcast> {
  return run(scope, isCurrent, () => prepareEventCommunicationOperation(scope, intent));
}

/** Explicit user recovery only: never attach this to a mount/focus effect. */
export function recoverEventCommunicationOperation(
  scope: EventCommunicationScope, isCurrent: () => boolean,
): Promise<MobileEventBroadcast> {
  return run(scope, isCurrent, () => loadEventCommunicationOperation(scope));
}
