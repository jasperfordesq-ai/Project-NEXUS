// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useRef } from 'react';

import { sendTypingIndicator } from '@/lib/api/messages';

/** Wait this long after the first keystroke before telling the other member. */
const START_DELAY_MS = 500;
/** While typing continues, repeat the signal no more often than this. */
const REPEAT_EVERY_MS = 3_000;
/** With no keystroke for this long, the member has stopped. */
const IDLE_MS = 3_000;

export interface TypingSender {
  /** Call with the composer's text on every change. */
  onTextChange: (text: string) => void;
  /** Call when the composer loses focus. */
  onBlur: () => void;
  /** Call when a message is sent. */
  onSend: () => void;
}

/**
 * Tells the other member that this one is typing, sparingly.
 *
 * The route costs a request each way and is limited to 60 a minute, so the signal goes out
 * once 500 ms after typing starts, at most every 3 s while it continues, and a single
 * "stopped" when the member pauses for 3 s, sends, leaves the box, is disabled (messaging
 * restricted, screen covered) or the screen unmounts. Fire-and-forget: a failed request
 * is swallowed, because nothing a member could do about it would help.
 */
export function useTypingSender(recipientId: number | null, enabled: boolean): TypingSender {
  const configRef = useRef({ recipientId, enabled });
  configRef.current = { recipientId, enabled };
  /** The recipient a "typing" was sent to and not yet taken back; null when idle. */
  const activeRecipientRef = useRef<number | null>(null);
  const lastSentAtRef = useRef(0);
  const startTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (startTimerRef.current) {
      clearTimeout(startTimerRef.current);
      startTimerRef.current = null;
    }
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const send = useCallback((recipient: number, isTyping: boolean) => {
    lastSentAtRef.current = Date.now();
    void sendTypingIndicator(recipient, isTyping).catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const active = activeRecipientRef.current;
    if (active === null) return;
    activeRecipientRef.current = null;
    send(active, false);
  }, [clearTimers, send]);

  const armIdle = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(stop, IDLE_MS);
  }, [stop]);

  const onTextChange = useCallback((text: string) => {
    const { recipientId: recipient, enabled: isEnabled } = configRef.current;
    if (!isEnabled || recipient === null || text.length === 0) return;

    if (activeRecipientRef.current === recipient) {
      if (Date.now() - lastSentAtRef.current >= REPEAT_EVERY_MS) send(recipient, true);
      armIdle();
      return;
    }

    // First keystroke: wait a moment so a stray tap does not announce anything.
    if (startTimerRef.current) return;
    startTimerRef.current = setTimeout(() => {
      startTimerRef.current = null;
      const current = configRef.current;
      if (!current.enabled || current.recipientId === null) return;
      activeRecipientRef.current = current.recipientId;
      send(current.recipientId, true);
      armIdle();
    }, START_DELAY_MS);
  }, [armIdle, send]);

  // Disabled or re-pointed mid-typing: take the signal back for the recipient who got it.
  useEffect(() => {
    const repointed = activeRecipientRef.current !== null && activeRecipientRef.current !== recipientId;
    if (!enabled || repointed) stop();
  }, [enabled, recipientId, stop]);

  // Leaving the screen is stopping.
  useEffect(() => stop, [stop]);

  return { onTextChange, onBlur: stop, onSend: stop };
}
