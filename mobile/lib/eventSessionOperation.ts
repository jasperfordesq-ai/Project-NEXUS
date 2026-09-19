// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { registerEventAgendaSession, withdrawEventAgendaSession } from './api/events';
import { acknowledgeEventSessionOperation, loadEventSessionOperation, prepareEventSessionOperation,
  type EventSessionScope, type EventSessionIntent, type SavedEventSessionOperation } from './eventSessionOperationStore';

export class EventSessionOperationBusy extends Error {}
export class EventSessionOperationDeparted extends Error {}
export class NoPendingEventSessionOperation extends Error {}
const active = new Set<string>();

async function run(scope: EventSessionScope, isCurrent: () => boolean,
  reserve: () => Promise<SavedEventSessionOperation | null>) {
  const owner = `${scope.tenantId}:${scope.userId}:${scope.eventId}:${scope.sessionId}`;
  if (!isCurrent()) throw new EventSessionOperationDeparted();
  if (active.has(owner)) throw new EventSessionOperationBusy();
  active.add(owner);
  try {
    const saved = await reserve();
    if (!isCurrent()) throw new EventSessionOperationDeparted();
    if (!saved || saved.status !== 'pending') throw new NoPendingEventSessionOperation();
    const send = saved.intent.action === 'register' ? registerEventAgendaSession : withdrawEventAgendaSession;
    const response = await send(scope.eventId, scope.sessionId, saved.intent.expectedVersion, saved.key);
    // An accepted request remains acknowledged even if its originating screen has left.
    await acknowledgeEventSessionOperation(scope, saved.key, response);
    return response;
  } finally {
    active.delete(owner);
  }
}

/** The caller supplies current owner/visit checks and suppresses departed UI updates. */
export function executeEventSessionOperation(scope: EventSessionScope, intent: EventSessionIntent, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => prepareEventSessionOperation(scope, intent));
}

/** Explicit recovery only; never replay on mount or focus. */
export function recoverEventSessionOperation(scope: EventSessionScope, isCurrent: () => boolean) {
  return run(scope, isCurrent, () => loadEventSessionOperation(scope));
}
