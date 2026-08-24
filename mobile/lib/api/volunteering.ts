// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export interface VolunteeringOrganisation {
  id: number;
  name: string;
  avatar?: string | null;
  logo_url?: string | null;
  description?: string | null;
  contact_email?: string | null;
  website?: string | null;
  status?: string;
  member_role?: string;
  balance?: number;
  auto_pay_enabled?: boolean;
}

export interface VolunteerOpportunity {
  id: number;
  title: string;
  description: string | null;
  /**
   * 🔴 The server sends `organization` (US spelling) — measured against
   * `GET /v2/volunteering/opportunities/{id}` on 2026-08-24. This pair was declared the
   * wrong way round: the British spelling was required and the one that arrives was
   * optional. Every screen already reads `organisation ?? organization`, which is the only
   * reason the organisation's name shows at all.
   */
  organisation?: VolunteeringOrganisation | null;
  organization: VolunteeringOrganisation | null;
  location: string | null;
  is_remote: boolean;
  /*
    🔴 These four are NOT in `GET /v2/volunteering/opportunities/{id}` — measured
    2026-08-24. The response carries `start_date`, `end_date`, `shifts` and `skills_needed`
    instead. Every screen that shows them already checks `typeof x === 'number'` first,
    which is the only reason nothing displays "undefined"; declaring them required promised
    a value that never arrives.
  */
  hours_per_week?: number | null;
  commitment?: string | null;
  skills_needed: string[] | string | null;
  status: 'open' | 'closed' | 'filled';
  spots_available?: number | null;
  deadline?: string | null;
  created_at: string;
  has_applied?: boolean;
  is_active?: boolean;
  category?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  shifts?: VolunteerShift[];
  application?: {
    id: number;
    status: 'pending' | 'approved' | 'declined' | string;
    message?: string | null;
    created_at?: string | null;
  } | null;
  is_owner?: boolean;
}

export interface VolunteerShift {
  id: number;
  start_time: string;
  end_time: string;
  capacity: number | null;
  signup_count: number;
  spots_available: number | null;
}

export interface VolunteerShiftRegistration extends VolunteerShift {
  opportunity_id: number;
  opportunity_title: string;
  location: string | null;
  application_id: number;
}

