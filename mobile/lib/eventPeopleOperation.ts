// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { mutateEventRegistrations } from './api/eventPeople';
import { acknowledgeEventPeopleOperation, eventPeopleRequest, loadEventPeopleOperation,
  prepareEventPeopleOperation, type EventPeopleIntent, type EventPeopleScope,
  type SavedEventPeopleOperation } from './eventPeopleOperationStore';

export class EventPeopleOperationBusy extends Error {}
export class EventPeopleOperationDeparted extends Error {}
export class NoPendingEventPeopleOperation extends Error {}
const active = new Set<string>();

async function run(scope: EventPeopleScope, isCurrent: () => boolean,
  reserve: () => Promise<SavedEventPeopleOperation | null>) {
  const owner = `${scope.tenantId}:${scope.userId}:${scope.eventId}`;
  if (!isCurrent()) throw new EventPeopleOperationDeparted();
  if (active.has(owner)) throw new EventPeopleOperationBusy();
  active.add(owner);
  try {
    const saved = await reserve();
    // Storage may finish after navigation, logout or a community switch.
    if (!isCurrent()) throw new EventPeopleOperationDeparted();
    if (!saved || saved.status !== 'pending') throw new NoPendingEventPeopleOperation();
    const result = await mutateEventRegistrations(scope.eventId, eventPeopleRequest(saved));
    // A departed view must not prevent persistence of an accepted partial result.
    // Unknown transport/contract outcomes retain the exact batch for explicit recovery.
    await acknowledgeEventPeopleOperation(scope, saved.key, result);
    return result;
  } finally {
    active.delete(owner);
  }
}

/** Caller supplies a live identity predicate and must suppress stale UI updates. */
export function executeEventPeopleOperation(scope: EventPeopleScope, intent: EventPeopleIntent, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => prepareEventPeopleOperation(scope, intent));
}

/** Explicit user recovery only. Never call on mount or focus. */
export function recoverEventPeopleOperation(scope: EventPeopleScope, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => loadEventPeopleOperation(scope));
}
