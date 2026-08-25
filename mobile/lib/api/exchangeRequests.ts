// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The timebanking exchange workflow — the transaction this platform exists for.
 *
 * 🔴 This file is NEW on 2026-08-21 and it closes a hole, not a nice-to-have. Until now
 * `lib/api/exchanges.ts` called exactly three of the server's twelve exchange endpoints:
 * `config`, `check` and `store`. So a member could SEND an exchange request from the phone
 * and then nothing — the provider could not accept it, neither side could start, complete,
 * confirm hours or cancel, and no screen listed your exchanges at all. The request landed in
 * the database (`exchange_requests`, verified: row 61, `pending_provider`) and stopped there.
 *
 * 🔴 **The two files are about different things, despite the names.**
 * `lib/api/exchanges.ts` is about **listings** — `createExchange()` posts to
 * `/v2/listings`, and `exchange-detail.tsx` is the listing detail screen. The mobile app
 * inherited "exchange" as its word for a listing. THIS file is about
 * `/v2/exchanges/*` — the request workflow between two members, a different id space
 * entirely. Confusing the two is not hypothetical: `navigateToLink` sent the server's
 * `/exchanges/61` notification link to the listing screen, which asked for listing 61,
 * got a 404, and showed the provider "Listing not found" as their only route into the
 * request they had just been notified about.
 *
 * State machine, from `App\Services\ExchangeWorkflowService::TRANSITIONS`:
 *
 *   pending_provider ──accept (PROVIDER only)──▶ accepted ──start (either)──▶ in_progress
 *   in_progress ──complete (either)──▶ pending_confirmation ──confirm ×2──▶ completed
 *
 * `confirm` is also accepted from `in_progress`, both parties must confirm, and the SECOND
 * confirmation is what moves the credits. If the two confirmations disagree beyond the
 * tenant's variance the exchange goes to `disputed` for a broker instead of completing.
 * `pending_broker` exists when the community requires broker approval. `decline` is
 * provider-only; `cancel` is either party.
 */

import { api } from './client';

const API_V2 = '/api/v2';

export type ExchangeRequestStatus =
  | 'pending_provider'
  | 'pending_broker'
  | 'accepted'
  | 'in_progress'
  | 'pending_confirmation'
  | 'completed'
  | 'disputed'
  | 'cancelled'
  | 'expired';

export interface ExchangeParty {
  id: number;
  name: string | null;
  avatar: string | null;
}

export interface ExchangeRequestListing {
  id: number;
  title: string | null;
  type: string | null;
}

