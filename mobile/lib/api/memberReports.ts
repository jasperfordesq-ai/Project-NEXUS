// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A member reporting another member, or a direct message they received, to their
 * community's coordinators.
 *
 * Server contract (Laravel `MemberConcernReportController`):
 *  - `POST /api/v2/users/{id}/report`    body `{ category, details? }`
 *  - `POST /api/v2/messages/{id}/report` body `{ category, details? }`
 *  - 201 `{ data: { reported: true, report_id } }`
 *  - 422 `VALIDATION_ERROR` (field `category` / `details`), 422 `CANNOT_REPORT_SELF`,
 *    404 `NOT_FOUND`, 409 `ALREADY_REPORTED`, 429. `error.message` arrives translated.
 *
 * Only the receiver of a direct message may report it, and federated messages are refused.
 */

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export const MEMBER_REPORT_CATEGORIES = [
  'safeguarding_concern',
  'harassment',
  'inappropriate',
  'scam_or_fraud',
  'spam',
  'other',
] as const;

export type MemberReportCategory = (typeof MEMBER_REPORT_CATEGORIES)[number];

/** The server's `max:2000` on `details`. */
export const MEMBER_REPORT_DETAILS_MAX = 2000;

export interface MemberReportInput {
  category: MemberReportCategory;
  details?: string | null;
}

export interface MemberReportResponse {
  data: { reported: boolean; report_id: number };
}

function body(input: MemberReportInput): { category: MemberReportCategory; details?: string } {
  const details = (input.details ?? '').trim();
  return details ? { category: input.category, details } : { category: input.category };
}

/**
 * What is wrong with the details for this category, if anything — the same two rules the
 * server applies, so the form can say so before sending.
 */
export function memberReportDetailsProblem(
  category: MemberReportCategory,
  details: string,
): 'required' | 'tooLong' | null {
  const trimmed = details.trim();
  if (category === 'other' && trimmed === '') return 'required';
  if (trimmed.length > MEMBER_REPORT_DETAILS_MAX) return 'tooLong';
  return null;
}

export function reportMember(userId: number, input: MemberReportInput): Promise<MemberReportResponse> {
  return api.post<MemberReportResponse>(`${API_V2}/users/${userId}/report`, body(input));
}

export function reportMessage(messageId: number, input: MemberReportInput): Promise<MemberReportResponse> {
  return api.post<MemberReportResponse>(`${API_V2}/messages/${messageId}/report`, body(input));
}
