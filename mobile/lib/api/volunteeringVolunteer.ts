// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The VOLUNTEER side of volunteering that the app lacked until 2026-10-08 (gap M3):
 * waiting lists, the member's own check-in code, wellbeing check-ins, urgent shift
 * requests, the qualifications register, safeguarding concerns, accessibility needs,
 * group sign-ups and expense receipts.
 *
 * Kept apart from `volunteering.ts` on purpose: that module is shared with the organiser
 * screens and another workstream edits it. Types that already exist there are imported,
 * never redeclared.
 *
 * Every shape below was read from the Laravel controller or service on 2026-10-08
 * (`VolunteerCommunityController`, `VolunteerWellbeingController`,
 * `VolunteerQualificationController`, `VolunteerCheckInController`,
 * `VolunteerExpenseController`) and cross-checked against the React page that already
 * implements the same flow, so the payload keys are the website's keys.
 */

import { Platform } from 'react-native';

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';
import type { TenantConfig } from '@/lib/api/tenant';
import type { SubmitVolunteerExpensePayload, VolunteerExpense } from '@/lib/api/volunteering';

// ---------------------------------------------------------------------------------------
// Community switches
// ---------------------------------------------------------------------------------------

/**
 * The switches the volunteer screens honour, named as the website names its tabs. The
 * bootstrap carries them with their full prefix (`volunteering.tab_wellbeing`), merged
 * over the server defaults, so a key is only ever absent on an old cached bootstrap.
 */
export type VolunteerSwitch =
  | 'tab_waitlist'
  | 'tab_wellbeing'
  | 'tab_alerts'
  | 'tab_credentials'
  | 'tab_safeguarding'
  | 'tab_accessibility'
  | 'tab_group_signups'
  | 'tab_expenses'
  | 'tab_donations'
  | 'expenses_enabled'
  | 'enable_qr_checkin';

/**
 * 🔴 Group sign-ups are an alpha feature and OFF everywhere unless an admin opts the
 * community in (owner decision, 2026-10-06). Every other switch defaults to on, which is
 * what the website's `isTabEnabled` does: `config[key] !== false`. An absent key must
 * therefore read as ON for the ordinary switches and OFF for group sign-ups — the same
 * defaults `VolunteeringConfigurationService::DEFAULTS` would have supplied.
 */
const OFF_UNLESS_ENABLED: ReadonlySet<VolunteerSwitch> = new Set(['tab_group_signups']);

export function volunteerSwitchOn(
  config: TenantConfig['volunteering_config'] | null | undefined,
  key: VolunteerSwitch,
): boolean {
  const value = config?.[`volunteering.${key}`];
  if (OFF_UNLESS_ENABLED.has(key)) return value === true;
  return value !== false;
}

// ---------------------------------------------------------------------------------------
// Waiting lists
// ---------------------------------------------------------------------------------------

export type WaitlistStatus = 'waiting' | 'notified' | string;

export interface WaitlistEntry {
  id: number;
  position: number;
  status: WaitlistStatus;
  notified_at: string | null;
  shift: { id: number; start_time: string; end_time: string; capacity: number | null };
  opportunity: { id: number; title: string; location?: string | null };
  organization: { id: number; name: string; logo_url?: string | null };
  joined_at: string;
}

/** GET /v2/volunteering/my-waitlists — only `waiting` and `notified` entries, soonest shift first. */
export function getMyWaitlists(): Promise<{ data: WaitlistEntry[] }> {
  return api.get<{ data: WaitlistEntry[] }>(`${API_V2}/volunteering/my-waitlists`);
}

/**
 * POST /v2/volunteering/shifts/{id}/waitlist — join a FULL shift's waiting list.
 * The server refuses a shift with room (400), one the member is already on (409) and an
 * opportunity they are not approved for (403); the website sends an empty body.
 */
