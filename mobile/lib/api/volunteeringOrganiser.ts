// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The ORGANISER side of volunteering: the calls a person who runs an opportunity or an
 * organisation makes. The member side (applying, signing up, logging hours, claiming an
 * expense) stays in `lib/api/volunteering.ts`; this module only imports types from it.
 *
 * Every path here mirrors what the website already sends, so the two clients agree:
 *   react-frontend/src/components/volunteering/ShiftManager.tsx
 *   react-frontend/src/components/volunteering/ShiftRosterModal.tsx
 *   react-frontend/src/pages/volunteering/OrgExpensesTab.tsx
 *   react-frontend/src/pages/volunteering/OrgFundraisingTab.tsx
 *   react-frontend/src/pages/volunteering/OrgOpportunitiesTab.tsx
 *
 * Shift times are the community's local wall-clock time, "YYYY-MM-DD HH:mm:ss", the
 * same form every existing shift is stored in. A pattern's times are clock times
 * ("HH:mm:ss") and its dates are "YYYY-MM-DD".
 */

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import { downloadAuthenticatedFile } from '@/lib/volunteering/authenticatedFileDownload';

/* ───────────────────────── Opportunities ───────────────────────── */

export type OrgOpportunityState = 'open' | 'closed' | 'cancelled';

export interface OrgOpportunity {
  id: number;
  title: string;
  state: OrgOpportunityState;
  location: string | null;
  is_remote: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at?: string | null;
  pending_applications: number;
  approved_volunteers: number;
  upcoming_shifts: number;
}

/** GET /v2/volunteering/organisations/{id}/opportunities — open, closed and cancelled, newest first. */
export function getOrganisationOpportunities(orgId: number): Promise<{ data: { items?: OrgOpportunity[] } | OrgOpportunity[] }> {
  return api.get<{ data: { items?: OrgOpportunity[] } | OrgOpportunity[] }>(`${API_V2}/volunteering/organisations/${orgId}/opportunities`);
}

/**
 * DELETE /v2/volunteering/opportunities/{id} — the server soft-deletes (is_active = 0),
 * answers 204, and refuses with 403 when the caller does not manage it.
 */
