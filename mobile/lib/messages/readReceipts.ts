// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { MessageReadEvent } from '@/lib/context/RealtimeContext';

/**
 * Whether a `message.read` event covers a given message: the listed ids when the server
 * sends them, else everything up to `up_to_message_id`, else (no scope at all) everything.
 *
 * Pure, and deliberately NOT in RealtimeContext: the screen tests mock that whole module,
 * and a helper that vanishes with the mock would crash the thread in the test tree only.
 */
export function readEventCovers(event: MessageReadEvent, messageId: number): boolean {
  if (Array.isArray(event.message_ids)) return event.message_ids.includes(messageId);
  if (typeof event.up_to_message_id === 'number') return messageId <= event.up_to_message_id;
  return true;
}