export function joinWaitlist(shiftId: number): Promise<{ data: { id: number; position: number; message?: string } }> {
  return api.post<{ data: { id: number; position: number; message?: string } }>(`${API_V2}/volunteering/shifts/${shiftId}/waitlist`, {});
}

/** DELETE /v2/volunteering/shifts/{id}/waitlist — leaving a `notified` entry passes the place on. */
export function leaveWaitlist(shiftId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/shifts/${shiftId}/waitlist`);
}

/** POST /v2/volunteering/shifts/{id}/waitlist/promote — claim the place once told it is free. `{id}` is the SHIFT. */
export function claimWaitlistPlace(shiftId: number): Promise<{ data: { message?: string } }> {
  return api.post<{ data: { message?: string } }>(`${API_V2}/volunteering/shifts/${shiftId}/waitlist/promote`, {});
}

// ---------------------------------------------------------------------------------------
// The member's own check-in code
// ---------------------------------------------------------------------------------------

export type ShiftCheckInStatus = 'pending' | 'checked_in' | 'checked_out' | 'no_show' | string;

export interface ShiftCheckIn {
  id: number;
  /** 64 hex characters; the organiser can type it instead of scanning. */
  qr_token: string;
  /** `<frontend>/<slug>/volunteering/checkin/<token>` — what the website puts in its QR. */
  qr_url: string;
  status: ShiftCheckInStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
}

/**
 * GET /v2/volunteering/shifts/{id}/checkin — the caller's own code for a shift they hold.
 * 404 when they are not approved on that shift; 403 `FEATURE_DISABLED` when the community
 * has `volunteering.enable_qr_checkin` off.
 */
export function getShiftCheckIn(shiftId: number): Promise<{ data: ShiftCheckIn }> {
  return api.get<{ data: ShiftCheckIn }>(`${API_V2}/volunteering/shifts/${shiftId}/checkin`);
}

// ---------------------------------------------------------------------------------------
// Wellbeing
// ---------------------------------------------------------------------------------------

export type WellbeingMood = 1 | 2 | 3 | 4 | 5;
export const WELLBEING_MOODS: readonly WellbeingMood[] = [1, 2, 3, 4, 5];
/** The website shows the "let someone get in touch" choice only at or below this mood. */
export const LOW_MOOD_MAX = 2;

export interface WellbeingCheckin {
  id: number;
  mood: number;
  note: string | null;
  shared: boolean;
  created_at: string;
}

export interface WellbeingDashboard {
  score: number;
  hours_this_week: number;
  hours_this_month: number;
  streak_days: number;
  burnout_risk: 'low' | 'moderate' | 'high' | string;
  warnings: string[];
  suggested_rest_days: string[];
  recent_checkins: WellbeingCheckin[];
}

export function getWellbeing(): Promise<{ data: WellbeingDashboard }> {
  return api.get<{ data: WellbeingDashboard }>(`${API_V2}/volunteering/wellbeing`);
}

export interface WellbeingCheckinPayload {
  mood: WellbeingMood;
  note?: string;
  /** Only honoured for mood 1-2; the website sends `false` otherwise, and so does this. */
  share_with_team: boolean;
}

export interface WellbeingCheckinResult {
  id: number;
  mood: number;
  note: string | null;
  shared: boolean;
  /** True when staff were told — the member is thanked and told someone will be in touch. */
  team_notified: boolean;
}

export function submitWellbeingCheckin(payload: WellbeingCheckinPayload): Promise<{ data: WellbeingCheckinResult }> {
  return api.post<{ data: WellbeingCheckinResult }>(`${API_V2}/volunteering/wellbeing/checkin`, {
    mood: payload.mood,
    ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
    share_with_team: payload.mood <= LOW_MOOD_MAX ? payload.share_with_team : false,
  });
}

// ---------------------------------------------------------------------------------------
// Urgent shift requests (emergency alerts)
// ---------------------------------------------------------------------------------------

export type EmergencyAlertPriority = 'normal' | 'urgent' | 'critical' | string;
export type EmergencyAlertResponse = 'pending' | 'accepted' | 'declined' | string;

export interface EmergencyAlert {
  id: number;
  priority: EmergencyAlertPriority;
  message: string;
  my_response: EmergencyAlertResponse;
  required_skills?: string[];
  shift: { id: number; start_time: string; end_time: string };
  opportunity: { title: string; location?: string | null };
  organization: { name: string };
  coordinator?: { name: string } | null;
  expires_at: string | null;
  created_at: string | null;
}

/** The list sits at `data.alerts`; the server never pages past the first twenty. */
export type EmergencyAlertsResponse = { data: { alerts?: EmergencyAlert[] } | EmergencyAlert[] };

export function getEmergencyAlerts(): Promise<EmergencyAlertsResponse> {
  return api.get<EmergencyAlertsResponse>(`${API_V2}/volunteering/emergency-alerts`);
}

export function emergencyAlertItems(response: EmergencyAlertsResponse | null | undefined): EmergencyAlert[] {
  const payload = response?.data;
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.alerts) ? payload.alerts : [];
}

/** PUT /v2/volunteering/emergency-alerts/{id} — the field is `response`, NOT `action`. */
export function respondToEmergencyAlert(id: number, response: 'accepted' | 'declined'): Promise<{ data: { id: number; response: string } }> {
  return api.put<{ data: { id: number; response: string } }>(`${API_V2}/volunteering/emergency-alerts/${id}`, { response });
}

// ---------------------------------------------------------------------------------------
// Qualifications register (a record, never a document store — owner decision 2026-10-07)
// ---------------------------------------------------------------------------------------

export type QualificationStatus = 'recorded' | 'confirmed' | 'expired' | 'withdrawn' | string;
export type QualificationWithdrawalReason = 'volunteer_request' | 'no_longer_held' | 'entered_in_error' | 'replaced';
export const QUALIFICATION_WITHDRAWAL_REASONS: readonly QualificationWithdrawalReason[] = [
  'volunteer_request', 'no_longer_held', 'entered_in_error', 'replaced',
];

export interface QualificationType {
  code: string;
  label_key: string;
  expiry_hint_years: number | null;
}

export interface Qualification {
  id: number;
  user_id: number;
  qualification_type: string;
  type_label_key?: string;
  title: string | null;
  issuer: string | null;
  reference_number: string | null;
  obtained_at: string | null;
  expires_at: string | null;
  status: QualificationStatus;
  is_expiring: boolean;
  days_until_expiry: number | null;
  confirmed_by: { id: number; name: string } | null;
  confirmed_at: string | null;
  confirmation_method: 'saw_original' | 'online_register' | 'issuer_confirmed' | string | null;
  confirmed_for_organization: { id: number; name: string } | null;
  withdrawn_at: string | null;
  withdrawal_reason: QualificationWithdrawalReason | string | null;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface QualificationsResponse {
  data: {
    items: Qualification[];
    counts: { confirmed: number; recorded: number; expiring: number; expired: number };
    reminder_window_days: number;
    /** The codes this community accepts; labels are `qualifications.types.<code>` in the locale. */
    types: QualificationType[];
  };
}

export function getQualifications(): Promise<QualificationsResponse> {
  return api.get<QualificationsResponse>(`${API_V2}/volunteering/qualifications`);
}

export interface QualificationPayload {
  qualification_type: string;
  title: string | null;
  issuer: string | null;
  reference_number: string | null;
  obtained_at: string | null;
  expires_at: string | null;
  notes: string | null;
}

/** Trims every string and turns an empty one into `null`, exactly as the website's form does. */
export function normaliseQualificationPayload(payload: QualificationPayload): QualificationPayload {
  const text = (value: string | null | undefined) => {
    const trimmed = (value ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  return {
    qualification_type: payload.qualification_type.trim(),
    title: text(payload.title),
    issuer: text(payload.issuer),
    reference_number: text(payload.reference_number),
    obtained_at: text(payload.obtained_at),
    expires_at: text(payload.expires_at),
    notes: text(payload.notes),
  };
}

export function createQualification(payload: QualificationPayload): Promise<{ data: Qualification }> {
  return api.post<{ data: Qualification }>(`${API_V2}/volunteering/qualifications`, normaliseQualificationPayload(payload));
}

export function updateQualification(id: number, payload: QualificationPayload): Promise<{ data: Qualification }> {
  return api.put<{ data: Qualification }>(`${API_V2}/volunteering/qualifications/${id}`, normaliseQualificationPayload(payload));
}

export function withdrawQualification(id: number, reason: QualificationWithdrawalReason): Promise<{ data: Qualification }> {
  return api.post<{ data: Qualification }>(`${API_V2}/volunteering/qualifications/${id}/withdraw`, { reason });
}

// ---------------------------------------------------------------------------------------
// Safeguarding concerns (incident reports)
// ---------------------------------------------------------------------------------------

export type IncidentType = 'concern' | 'allegation' | 'disclosure' | 'near_miss' | 'other';
export const INCIDENT_TYPES: readonly IncidentType[] = ['concern', 'allegation', 'disclosure', 'near_miss', 'other'];
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export const INCIDENT_SEVERITIES: readonly IncidentSeverity[] = ['low', 'medium', 'high', 'critical'];
/** The website refuses a description shorter than this before sending; so does the server. */
export const INCIDENT_DESCRIPTION_MIN = 20;
export const INCIDENT_DESCRIPTION_MAX = 2000;

export interface IncidentReportOptions {
  organisations: { id: number; name: string }[];
  opportunities: { id: number; title: string; organization_id: number; organization_name: string }[];
}

export function getIncidentReportOptions(): Promise<{ data: IncidentReportOptions }> {
  return api.get<{ data: IncidentReportOptions }>(`${API_V2}/volunteering/incidents/report-options`);
}

export interface IncidentReportPayload {
  title: string;
  description: string;
  severity: IncidentSeverity;
  incident_type: IncidentType;
  category?: string;
  /** `YYYY-MM-DD`, never in the future. */
  incident_date?: string;
  organization_id?: number;
  opportunity_id?: number;
  subject_user_id?: number;
}

/** POST /v2/volunteering/incidents — 201 with the stored row; `id` is the reference the member keeps. */
export function reportIncident(payload: IncidentReportPayload): Promise<{ data: { id: number; status?: string } }> {
  const body: Record<string, unknown> = {
    title: payload.title.trim(),
    description: payload.description.trim(),
    severity: payload.severity,
    incident_type: payload.incident_type,
  };
  if (payload.category?.trim()) body.category = payload.category.trim();
  if (payload.incident_date) body.incident_date = payload.incident_date;
  if (payload.organization_id) body.organization_id = payload.organization_id;
  if (payload.opportunity_id) body.opportunity_id = payload.opportunity_id;
  if (payload.subject_user_id) body.subject_user_id = payload.subject_user_id;
  return api.post<{ data: { id: number; status?: string } }>(`${API_V2}/volunteering/incidents`, body);
}

export interface MyIncident {
  id: number;
  title: string | null;
  incident_type: string;
  description: string;
  status: 'open' | 'investigating' | 'resolved' | 'escalated' | 'closed' | string;
  severity: IncidentSeverity | string;
  category: string | null;
  incident_date: string | null;
  created_at: string;
  organization_name: string | null;
}

/** GET /v2/volunteering/incidents — the caller's own reports, at `data.items`. */
export function getMyIncidents(): Promise<{ data: { items?: MyIncident[]; total?: number } | MyIncident[] }> {
  return api.get<{ data: { items?: MyIncident[]; total?: number } | MyIncident[] }>(`${API_V2}/volunteering/incidents`);
}

export function myIncidentItems(response: Awaited<ReturnType<typeof getMyIncidents>> | null | undefined): MyIncident[] {
  const payload = response?.data;
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.items) ? payload.items : [];
}

// ---------------------------------------------------------------------------------------
// Accessibility needs — a private note; organisations and coordinators cannot see it
// ---------------------------------------------------------------------------------------

export type AccessibilityNeedType = 'mobility' | 'visual' | 'hearing' | 'cognitive' | 'dietary' | 'language' | 'other';
export const ACCESSIBILITY_NEED_TYPES: readonly AccessibilityNeedType[] = [
  'mobility', 'visual', 'hearing', 'cognitive', 'dietary', 'language', 'other',
];

export interface AccessibilityNeed {
  id?: number;
  need_type: AccessibilityNeedType | string;
  description: string | null;
  accommodations_required: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
}

export function getAccessibilityNeeds(): Promise<{ data: AccessibilityNeed[] }> {
  return api.get<{ data: AccessibilityNeed[] }>(`${API_V2}/volunteering/accessibility-needs`);
}

/**
 * PUT /v2/volunteering/accessibility-needs — REPLACES the whole set. Sending `[]` clears
 * everything, which is how a need is removed. One entry per `need_type`, or 422.
 */
export function updateAccessibilityNeeds(needs: AccessibilityNeed[]): Promise<{ data: { success: boolean } }> {
  return api.put<{ data: { success: boolean } }>(`${API_V2}/volunteering/accessibility-needs`, {
    needs: needs.map((need) => ({
      need_type: need.need_type,
      description: need.description?.trim() || null,
      accommodations_required: need.accommodations_required?.trim() || null,
      emergency_contact_name: need.emergency_contact_name?.trim() || null,
      emergency_contact_phone: need.emergency_contact_phone?.trim() || null,
    })),
  });
}

// ---------------------------------------------------------------------------------------
// Group sign-ups (alpha; only when `volunteering.tab_group_signups` is on)
// ---------------------------------------------------------------------------------------

export interface GroupReservationMember {
  /** The member's user id. */
  id: number;
  name: string;
  avatar_url: string | null;
  status: 'confirmed' | 'cancelled' | 'pending' | 'declined' | string;
  created_at?: string;
}

export interface GroupReservation {
  id: number;
  group_name: string;
  status: 'active' | 'cancelled' | 'completed' | 'confirmed' | 'pending' | string;
  is_leader: boolean;
  shift: { id: number; start_time: string; end_time: string };
  opportunity: { id: number; title: string; location?: string | null };
  organization: { id: number; name: string; logo_url?: string | null };
  members: GroupReservationMember[];
  /** The places reserved (`reserved_slots`). */
  max_members: number | null;
  created_at: string;
}

/** GET /v2/volunteering/group-reservations — reservations the caller leads or is a confirmed member of. */
export function getGroupReservations(): Promise<{ data: GroupReservation[] }> {
  return api.get<{ data: GroupReservation[] }>(`${API_V2}/volunteering/group-reservations`);
}

export interface GroupReservePayload {
  group_id: number;
  reserved_slots: number;
  notes?: string;
}

/** POST /v2/volunteering/shifts/{id}/group-reserve — the leader reserves places; 403 unless they run the group. */
export function reserveGroupPlaces(shiftId: number, payload: GroupReservePayload): Promise<{ data: { id: number; message?: string } }> {
  return api.post<{ data: { id: number; message?: string } }>(`${API_V2}/volunteering/shifts/${shiftId}/group-reserve`, {
    group_id: payload.group_id,
    reserved_slots: payload.reserved_slots,
    ...(payload.notes?.trim() ? { notes: payload.notes.trim() } : {}),
  });
}

export function addGroupReservationMember(reservationId: number, userId: number): Promise<{ data: { message?: string } }> {
  return api.post<{ data: { message?: string } }>(`${API_V2}/volunteering/group-reservations/${reservationId}/members`, { user_id: userId });
}

/** Leader or group manager only — the server refuses a member removing themselves (403). */
export function removeGroupReservationMember(reservationId: number, userId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/group-reservations/${reservationId}/members/${userId}`);
}

