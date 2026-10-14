// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Live "how many people will get this" count for the composer (E-106).
 *
 * The old screen made the organiser press "Preview audience" and refused to
 * save until they had — without ever saying so. Here the count follows the
 * form: 400 ms after the last change to type, groups or ways, one preview is
 * requested, and an older answer that arrives late is ignored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  eventCommunicationsApi,
  type EventBroadcastChannel,
  type EventBroadcastSegment,
  type EventBroadcastVariant,
} from '@/lib/event-communications-api';
import { logError } from '@/lib/logger';

export const AUDIENCE_COUNT_DEBOUNCE_MS = 400;

export type AudienceCountState =
  | { status: 'incomplete' }
  | { status: 'loading' }
  | { status: 'ready'; recipients: number }
  | { status: 'error'; code: string | null };

interface AudienceInput {
  variant: EventBroadcastVariant;
  segments: EventBroadcastSegment[];
  channels: EventBroadcastChannel[];
}

export function useAudienceCount(
  eventId: number,
  input: AudienceInput,
  enabled: boolean,
): { state: AudienceCountState; recount: () => void } {
  const [state, setState] = useState<AudienceCountState>({ status: 'incomplete' });
  const [attempt, setAttempt] = useState(0);
  const sequence = useRef(0);
  const signature = JSON.stringify({
    variant: input.variant,
    segments: [...input.segments].sort(),
    channels: [...input.channels].sort(),
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const request = JSON.parse(signature) as AudienceInput;
    if (request.segments.length === 0 || request.channels.length === 0) {
      sequence.current += 1;
      setState({ status: 'incomplete' });
      return undefined;
    }
    const mine = ++sequence.current;
    setState({ status: 'loading' });
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await eventCommunicationsApi.preview(eventId, request);
          if (mine !== sequence.current) return;
          if (!response.success || !response.data) {
            setState({ status: 'error', code: response.code ?? null });
            return;
          }
          setState({ status: 'ready', recipients: response.data.recipient_count });
        } catch (error) {
          if (mine !== sequence.current) return;
          logError('Failed to count event message audience', error);
          setState({ status: 'error', code: null });
        }
      })();
    }, AUDIENCE_COUNT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, eventId, signature, attempt]);

  useEffect(() => () => { sequence.current += 1; }, []);

  const recount = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, recount };
}
