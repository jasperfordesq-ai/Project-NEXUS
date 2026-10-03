// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * "Help & support" requests — `POST /api/v2/support/reports`
 * (`App\Http\Controllers\Api\SupportReportController::store`).
 *
 * The same endpoint the website's Help & support button posts to
 * (`react-frontend/src/components/feedback/ReportProblemButton.tsx`). The server
 * saves the request, raises a ticket on the Jira help desk, and emails the member
 * a receipt carrying the reference it returns (`NXR-yymmdd-XXXXXX`).
 *
 * Contract, read from the controller — do not widen it here:
 *  - members only (a bearer token is required);
 *  - `request_type` is one of the four below; omitted means `broken`;
 *  - `summary` 3–180 characters, `description` 10–5000;
 *  - `impact` is REQUIRED for `broken` and ignored for every other type, so it is
 *    only sent for `broken`;
 *  - diagnostics are kept only for `broken` and only when `include_diagnostics`
 *    is true. The server redacts anything that looks like a token, an email or an
 *    address, but nothing of that kind should ever be sent in the first place —
 *    see `lib/supportDiagnostics.ts`;
 *  - five requests a day per member. The sixth is `429` with the code
 *    {@link SUPPORT_REPORT_DAILY_LIMIT}. The route also carries a ten-a-minute
 *    throttle, which is a plain `429` without that code.
 *
 * 🔴 The endpoint has no idempotency support, so no retry key is sent: a key the
 * server ignores would only pretend to make a resend safe. The screen guards
 * against a double press instead.
 */

/** The four kinds of request; they match the Jira help desk's request types. */
export const SUPPORT_REQUEST_TYPES = ['broken', 'how_to', 'account', 'suggestion'] as const;
export type SupportRequestType = (typeof SUPPORT_REQUEST_TYPES)[number];

/** How badly something that is not working affects the member. `broken` only. */
export const SUPPORT_IMPACTS = ['blocked', 'major', 'minor', 'cosmetic'] as const;
export type SupportImpact = (typeof SUPPORT_IMPACTS)[number];

/** The server's limits, mirrored so the form can stop a request it would refuse. */
export const SUPPORT_SUMMARY_MIN = 3;
export const SUPPORT_SUMMARY_MAX = 180;
export const SUPPORT_DESCRIPTION_MIN = 10;
export const SUPPORT_DESCRIPTION_MAX = 5000;

/** The API's code when the member has used up today's requests. */
export const SUPPORT_REPORT_DAILY_LIMIT = 'SUPPORT_REPORT_DAILY_LIMIT';

/** Tells the support team the request came from the native app, not the website. */
export const SUPPORT_REPORT_MODULE = 'mobile_app';

export interface SupportRequestPayload {
  requestType: SupportRequestType;
  summary: string;
  description: string;
  /** Sent only when `requestType` is `broken`. */
  impact?: SupportImpact;
  /** Sent only when `requestType` is `broken`. */
  diagnostics?: Record<string, string> | null;
}

export interface SupportReportReceipt {
  id: number;
  reference: string;
  request_type: SupportRequestType;
  status: string;
  impact: string;
  summary: string;
  created_at?: string | null;
}

interface SupportReportEnvelope {
  data?: { report?: Partial<SupportReportReceipt> | null } | null;
}

export function isSupportRequestType(value: unknown): value is SupportRequestType {
  return typeof value === 'string' && (SUPPORT_REQUEST_TYPES as readonly string[]).includes(value);
}

/** Build the exact request body. Exported so the contract can be tested without a network. */
export function buildSupportReportBody(payload: SupportRequestPayload): Record<string, unknown> {
  const isBroken = payload.requestType === 'broken';
  const diagnostics = isBroken && payload.diagnostics ? payload.diagnostics : null;

  return {
    request_type: payload.requestType,
    summary: payload.summary.trim(),
    description: payload.description.trim(),
    ...(isBroken ? { impact: payload.impact ?? 'minor' } : {}),
    module: SUPPORT_REPORT_MODULE,
    include_diagnostics: diagnostics !== null,
    ...(diagnostics ? { diagnostics } : {}),
  };
}

/**
 * Send one request. Resolves with the server's receipt; throws `ApiResponseError`
 * on a refusal (validation, daily limit, signed out) or a network failure.
 */
export async function submitSupportRequest(payload: SupportRequestPayload): Promise<SupportReportReceipt> {
  const response = await api.post<SupportReportEnvelope>(
    `${API_V2}/support/reports`,
    buildSupportReportBody(payload),
  );
  const report = response?.data?.report;
  const reference = typeof report?.reference === 'string' ? report.reference.trim() : '';
  if (!report || reference === '') {
    // A 2xx without a reference cannot be shown to the member as a receipt, and
    // pretending it can would leave them with nothing to quote.
    throw new Error('Support report response did not contain a reference');
  }

  return {
    id: Number(report.id ?? 0),
    reference,
    request_type: isSupportRequestType(report.request_type) ? report.request_type : payload.requestType,
    status: String(report.status ?? 'open'),
    impact: String(report.impact ?? ''),
    summary: String(report.summary ?? payload.summary.trim()),
    created_at: report.created_at ?? null,
  };
}