export function deleteOpportunity(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/opportunities/${id}`);
}

/* ───────────────────────── Shifts ───────────────────────── */

export interface ManagedShift {
  id: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  signup_count: number;
  reserved_count?: number;
  spots_available: number | null;
  recurring_pattern_id?: number | null;
}

export interface ShiftPayload {
  /** "YYYY-MM-DD HH:mm:ss" in the community's local time. */
  start_time: string;
  end_time: string;
  /** null = no limit. */
  capacity: number | null;
}

/** GET /v2/volunteering/opportunities/{id}/shifts — capacity and counts, no names. */
export function getManagedShifts(opportunityId: number): Promise<{ data: ManagedShift[] | { shifts?: ManagedShift[] } }> {
  return api.get<{ data: ManagedShift[] | { shifts?: ManagedShift[] } }>(`${API_V2}/volunteering/opportunities/${opportunityId}/shifts`);
}

/** POST /v2/volunteering/opportunities/{id}/shifts */
export function createShift(opportunityId: number, payload: ShiftPayload): Promise<{ data: ManagedShift }> {
  return api.post<{ data: ManagedShift }>(`${API_V2}/volunteering/opportunities/${opportunityId}/shifts`, payload);
}

/** PUT /v2/volunteering/shifts/{id} — refused once the shift has started, or when capacity is below the places taken. */
export function updateShift(shiftId: number, payload: Partial<ShiftPayload>): Promise<{ data: ManagedShift }> {
  return api.put<{ data: ManagedShift }>(`${API_V2}/volunteering/shifts/${shiftId}`, payload);
}

/**
 * DELETE /v2/volunteering/shifts/{id} — volunteers who held a place keep their
 * application and are told; the server refuses once the shift has started.
 */
export function deleteShift(shiftId: number): Promise<{ data: { deleted: boolean; affected_volunteers: number } }> {
  return api.delete<{ data: { deleted: boolean; affected_volunteers: number } }>(`${API_V2}/volunteering/shifts/${shiftId}`);
}

/* ───────────────────────── Repeating patterns ───────────────────────── */

export type PatternFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface RecurringPattern {
  id: number;
  opportunity_id?: number;
  title: string | null;
  frequency: PatternFrequency;
  /** ISO weekday numbers, Monday = 1 … Sunday = 7. */
  days_of_week: number[];
  /** "HH:mm:ss" */
  start_time: string;
  end_time: string;
  capacity: number;
  /** "YYYY-MM-DD" */
  start_date: string;
  end_date: string | null;
  max_occurrences: number | null;
  occurrences_generated: number;
  is_active: boolean;
}

export interface PatternPayload {
  frequency: PatternFrequency;
  /** Required for weekly and biweekly; the server refuses an empty list for those. */
  days_of_week?: number[];
  /** "HH:mm:ss" */
  start_time: string;
  end_time: string;
  capacity: number;
  start_date: string;
  end_date?: string | null;
  max_occurrences?: number | null;
}

/** What the server reports after it applied a pattern change to its future shifts. */
export interface PatternReconciliation {
  shifts_removed?: number;
  shifts_kept?: number;
  shifts_generated?: number;
}

/** GET /v2/volunteering/opportunities/{id}/recurring-patterns — 403 FEATURE_DISABLED when the community has repeating shifts off. */
export function getRecurringPatterns(opportunityId: number): Promise<{ data: { patterns?: RecurringPattern[] } | RecurringPattern[] }> {
  return api.get<{ data: { patterns?: RecurringPattern[] } | RecurringPattern[] }>(`${API_V2}/volunteering/opportunities/${opportunityId}/recurring-patterns`);
}

/** POST /v2/volunteering/opportunities/{id}/recurring-patterns — creates the first 14 days of shifts straight away. */
export function createRecurringPattern(opportunityId: number, payload: PatternPayload): Promise<{ data: RecurringPattern & PatternReconciliation }> {
  return api.post<{ data: RecurringPattern & PatternReconciliation }>(`${API_V2}/volunteering/opportunities/${opportunityId}/recurring-patterns`, payload);
}

/**
 * PUT /v2/volunteering/recurring-patterns/{id} — a change to WHEN it repeats is applied to
 * the future shifts now; the answer then carries shifts_removed / shifts_kept /
 * shifts_generated so the organiser can be told what happened.
 */
export function updateRecurringPattern(patternId: number, payload: Partial<PatternPayload>): Promise<{ data: RecurringPattern & PatternReconciliation }> {
  return api.put<{ data: RecurringPattern & PatternReconciliation }>(`${API_V2}/volunteering/recurring-patterns/${patternId}`, payload);
}

/** DELETE /v2/volunteering/recurring-patterns/{id} — stops it and removes the shifts that have not started. */
export function deactivateRecurringPattern(patternId: number): Promise<{ data: { message?: string; future_shifts_removed: number } }> {
  return api.delete<{ data: { message?: string; future_shifts_removed: number } }>(`${API_V2}/volunteering/recurring-patterns/${patternId}`);
}

/* ───────────────────────── Roster and check-ins ───────────────────────── */

export interface RosterPerson {
  id: number;
  name: string;
  avatar_url?: string | null;
}

export type RosterCheckInStatus = 'pending' | 'checked_in' | 'checked_out' | 'no_show' | null;

export interface ShiftRoster {
  shift?: { id: number; start_time: string; end_time: string; capacity?: number | null };
  summary: { signed_up: number; checked_in: number; no_show: number; group_places: number; waiting: number };
  volunteers: { user: RosterPerson; check_in_status: RosterCheckInStatus; checked_in_at: string | null; checked_out_at: string | null }[];
  groups: { id: number; group_name: string; reserved_slots: number; leader: RosterPerson | null; members: RosterPerson[] }[];
  waitlist: { user: RosterPerson; position: number }[];
}

export interface ShiftCheckIn {
  id: number;
  user: RosterPerson;
  status: string;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

/** GET /v2/volunteering/shifts/{id}/roster — managers only. */
export function getShiftRoster(shiftId: number): Promise<{ data: ShiftRoster }> {
  return api.get<{ data: ShiftRoster }>(`${API_V2}/volunteering/shifts/${shiftId}/roster`);
}

/** GET /v2/volunteering/shifts/{id}/checkins — the check-in log, managers only. */
export function getShiftCheckIns(shiftId: number): Promise<{ data: { checkins?: ShiftCheckIn[] } | ShiftCheckIn[] }> {
  return api.get<{ data: { checkins?: ShiftCheckIn[] } | ShiftCheckIn[] }>(`${API_V2}/volunteering/shifts/${shiftId}/checkins`);
}

/* ───────────────────────── Expense review ───────────────────────── */

export type OrgExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid';
export type OrgExpenseReviewAction = 'approved' | 'rejected' | 'paid';

export interface OrgExpense {
  id: number;
  user_id: number;
  volunteer_name: string;
  avatar_url: string | null;
  organization_id: number;
  opportunity_id: number | null;
  expense_type: string;
  amount: number | string;
  currency: string | null;
  description: string | null;
  status: OrgExpenseStatus;
  has_receipt: boolean;
  submitted_at: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_notes: string | null;
  paid_at: string | null;
  payment_reference: string | null;
}

export interface OrgExpenseStats {
  total_submitted: number;
  pending_review: number;
  approved_total: number;
  paid_total: number;
}

export interface OrgExpensesResponse {
  data: {
    items?: OrgExpense[];
    stats?: OrgExpenseStats;
    cursor?: string | null;
    has_more?: boolean;
  };
}

/**
 * The next steps the server accepts — anything else only earns a refusal. The same
 * table as the website: pending → approve / reject, approved → mark paid, the rest final.
 */
export const ORG_EXPENSE_ACTIONS: Record<OrgExpenseStatus, OrgExpenseReviewAction[]> = {
  pending: ['approved', 'rejected'],
  approved: ['paid'],
  rejected: [],
  paid: [],
};

/** GET /v2/volunteering/organisations/{id}/expenses — organisation owners and admins only. */
export function getOrganisationExpenses(orgId: number, status?: OrgExpenseStatus | 'all', cursor?: string | null): Promise<OrgExpensesResponse> {
  return api.get<OrgExpensesResponse>(`${API_V2}/volunteering/organisations/${orgId}/expenses`, {
    per_page: '20',
    ...(status && status !== 'all' ? { status } : {}),
    ...(cursor ? { cursor } : {}),
  });
}

/**
 * PUT /v2/volunteering/organisations/{id}/expenses/{expenseId}
 * 409 INVALID_STATE when somebody else moved the claim on first; 403 on your own claim.
 */
export function reviewOrganisationExpense(
  orgId: number,
  expenseId: number,
  action: OrgExpenseReviewAction,
  extra?: { review_notes?: string; payment_reference?: string },
): Promise<{ data: { success: boolean } }> {
  const notes = extra?.review_notes?.trim();
  const reference = extra?.payment_reference?.trim();
  return api.put<{ data: { success: boolean } }>(`${API_V2}/volunteering/organisations/${orgId}/expenses/${expenseId}`, {
    status: action,
    ...(notes ? { review_notes: notes } : {}),
    ...(action === 'paid' && reference ? { payment_reference: reference } : {}),
  });
}

/**
 * GET /v2/volunteering/organisations/{id}/expenses/{expenseId}/receipt — the bytes live on
 * a private disk behind the bearer token, so the file is fetched with the session's
 * headers and handed to the share sheet (a plain link would open an "Unauthenticated" page).
 */
export function downloadOrganisationExpenseReceipt(orgId: number, expenseId: number, options: { isActive?: () => boolean } = {}): Promise<void> {
  return downloadAuthenticatedFile(
    `${API_V2}/volunteering/organisations/${orgId}/expenses/${expenseId}/receipt`,
    `receipt-${expenseId}`,
    {},
    options,
  );
}

/* ───────────────────────── Fundraising ───────────────────────── */

export type OrgCampaignStatus = 'active' | 'upcoming' | 'paused' | 'ended';

export interface OrgCampaign {
  id: number;
  title?: string;
  name?: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  goal_amount?: string | number;
  target_amount?: number;
  raised_amount?: number | string;
  is_active: boolean | number;
  status?: string;
  organization_id?: number;
}

export interface OrgCampaignPayload {
  title?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  goal_amount?: number;
  is_active?: boolean;
}

export interface CampaignGift {
  id: number;
  amount: number;
  amount_refunded: number;
  currency: string;
  status: 'pending' | 'completed' | 'refunded' | 'failed' | string;
  created_at: string;
  /** null = the giver chose to stay anonymous. */
  display_name: string | null;
  payment_method: 'card' | 'pledge' | string;
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
  method: HandoverMethod | string;
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

export interface HandoverListData {
  items: Handover[];
  summary: { raised: number; handed_over: number; still_held: number; currency: string };
}

export interface CampaignHistoryItem {
  id: number;
  event: string;
  actor_kind: 'community_admin' | 'org_admin' | 'member' | 'stripe' | 'system' | string;
  actor_name: string | null;
  amount: number | null;
  currency: string | null;
  donation_id: number | null;
  handover_id: number | null;
  details: {
    changes?: Record<string, { from: string | number | null; to: string | number | null; from_label?: string | null; to_label?: string | null }>;
    reason?: string;
  } | null;
  created_at: string;
}

/** The website's reading of a campaign's state, so both clients label it the same way. */
export function campaignStatus(campaign: Pick<OrgCampaign, 'status' | 'is_active'>): OrgCampaignStatus {
  const status = campaign.status;
  if (status === 'active' || status === 'upcoming' || status === 'paused' || status === 'ended') return status;
  return campaign.is_active ? 'active' : 'ended';
}

/** GET /v2/volunteering/organisations/{id}/campaigns */
export function getOrganisationCampaigns(orgId: number): Promise<{ data: { items?: OrgCampaign[] } | OrgCampaign[] }> {
  return api.get<{ data: { items?: OrgCampaign[] } | OrgCampaign[] }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns`);
}

