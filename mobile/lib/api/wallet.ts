// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TransactionOtherUser {
  id: number | string;
  name: string;
  avatar_url: string | null;
}

/**
 * A single wallet transaction as returned by GET /api/v2/wallet/transactions.
 *
 * - type 'credit'  → the current user *received* time credits
 * - type 'debit'   → the current user *sent* time credits
 */
export interface TransactionItem {
  id: number | string;
  source?: 'native' | 'federation' | string;
  type: 'credit' | 'debit';
  amount: number;
  description: string | null;
  other_user?: TransactionOtherUser | null;
  other_party?: {
    id?: number | string;
    name?: string | null;
  } | null;
  created_at: string;
  status: string;
  transaction_type: string;
  category_id: number | null;
  federation?: {
    transaction_id?: number;
    partner_id?: number;
    partner_name?: string | null;
    external_sender_name?: string | null;
  } | null;
}

/**
 * A single transaction, from `GET /v2/wallet/transactions/{id}`.
 *
 * 🔴 This endpoint existed and NOTHING called it — not the app and not the website — so a
 * member could see a list of their time credits and never open one. Recorded as journey
 * 6.12 on 2026-08-22 and built on 2026-08-23.
 *
 * Fields copied from the live response, not from what a screen would like: it carries both
 * `sender` and `receiver` as well as the viewer-relative `other_user`, and `balance_after`
 * is genuinely null for older rows. A negative id addresses a `federation_transactions`
 * row (see `WalletController::showTransaction`), which is why the id is a number here and
 * may be negative.
 */
/**
 * 🔴 `avatar`, not `avatar_url`. The list endpoint sends `avatar_url`; this one sends
 * `avatar`. Typing the parties as `TransactionOtherUser` — which requires `avatar_url` —
 * would have declared a field the server never sends on this route, which is the exact
 * fault that crashed the Matches screen. Caught while writing this by reading the live
 * response instead of the neighbouring type.
 */
export interface WalletTransactionParty {
  id: number | string;
  name: string;
  avatar?: string | null;
  avatar_url?: string | null;
}

export interface WalletTransactionDetail {
  id: number;
  type: 'credit' | 'debit';
  status: string;
  amount: number;
  description: string | null;
  transaction_type: string;
  sender?: WalletTransactionParty | null;
  receiver?: WalletTransactionParty | null;
  other_user?: WalletTransactionParty | null;
  balance_after?: number | null;
  created_at: string;
  federation?: {
    partner_id?: number;
    partner_name?: string | null;
  } | null;
}

export interface WalletTransactionsResponse {
  data: TransactionItem[];
  meta: {
    per_page: number;
    has_more: boolean;
    cursor?: string;
  };
}

export interface WalletBalance {
  balance: number;
  total_credits: number;
  total_debits: number;
  total_earned?: number;
  total_spent?: number;
  pending_in?: number;
  pending_out?: number;
  pending_incoming?: number;
  pending_outgoing?: number;
  currency: string;
}

export interface WalletBalanceResponse {
  data: WalletBalance;
}

export interface CommunityFundBalance {
  balance: number;
  total_deposited?: number;
  total_withdrawn?: number;
  total_donated?: number;
}

export interface CommunityFundResponse {
  data: CommunityFundBalance;
}

export interface WalletUserSearchResult {
  id: number | string;
  name: string;
  username?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  location?: string | null;
  balance?: number | null;
}

export interface WalletUserSearchResponse {
  data: {
    users: WalletUserSearchResult[];
  };
}

export interface WalletTransferPayload {
  recipient: number | string;
  amount: number;
  description: string;
}

export interface WalletDonatePayload {
  recipient_type: 'community_fund' | 'user';
  recipient_id?: number | string;
  amount: number;
  message: string;
}

export interface WalletMutationResponse {
  success?: boolean;
  message?: string;
  data?: TransactionItem | Record<string, unknown> | null;
}

// ─── API Functions ────────────────────────────────────────────────────────────

/**
 * GET /api/v2/wallet/balance
 * Returns the current user's time-credit balance with lifetime stats.
 */
export function getWalletBalance(): Promise<WalletBalanceResponse> {
  return api.get<WalletBalanceResponse>(`${API_V2}/wallet/balance`);
}

/**
 * GET /api/v2/wallet/transactions
 * Returns cursor-paginated transaction history for the current user.
 *
 * @param cursor  Opaque cursor string from the previous page's meta
 * @param perPage Number of items per page (default 20, max 100)
 * @param type    Filter: 'all' | 'sent' | 'received'
 */
/** GET /api/v2/wallet/transactions/{id} — one transaction, for the detail screen. */
export function getWalletTransaction(id: number): Promise<{ data: WalletTransactionDetail }> {
  return api.get<{ data: WalletTransactionDetail }>(`${API_V2}/wallet/transactions/${id}`);
}

export function getWalletTransactions(
  cursor?: string,
  perPage = 20,
  type: 'all' | 'sent' | 'received' | 'pending' = 'all',
): Promise<WalletTransactionsResponse> {
  const params: Record<string, string> = {
    per_page: String(perPage),
    type,
  };
  if (cursor) {
    params.cursor = cursor;
  }
  return api.get<WalletTransactionsResponse>(`${API_V2}/wallet/transactions`, params);
}

/**
 * GET /api/v2/wallet/community-fund
 * Returns tenant-level community fund balance and totals.
 */
export function getCommunityFundBalance(): Promise<CommunityFundResponse> {
  return api.get<CommunityFundResponse>(`${API_V2}/wallet/community-fund`);
}

/**
 * GET /api/v2/wallet/user-search
 * Searches members who can receive time credits.
 */
export function searchWalletUsers(query: string, limit = 10): Promise<WalletUserSearchResponse> {
  return api.get<WalletUserSearchResponse>(`${API_V2}/wallet/user-search`, {
    q: query,
    limit: String(limit),
  });
}

/**
 * POST /api/v2/wallet/transfer
 * Sends time credits to another member.
 */
export function transferWalletCredits(payload: WalletTransferPayload): Promise<WalletMutationResponse> {
  return api.post<WalletMutationResponse>(`${API_V2}/wallet/transfer`, payload);
}

/**
 * POST /api/v2/wallet/donate
 * Donates time credits to the community fund or another member.
 */
export function donateWalletCredits(payload: WalletDonatePayload): Promise<WalletMutationResponse> {
  return api.post<WalletMutationResponse>(`${API_V2}/wallet/donate`, payload);
}