export interface ExchangeRequestHistoryEntry {
  action: string;
  actor_role: string | null;
  actor_name: string | null;
  old_status: string | null;
  new_status: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface ExchangeRequest {
  id: number;
  listing_id: number;
  requester_id: number;
  provider_id: number;
  listing: ExchangeRequestListing;
  requester: ExchangeParty;
  provider: ExchangeParty;
  proposed_hours: number;
  prep_time: number | null;
  final_hours: number | null;
  status: ExchangeRequestStatus;
  risk_level: string | null;
  /** The requester's note, sent with the request. */
  message: string | null;
  requester_confirmed_at: string | null;
  requester_confirmed_hours: number | null;
  provider_confirmed_at: string | null;
  provider_confirmed_hours: number | null;
  broker_notes: string | null;
  created_at: string | null;
  /** Present on the detail response only. */
  status_history?: ExchangeRequestHistoryEntry[];
}

/** GET /api/v2/exchanges — the signed-in member's exchanges, newest first. */
export function listExchangeRequests(params?: {
  status?: ExchangeRequestStatus;
  cursor?: string;
  perPage?: number;
}): Promise<{
  data: ExchangeRequest[];
  meta?: { cursor?: string; has_more?: boolean; per_page?: number };
}> {
  const query: Record<string, string> = {};
  if (params?.status) query.status = params.status;
  if (params?.cursor) query.cursor = params.cursor;
  if (params?.perPage) query.per_page = String(params.perPage);

  return api.get<{
    data: ExchangeRequest[];
    meta?: { cursor?: string; has_more?: boolean; per_page?: number };
  }>(`${API_V2}/exchanges`, query);
}

/** GET /api/v2/exchanges/:id — one exchange, with its status history. */
export function getExchangeRequest(id: number): Promise<{ data: ExchangeRequest }> {
  return api.get<{ data: ExchangeRequest }>(`${API_V2}/exchanges/${id}`);
}

/**
 * GET /api/v2/exchanges/needs-attention-count — how many exchanges are waiting on you.
 *
 * Returns zero rather than an error when the community has the workflow switched off, so
 * a caller can show a badge without first asking whether the feature exists.
 */
export function getExchangeRequestsNeedingAttention(): Promise<{
  data: { count: number; items: unknown[] };
}> {
  return api.get<{ data: { count: number; items: unknown[] } }>(
    `${API_V2}/exchanges/needs-attention-count`,
  );
}

/** POST /api/v2/exchanges/:id/accept — PROVIDER only; 403 for anyone else. */
export function acceptExchangeRequest(id: number): Promise<{ data: ExchangeRequest }> {
  return api.post<{ data: ExchangeRequest }>(`${API_V2}/exchanges/${id}/accept`, {});
}

/** POST /api/v2/exchanges/:id/decline — PROVIDER only. */
export function declineExchangeRequest(
  id: number,
  reason?: string,
): Promise<{ data: { message?: string } }> {
  return api.post<{ data: { message?: string } }>(`${API_V2}/exchanges/${id}/decline`, {
    reason: reason ?? '',
  });
}

/** POST /api/v2/exchanges/:id/start — either party, from `accepted`. */
export function startExchangeRequest(id: number): Promise<{ data: ExchangeRequest }> {
  return api.post<{ data: ExchangeRequest }>(`${API_V2}/exchanges/${id}/start`, {});
}

/** POST /api/v2/exchanges/:id/complete — either party, from `in_progress`. */
export function completeExchangeRequest(id: number): Promise<{ data: ExchangeRequest }> {
  return api.post<{ data: ExchangeRequest }>(`${API_V2}/exchanges/${id}/complete`, {});
}

/**
 * POST /api/v2/exchanges/:id/confirm — confirm the hours actually given.
 *
 * 🔴 This is the money step. Both parties confirm; the second confirmation moves the
 * credits inside a database transaction. Errors the caller must be ready to show, because
 * they are ordinary rather than exceptional: `INSUFFICIENT_BALANCE` (422 — the requester
 * cannot cover it, nothing moved) and `EXCHANGE_PARTY_UNAVAILABLE` (409 — one side changed
 * community mid-exchange). `hours` must be greater than zero.
 */
export function confirmExchangeRequest(
  id: number,
  hours: number,
): Promise<{ data: ExchangeRequest & { message?: string } }> {
  return api.post<{ data: ExchangeRequest & { message?: string } }>(
    `${API_V2}/exchanges/${id}/confirm`,
    { hours },
  );
}

/**
 * DELETE /api/v2/exchanges/:id — either party cancels.
 *
 * 🔴 The reason travels as a QUERY parameter, not a body. That was once the only option:
 * `api.delete()` discarded every body it was given, so a `{ reason }` object vanished
 * while the cancellation itself still worked. `api.delete()` now sends `options.body`
 * (added 2026-08-25 for account deletion, which must send a password), but this call
 * stays as it is — Laravel's `input()` reads the query string, the server contract is
 * unchanged, and a reason string is not sensitive. Do not "fix" it into a body without
 * checking the server side first.
 */
export function cancelExchangeRequest(
  id: number,
  reason?: string,
): Promise<{ data: { message?: string } }> {
  const suffix = reason ? `?reason=${encodeURIComponent(reason)}` : '';
  return api.delete<{ data: { message?: string } }>(`${API_V2}/exchanges/${id}${suffix}`);
}

/**
 * What a member can say went wrong — journey 3.20.
 *
 * 🔴 This list must stay identical to `ExchangeWorkflowService::DISPUTE_REASONS`. The
 * server refuses anything else with a 422, so a mismatch here is a button that always
 * fails. The codes are what get stored; the labels are translated in the screen.
 */
export const DISPUTE_REASONS = ['hours', 'no_show', 'quality', 'conduct', 'other'] as const;

export type DisputeReason = (typeof DISPUTE_REASONS)[number];

/**
 * POST /api/v2/exchanges/{id}/dispute — report a problem with this exchange.
 *
 * Nothing on the platform could raise a dispute until 2026-08-23: brokers had a
 * resolve-dispute tool with no way for a member to open one. Only the two people in the
 * exchange may call it, and only while the work is under way or awaiting confirmation.
 *
 * The server answers with the updated exchange plus its own `message`, which is already
 * translated for the member's locale — so the screen shows that rather than inventing a
 * second copy of the same sentence.
 */
export function disputeExchangeRequest(
  id: number,
  reason: DisputeReason,
  details?: string,
): Promise<{ data: ExchangeRequest & { message?: string } }> {
  return api.post<{ data: ExchangeRequest & { message?: string } }>(
    `${API_V2}/exchanges/${id}/dispute`,
    { reason, details: details?.trim() || undefined },
  );
}

/**
 * Which actions the signed-in member may take right now.
 *
 * Kept as a pure function beside the client so a screen never has to re-derive the state
 * machine, and so the rules can be tested without rendering anything. It mirrors the
 * server's guards exactly; the server remains the authority and will refuse anything this
 * gets wrong, but a button that appears and then 403s is its own defect.
 */
export interface ExchangeRequestActions {
  canAccept: boolean;
  canDecline: boolean;
  canStart: boolean;
  canComplete: boolean;
  canConfirm: boolean;
  canCancel: boolean;
  /** True when this member has already confirmed and is waiting on the other side. */
  awaitingOtherConfirmation: boolean;
  /**
   * Journey 3.20. Mirrors the server's transition map: a problem can be reported while
   * the work is under way or awaiting confirmation, and not before or after. Before, either
   * side can simply cancel; after completion the credits have moved and only staff can
   * reverse that.
   */
  canReportProblem: boolean;
}

export function exchangeRequestActions(
  exchange: Pick<
    ExchangeRequest,
    | 'status'
    | 'provider_id'
    | 'requester_id'
    | 'provider_confirmed_at'
    | 'requester_confirmed_at'
  >,
  viewerId: number | null | undefined,
): ExchangeRequestActions {
  const none: ExchangeRequestActions = {
    canAccept: false,
    canDecline: false,
    canStart: false,
    canComplete: false,
    canConfirm: false,
    canCancel: false,
    awaitingOtherConfirmation: false,
    canReportProblem: false,
  };

  if (!viewerId) return none;

  const isProvider = exchange.provider_id === viewerId;
  const isRequester = exchange.requester_id === viewerId;
  if (!isProvider && !isRequester) return none;

  const alreadyConfirmed = isProvider
    ? Boolean(exchange.provider_confirmed_at)
    : Boolean(exchange.requester_confirmed_at);

  switch (exchange.status) {
    case 'pending_provider':
      return {
        ...none,
        // Provider-only, and the server enforces it with a 403.
        canAccept: isProvider,
        canDecline: isProvider,
        canCancel: true,
      };
    case 'pending_broker':
      // Waiting on a broker. Either side may still walk away.
      return { ...none, canCancel: true };
    case 'accepted':
      return { ...none, canStart: true, canCancel: true };
    case 'in_progress':
      // The server accepts `confirm` straight from in_progress, so both are offered.
      return {
        ...none,
        canComplete: true,
        canConfirm: !alreadyConfirmed,
        canCancel: true,
        canReportProblem: true,
      };
    case 'pending_confirmation':
      return {
        ...none,
        canConfirm: !alreadyConfirmed,
        awaitingOtherConfirmation: alreadyConfirmed,
        canReportProblem: true,
      };
    case 'disputed':
      // A broker owns it now; confirming again is not the member's move.
      return { ...none, canCancel: true };
    default:
      // completed, cancelled, expired — terminal.
      return none;
  }
}