/** POST /v2/volunteering/organisations/{id}/campaigns — live straight away; 422 when the organisation is not approved. */
export function createOrganisationCampaign(orgId: number, payload: OrgCampaignPayload): Promise<{ data: OrgCampaign }> {
  return api.post<{ data: OrgCampaign }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns`, payload);
}

/** PUT /v2/volunteering/organisations/{id}/campaigns/{campaignId} — also pauses, resumes and ends (is_active / end_date). */
export function updateOrganisationCampaign(orgId: number, campaignId: number, payload: OrgCampaignPayload): Promise<{ data: { success: boolean } }> {
  return api.put<{ data: { success: boolean } }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns/${campaignId}`, payload);
}

/** GET …/campaigns/{campaignId}/gifts — never carries donor contact or Gift Aid details. */
export function getCampaignGifts(orgId: number, campaignId: number): Promise<{ data: { items?: CampaignGift[] } | CampaignGift[] }> {
  return api.get<{ data: { items?: CampaignGift[] } | CampaignGift[] }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns/${campaignId}/gifts`);
}

/** GET …/campaigns/{campaignId}/history */
export function getCampaignHistory(orgId: number, campaignId: number): Promise<{ data: { items?: CampaignHistoryItem[] } | CampaignHistoryItem[] }> {
  return api.get<{ data: { items?: CampaignHistoryItem[] } | CampaignHistoryItem[] }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns/${campaignId}/history`);
}