export function cancelGroupReservation(reservationId: number): Promise<void> {
  return api.delete<void>(`${API_V2}/volunteering/group-reservations/${reservationId}`);
}

/**
 * The groups the member can reserve for: `GET /v2/groups?member=me`, filtered the way
 * the website filters — the group's owner, or an active owner/admin member.
 */
export interface LeadableGroup {
  id: number;
  name: string;
  owner_id?: number | null;
  viewer_membership?: { role?: string | null; status?: string | null; is_admin?: boolean } | null;
}

export function getMyGroupsForReservation(): Promise<{ data: LeadableGroup[] | { items?: LeadableGroup[] } }> {
  return api.get<{ data: LeadableGroup[] | { items?: LeadableGroup[] } }>(`${API_V2}/groups`, { member: 'me', per_page: '100' });
}

export function leadableGroups(
  response: Awaited<ReturnType<typeof getMyGroupsForReservation>> | null | undefined,
  userId: number | null,
): LeadableGroup[] {
  const payload = response?.data;
  const groups = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
  return groups.filter((group) => {
    const membership = group.viewer_membership;
    const role = membership?.role ?? '';
    const ownsIt = userId !== null && group.owner_id != null && Number(group.owner_id) === userId;
    return ownsIt || (membership?.status === 'active' && (membership.is_admin === true || role === 'owner' || role === 'admin'));
  });
}