export interface VolunteeringResponse {
  data: VolunteerOpportunity[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface VolunteerApplication {
  id: number;
  status: 'pending' | 'approved' | 'declined';
  message?: string | null;
  opportunity: {
    id: number;
    title: string;
    location?: string | null;
  };
  organization: {
    id: number;
    name: string;
    logo_url?: string | null;
  };
  shift?: {
    id: number;
    start_time: string;
    end_time: string;
  } | null;
  org_note?: string | null;
  created_at: string;
}

export interface OpportunityApplication {
  id: number;
  status: 'pending' | 'approved' | 'declined' | string;
  message?: string | null;
  org_note?: string | null;
  user: {
    id: number;
    name: string;
    email?: string | null;
    avatar_url?: string | null;
  };
  shift?: {
    id?: number;
    start_time: string;
    end_time: string;
  } | null;
  created_at: string;
}

export interface VolunteerApplicationsResponse {
  data: VolunteerApplication[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface OpportunityApplicationsResponse {
  data: {
    items: OpportunityApplication[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface VolunteerHoursSummary {
  total_verified: number;
  total_pending: number;
  total_declined: number;
  by_organization: { name: string; hours: number }[];
  by_month: { month: string; hours: number }[];
}

export interface VolunteerCertificate {
  id: number;
  verification_code: string;
  verification_url: string;
  total_hours: number;
  date_range: {
    start: string;
    end: string;
  };
  organizations: { name: string; hours: number; shifts?: number }[];
  generated_at: string;
  downloaded_at: string | null;
}

export type VolunteerExpenseType = 'travel' | 'meals' | 'supplies' | 'equipment' | 'parking' | 'other';
export type VolunteerExpenseStatus = 'pending' | 'approved' | 'rejected' | 'paid' | string;

export interface VolunteerExpense {
  id: number;
  expense_type: VolunteerExpenseType;
  amount: number | string;
  currency: string;
  description: string;
  status: VolunteerExpenseStatus;
  submitted_at: string;
  reviewed_at?: string | null;
  review_notes?: string | null;
  paid_at?: string | null;
  payment_reference?: string | null;
}

export interface VolunteerGivingDay {
  id: number;
  title: string;
  description?: string | null;
  goal_amount: number | string;
  raised_amount: number | string;
  donor_count?: number;
  start_date: string;
  end_date: string;
  is_active?: boolean;
  status?: 'active' | 'upcoming' | 'ended' | string;
}

export interface VolunteerDonation {
  id: number;
  amount: number | string;
  currency: string;
  payment_method: string;
  payment_reference?: string | null;
  message?: string | null;
  is_anonymous?: boolean;
  status: 'pending' | 'completed' | 'failed' | 'refunded' | string;
  giving_day_id?: number | null;
  opportunity_id?: number | null;
  created_at: string;
}

export type VolunteerSwapStatus = 'pending' | 'accepted' | 'rejected' | 'admin_pending' | 'admin_approved' | 'admin_rejected' | 'cancelled' | 'expired' | string;
export type VolunteerSwapDirection = 'sent' | 'received' | string;

export interface VolunteerSwapShift {
  id: number;
  start_time: string;
  end_time: string;
  opportunity_title: string;
  organization_name: string;
}

export interface VolunteerShiftSwap {
  id: number;
  status: VolunteerSwapStatus;
  direction: VolunteerSwapDirection;
  requester: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  recipient: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  original_shift: VolunteerSwapShift;
  proposed_shift: VolunteerSwapShift;
  message?: string | null;
  created_at: string;
}

export interface VolunteerOrganisationStats {
  total_volunteers: number;
  pending_applications: number;
  pending_hours: number;
  total_approved_hours: number;
  active_opportunities: number;
  wallet_balance: number;
  auto_pay_enabled: boolean;
  org_name: string;
}

export interface OrganisationVolunteerApplication {
  id: number;
  status: 'pending' | 'approved' | 'declined' | string;
  message?: string | null;
  org_note?: string | null;
  created_at: string;
  user: {
    id: number;
    name: string;
    avatar_url?: string | null;
    email?: string | null;
  };
  opportunity: {
    id: number;
    title: string;
  };
  shift?: {
    start_time: string;
    end_time: string;
  } | null;
}

export interface OrganisationApplicationsResponse {
  data: {
    items: OrganisationVolunteerApplication[];
    cursor: string | null;
    has_more: boolean;
  } | OrganisationVolunteerApplication[];
  meta?: {
    cursor: string | null;
    has_more: boolean;
  };
}

export interface OrganisationPendingHour {
  id: number;
  hours: number;
  date: string;
  description?: string | null;
  status: 'pending' | string;
  created_at: string;
  user: {
    id: number;
    name: string;
    avatar_url?: string | null;
  };
  opportunity?: {
    id: number;
    title: string;
  } | null;
}

export interface OrganisationPendingHoursResponse {
  data: {
    items: OrganisationPendingHour[];
    cursor: string | null;
    has_more: boolean;
  } | OrganisationPendingHour[];
  meta?: {
    cursor: string | null;
    has_more: boolean;
  };
}

export interface OrganisationVolunteer {
  id: number;
  name: string;
  avatar_url?: string | null;
  email?: string | null;
  total_hours: number;
  applications_count: number;
  applied_at?: string | null;
}

export interface OrganisationVolunteersResponse {
  data: {
    items: OrganisationVolunteer[];
    cursor: string | null;
    has_more: boolean;
  } | OrganisationVolunteer[];
  meta?: {
    cursor: string | null;
    has_more: boolean;
  };
}

export interface OrganisationWalletTransaction {
  id: number;
  type: string;
  amount: number | string;
  balance_after?: number | string | null;
  note?: string | null;
  created_at: string;
}

export interface OrganisationWalletTransactionsResponse {
  data: {
    items: OrganisationWalletTransaction[];
    cursor: string | null;
    has_more: boolean;
  } | OrganisationWalletTransaction[];
  meta?: {
    cursor: string | null;
    has_more: boolean;
  };
}

export interface MyOrganisationsResponse {
  data: VolunteeringOrganisation[];
  meta: {
    has_more: boolean;
    cursor: string | null;
  };
}

export interface MyShiftsResponse {
  data: {
    items: VolunteerShiftRegistration[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface VolunteerCertificatesResponse {
  data: {
    items: VolunteerCertificate[];
    cursor: string | null;
    has_more: boolean;
  };
}

export interface VolunteerExpensesResponse {
  data: {
    expenses: VolunteerExpense[];
    items: VolunteerExpense[];
    stats: {
      total_submitted: number;
      pending_review: number;
      approved_total: number;
      paid_total: number;
    };
    cursor: string | null;
    has_more: boolean;
  };
}

export interface VolunteerDonationsResponse {
  data: {
    items: VolunteerDonation[];
    next_cursor?: number | null;
  };
}

export type VolunteerGivingDaysResponse = { data: VolunteerGivingDay[] };

export type VolunteerShiftSwapsResponse = { data: VolunteerShiftSwap[] | { swaps?: VolunteerShiftSwap[] } };

export interface SubmitVolunteerDonationPayload {
  giving_day_id?: number | null;
  amount: number;
  currency?: string;
  payment_method: 'bank_transfer' | 'cash' | 'card' | 'paypal' | string;
  message?: string | null;
  is_anonymous?: boolean;
}

export interface SubmitVolunteerExpensePayload {
  organization_id: number;
  expense_type: VolunteerExpenseType;
  amount: number;
  currency?: string;
  description: string;
}

export interface CreateOpportunityPayload {
  organization_id: number;
  title: string;
  description: string;
  location?: string | null;
  is_remote?: boolean;
  skills_needed?: string;
  start_date?: string | null;
  end_date?: string | null;
  category_id?: number | null;
}

export type UpdateOpportunityPayload = Omit<CreateOpportunityPayload, 'organization_id'>;

/**
 * GET /api/v2/volunteering/opportunities — list volunteering opportunities for the current tenant.
 * Supports cursor-based pagination and optional full-text search.
 */
export function getOpportunities(
  cursor: string | null,
  search?: string,
): Promise<VolunteeringResponse> {
  return api.get<VolunteeringResponse>(`${API_V2}/volunteering/opportunities`, {
    ...(cursor ? { cursor } : {}),
    ...(search ? { search } : {}),
  });
}

/**
 * GET /api/v2/volunteering/opportunities/{id} — get a single volunteering opportunity by ID.
 */
export function getOpportunity(id: number): Promise<{ data: VolunteerOpportunity }> {
  return api.get<{ data: VolunteerOpportunity }>(`${API_V2}/volunteering/opportunities/${id}`);
}

/**
 * POST /api/v2/volunteering/opportunities/{id}/apply — apply for an opportunity.
 */
export function getMyApplications(status?: string): Promise<VolunteerApplicationsResponse> {
  return api.get<VolunteerApplicationsResponse>(`${API_V2}/volunteering/applications`, {
    per_page: '20',
    ...(status ? { status } : {}),
  });
}

export function getOpportunityApplications(
  opportunityId: number,
  status?: string,
): Promise<OpportunityApplicationsResponse> {
  return api.get<OpportunityApplicationsResponse>(
    `${API_V2}/volunteering/opportunities/${opportunityId}/applications`,
    {
      per_page: '20',
      ...(status ? { status } : {}),
    },
  );
}

export function handleVolunteerApplication(
  id: number,
  action: 'approve' | 'decline',
): Promise<{ data: unknown }> {
  return api.put<{ data: unknown }>(`${API_V2}/volunteering/applications/${id}`, { action });
}

export function verifyVolunteerHours(id: number, action: 'approve' | 'decline'): Promise<{ data: unknown }> {
  return api.put<{ data: unknown }>(`${API_V2}/volunteering/hours/${id}/verify`, { action });
}

export function withdrawApplication(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/applications/${id}`);
}

export function getHoursSummary(): Promise<{ data: VolunteerHoursSummary }> {
  return api.get<{ data: VolunteerHoursSummary }>(`${API_V2}/volunteering/hours/summary`);
}

export function getMyOrganisations(): Promise<MyOrganisationsResponse> {
  return api.get<MyOrganisationsResponse>(`${API_V2}/volunteering/my-organisations`, { per_page: '50' });
}

export function getOrganisation(id: number): Promise<{ data: VolunteeringOrganisation }> {
  return api.get<{ data: VolunteeringOrganisation }>(`${API_V2}/volunteering/organisations/${id}`);
}

export function getOrganisationStats(id: number): Promise<{ data: VolunteerOrganisationStats }> {
  return api.get<{ data: VolunteerOrganisationStats }>(`${API_V2}/volunteering/organisations/${id}/stats`);
}

export function getOrganisationApplications(
  id: number,
  status?: 'pending' | 'approved' | 'declined' | 'all',
): Promise<OrganisationApplicationsResponse> {
  return api.get<OrganisationApplicationsResponse>(`${API_V2}/volunteering/organisations/${id}/applications`, {
    per_page: '20',
    ...(status && status !== 'all' ? { status } : {}),
  });
}

export function getOrganisationPendingHours(id: number): Promise<OrganisationPendingHoursResponse> {
  return api.get<OrganisationPendingHoursResponse>(`${API_V2}/volunteering/organisations/${id}/hours/pending`, {
    per_page: '20',
  });
}

export function getOrganisationVolunteers(id: number): Promise<OrganisationVolunteersResponse> {
  return api.get<OrganisationVolunteersResponse>(`${API_V2}/volunteering/organisations/${id}/volunteers`, {
    per_page: '20',
  });
}

export function getOrganisationWalletTransactions(id: number): Promise<OrganisationWalletTransactionsResponse> {
  return api.get<OrganisationWalletTransactionsResponse>(`${API_V2}/volunteering/organisations/${id}/wallet/transactions`, {
    per_page: '20',
  });
}

export function depositOrganisationWallet(id: number, amount: number, note?: string): Promise<{ data: { message: string; new_balance: number } }> {
  return api.post<{ data: { message: string; new_balance: number } }>(`${API_V2}/volunteering/organisations/${id}/wallet/deposit`, {
    amount,
    ...(note ? { note } : {}),
  });
}

export function updateOrganisation(id: number, payload: {
  name?: string;
  description?: string | null;
  contact_email?: string | null;
  website?: string | null;
}): Promise<{ data: VolunteeringOrganisation }> {
  return api.put<{ data: VolunteeringOrganisation }>(`${API_V2}/volunteering/organisations/${id}`, payload);
}

export function getMyShifts(): Promise<MyShiftsResponse> {
  return api.get<MyShiftsResponse>(`${API_V2}/volunteering/shifts`, { per_page: '20' });
}

export function getVolunteerCertificates(): Promise<VolunteerCertificatesResponse> {
  return api.get<VolunteerCertificatesResponse>(`${API_V2}/volunteering/certificates`, { per_page: '20' });
}

export function generateVolunteerCertificate(): Promise<{ data: VolunteerCertificate }> {
  return api.post<{ data: VolunteerCertificate }>(`${API_V2}/volunteering/certificates`, {});
}

export function getVolunteerExpenses(): Promise<VolunteerExpensesResponse> {
  return api.get<VolunteerExpensesResponse>(`${API_V2}/volunteering/expenses`, { per_page: '20' });
}

export function submitVolunteerExpense(payload: SubmitVolunteerExpensePayload): Promise<{ data: VolunteerExpense }> {
  return api.post<{ data: VolunteerExpense }>(`${API_V2}/volunteering/expenses`, payload);
}

export function getVolunteerGivingDays(): Promise<VolunteerGivingDaysResponse> {
  return api.get<VolunteerGivingDaysResponse>(`${API_V2}/volunteering/giving-days`, {});
}

export function getVolunteerDonations(): Promise<VolunteerDonationsResponse> {
  return api.get<VolunteerDonationsResponse>(`${API_V2}/volunteering/donations`, { per_page: '20' });
}

export function getShiftSwaps(direction: 'all' | 'sent' | 'received' = 'all'): Promise<VolunteerShiftSwapsResponse> {
  return api.get<VolunteerShiftSwapsResponse>(`${API_V2}/volunteering/swaps`, {
    ...(direction !== 'all' ? { direction } : {}),
  });
}

export function respondToShiftSwap(id: number, action: 'accept' | 'reject'): Promise<{ data: unknown }> {
  return api.put<{ data: unknown }>(`${API_V2}/volunteering/swaps/${id}`, { action });
}

export function cancelShiftSwap(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/swaps/${id}`);
}

export function submitVolunteerDonation(payload: SubmitVolunteerDonationPayload): Promise<{ data: VolunteerDonation }> {
  return api.post<{ data: VolunteerDonation }>(`${API_V2}/volunteering/donations`, payload);
}

export function createOpportunity(payload: CreateOpportunityPayload): Promise<{ data: VolunteerOpportunity }> {
  return api.post<{ data: VolunteerOpportunity }>(`${API_V2}/volunteering/opportunities`, payload);
}

export function updateOpportunity(id: number, payload: UpdateOpportunityPayload): Promise<{ data: VolunteerOpportunity }> {
  return api.put<{ data: VolunteerOpportunity }>(`${API_V2}/volunteering/opportunities/${id}`, payload);
}

export function logVolunteerHours(payload: {
  organization_id: number;
  date: string;
  hours: number;
  description?: string;
}): Promise<{ data: { id: number; status: string; message: string } }> {
  return api.post<{ data: { id: number; status: string; message: string } }>(`${API_V2}/volunteering/hours`, payload);
}

export function expressInterest(id: number, message?: string): Promise<{ message: string }> {
  return api.post<{ message: string }>(`${API_V2}/volunteering/opportunities/${id}/apply`, message ? { message } : {});
}

export function signUpForShift(id: number): Promise<{ data: { shift_id: number; message: string } }> {
  return api.post<{ data: { shift_id: number; message: string } }>(`${API_V2}/volunteering/shifts/${id}/signup`, {});
}

export function cancelShiftSignup(id: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/shifts/${id}/signup`);
}