/** GET …/campaigns/{campaignId}/handovers */
export function getCampaignHandovers(orgId: number, campaignId: number): Promise<{ data: HandoverListData }> {
  return api.get<{ data: HandoverListData }>(`${API_V2}/volunteering/organisations/${orgId}/campaigns/${campaignId}/handovers`);
}

/** POST /v2/volunteering/organisations/{id}/handovers/{handoverId}/confirm */
export function confirmHandover(orgId: number, handoverId: number): Promise<{ data: unknown }> {
  return api.post<{ data: unknown }>(`${API_V2}/volunteering/organisations/${orgId}/handovers/${handoverId}/confirm`, {});
}

/* ───────────────────────── Shared unwrapping ───────────────────────── */

/** Lists arrive either bare or under a named key; accept both without a screen guessing. */
export function unwrapList<T>(raw: unknown, key: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  const inner = (raw as Record<string, unknown> | null | undefined)?.[key];
  return Array.isArray(inner) ? (inner as T[]) : [];
}

/* ───────────────────────── Shift time helpers ───────────────────────── */

/** The server returns naive local times; parse "YYYY-MM-DD HH:mm:ss" as local, like the website. */
export function shiftTimeToDate(value: string): Date {
  return new Date(value.includes('T') ? value : value.replace(' ', 'T'));
}

/** "YYYY-MM-DD" → true only for a real calendar date (no 31 February). */
export function isValidDateOnly(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** "H:MM" or "HH:MM" (or with seconds) → "HH:MM", or null when it is not a clock time. */
export function normaliseClock(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A stored shift time → the "YYYY-MM-DD" and "HH:MM" the form fields hold. */
export function splitShiftTime(value: string): { date: string; clock: string } {
  const d = shiftTimeToDate(value);
  if (Number.isNaN(d.getTime())) return { date: value.slice(0, 10), clock: value.slice(11, 16) };
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    clock: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

/** Today as "YYYY-MM-DD" in the device's local time. */
export function todayDateOnly(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