// ---------------------------------------------------------------------------------------
// Expenses with a receipt
// ---------------------------------------------------------------------------------------

/** What the server accepts for `receipt` (`SubmitExpenseRequest`: mimes pdf,jpg,jpeg,png,webp; 10 MB). */
export const EXPENSE_RECEIPT_MAX_BYTES = 10 * 1024 * 1024;

function receiptFilename(uri: string): string {
  const clean = uri.split('?')[0] ?? uri;
  const last = clean.split('/').pop();
  return last && last.includes('.') ? last : 'receipt.jpg';
}

function receiptMimeType(filename: string, reported?: string | null): string {
  if (reported && /^(image\/(jpeg|png|webp)|application\/pdf)$/.test(reported)) return reported;
  const extension = filename.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  return 'image/jpeg';
}

export interface ExpenseReceipt {
  uri: string;
  mimeType?: string | null;
}

/**
 * POST /v2/volunteering/expenses as multipart, with the receipt in the `receipt` field —
 * the field name the website's `ExpensesTab` uses. Without a receipt callers keep using
 * `submitVolunteerExpense` in `volunteering.ts`, whose JSON body the server reads the same
 * way; this only exists because a file cannot travel in JSON.
 *
 * Content-Type is deliberately NOT set: React Native writes its own multipart boundary
 * (see `client.ts`). The idempotency key goes in BOTH the header and the body, as every
 * other mutation in this module's sibling does.
 */
export async function submitVolunteerExpenseWithReceipt(
  payload: SubmitVolunteerExpensePayload,
  receipt: ExpenseReceipt,
  idempotencyKey?: string,
): Promise<{ data: VolunteerExpense }> {
  const formData = new FormData();
  formData.append('organization_id', String(payload.organization_id));
  formData.append('expense_type', payload.expense_type);
  formData.append('amount', String(payload.amount));
  if (payload.currency) formData.append('currency', payload.currency);
  formData.append('description', payload.description);
  if (idempotencyKey) formData.append('idempotency_key', idempotencyKey);

  const filename = receiptFilename(receipt.uri);
  const type = receiptMimeType(filename, receipt.mimeType);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(receipt.uri)).blob();
    formData.append('receipt', blob, filename);
  } else {
    // FormData accepts this shape in React Native.
    formData.append('receipt', { uri: receipt.uri, name: filename, type } as unknown as Blob);
  }

  return api.upload<{ data: VolunteerExpense }>(
    `${API_V2}/volunteering/expenses`,
    formData,
    idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined,
  );
}
