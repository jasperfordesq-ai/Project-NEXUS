// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

export type FundraisingActorKind = 'community_admin' | 'org_admin' | 'member' | 'stripe' | 'system';

export interface HistoryItem {
  id: number;
  event: string;
  actor_kind: FundraisingActorKind;
  actor_name: string | null;
  amount: number | null;
  currency: string | null;
  donation_id: number | null;
  handover_id: number | null;
  details: { changes?: Record<string, { from: string | number | null; to: string | number | null }>; reason?: string } | null;
  stripe_object_id: string | null;
  created_at: string;
}

export type HandoverStatus = 'recorded' | 'confirmed' | 'cancelled';
export type HandoverMethod = 'bank_transfer' | 'cheque' | 'cash' | 'other';

export interface Handover {
  id: number;
  giving_day_id: number;
  organization_id: number;
  amount: number;
  currency: string;
  handed_over_on: string;
  method: HandoverMethod;
  reference: string;
  note: string | null;
  status: HandoverStatus;
  recorded_by_name: string | null;
  created_at: string;
  confirmed_by_name: string | null;
  confirmed_at: string | null;
  cancelled_by_name: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface HandoverSummary { raised: number; handed_over: number; still_held: number; currency: string }
export interface HandoverListData { items: Handover[]; summary: HandoverSummary }

export interface CampaignGift {
  id: number;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: 'pending' | 'completed' | 'refunded' | 'failed';
  created_at: string;
  display_name: string | null;
  payment_method: 'card' | 'pledge';
}
