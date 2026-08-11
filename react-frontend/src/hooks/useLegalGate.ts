// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * useLegalGate - Check and manage legal document acceptance for the current user.
 *
 * Polls GET /v2/legal/acceptance/status after the user is authenticated.
 * Provides an acceptAll() function that posts to /v2/legal/acceptance/accept-all.
 *
 * If the tenant has no legal documents requiring acceptance, has_pending will
 * always be false and the gate will not appear.
 */

import { useEffect, useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export interface PendingDocument {
  document_id: number;
  document_type: string;
  title: string;
  current_version_id: number | null;
  current_version: string | null;
  acceptance_status: 'not_accepted' | 'outdated' | 'current';
  accepted_at: string | null;
}

interface LegalStatusResponse {
  has_pending: boolean;
  documents: PendingDocument[];
  /**
   * 🔴 Does the platform actually REFUSE requests right now?
   *
   * This answers a different question from `has_pending`. Under
   * `LEGAL_ENFORCEMENT_MODE=report` a member genuinely owes an acceptance
   * (`has_pending: true`) and the server deliberately blocks nobody — that mode
   * exists to count who WOULD be blocked, for a measurement week, before anything
   * is enforced. A client that gates on `has_pending` alone blocks everybody
   * during exactly the week that was supposed to block nobody.
   *
   * Optional because an older backend does not send it. Absent is read as "not
   * blocking", so a version skew mid-deploy cannot raise a wall the server would
   * not have raised.
   */
  enforcement_blocking?: boolean;
  /**
   * Is any pending document one the server will actually refuse writes over?
   *
   * `has_pending` comes from the display query, which deliberately ignores
   * `acceptance_required_for` — a community can mark a document display-only. Gating
   * on `has_pending` alone therefore blocks members over a document the API itself
   * would never refuse.
   *
   * Optional for the same reason as `enforcement_blocking`: absent means an older
   * backend, and absent must not read as "not blocking".
   */
  blocking_pending?: boolean;
}

export interface LegalGateState {
  /** True when a blocking legal document acceptance is needed */
  hasPending: boolean;
  /** Documents the user needs to accept */
  pendingDocs: PendingDocument[];
  /** Accept all pending documents */
  acceptAll: () => Promise<void>;
  /** True while fetching acceptance status */
  isLoading: boolean;
  /** True while saving acceptances */
  isAccepting: boolean;
  /** Non-null when status lookup or acceptance could not be confirmed */
  error: string | null;
  /** Refreshes acceptance status from the server */
  refresh: () => void;
}

type LegalRequestState = 'idle' | 'loading' | 'ready' | 'error';

export function useLegalGate(): LegalGateState {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [hasPending, setHasPending] = useState(false);
  const [pendingDocs, setPendingDocs] = useState<PendingDocument[]>([]);
  const [requestState, setRequestState] = useState<LegalRequestState>('idle');
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => {
    setError(null);
    setRequestState('loading');
    setRefreshTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (authLoading || !isAuthenticated) {
      setHasPending(false);
      setPendingDocs([]);
      setError(null);
      setRequestState('idle');
      return;
    }

    let cancelled = false;
    setError(null);
    setRequestState('loading');

    api
      .get<LegalStatusResponse>('/v2/legal/acceptance/status')
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.data) {
          const { has_pending, documents, enforcement_blocking, blocking_pending } = result.data;
          // Gate only when the server says it is actually refusing requests, AND at
          // least one pending document is one it would refuse over. See both fields on
          // LegalStatusResponse: `report` mode must not block, a display-only document
          // must not block, and an absent field must not be read as blocking.
          setHasPending(
            has_pending && enforcement_blocking !== false && blocking_pending !== false,
          );
          setPendingDocs(
            documents.filter(
              (d) => d.acceptance_status !== 'current'
            )
          );
          setRequestState('ready');
        } else {
          setError(result.error ?? result.code ?? 'LEGAL_STATUS_UNAVAILABLE');
          setRequestState('error');
        }
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : 'LEGAL_STATUS_UNAVAILABLE');
        setRequestState('error');
      });

    return () => { cancelled = true; };
  }, [isAuthenticated, authLoading, refreshTick]);

  const acceptAll = useCallback(async () => {
    setIsAccepting(true);
    setError(null);
    try {
      const result = await api.post('/v2/legal/acceptance/accept-all', {});
      if (result.success) {
        setHasPending(false);
        setPendingDocs([]);
        setRequestState('ready');
      } else {
        setError(result.error ?? result.code ?? 'LEGAL_ACCEPTANCE_FAILED');
        setRequestState('error');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'LEGAL_ACCEPTANCE_FAILED');
      setRequestState('error');
    } finally {
      setIsAccepting(false);
    }
  }, []);

  const isLoading = authLoading || (isAuthenticated && (
    requestState === 'idle' || requestState === 'loading'
  ));

  return {
    hasPending,
    pendingDocs,
    acceptAll,
    isLoading,
    isAccepting,
    error,
    refresh,
  };
}

export default useLegalGate;
