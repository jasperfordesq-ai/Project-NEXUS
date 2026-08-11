// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api, ApiResponseError } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * Legal documents and acceptance.
 *
 * 🔴 This app had NO legal handling at all across 562 API call sites. Until the
 * server-side gate was built that did not show, because nothing on the server
 * checked either — only the React website gated, in the browser. Now that the
 * platform can refuse a write with `LEGAL_ACCEPTANCE_REQUIRED`, an app with no
 * acceptance screen would leave a member unable to act and unable to find out why.
 * That is the reason enforcement stays in `report` mode until this ships.
 */

/** The machine code the API returns when acceptance is outstanding. */
export const LEGAL_ACCEPTANCE_REQUIRED = 'LEGAL_ACCEPTANCE_REQUIRED';

export type LegalAcceptanceStatus = 'current' | 'outdated' | 'not_accepted';

export interface LegalAcceptanceDocument {
  document_id: number;
  document_type: string;
  title: string;
  current_version_id: number | null;
  current_version: string | null;
  acceptance_status: LegalAcceptanceStatus;
  accepted_at: string | null;
}

export interface LegalAcceptanceStatusResponse {
  data: {
    has_pending: boolean;
    documents: LegalAcceptanceDocument[];
    /**
     * Whether the platform is actually refusing requests (false under
     * `LEGAL_ENFORCEMENT_MODE=report` and `off`).
     *
     * 🔴 This client does NOT need it, and that is deliberate — do not add a
     * poll-and-gate here. The acceptance screen opens only when the API really
     * refuses a request with `LEGAL_ACCEPTANCE_REQUIRED` (`lib/api/client.ts`), so
     * enforcement mode is honoured for free: in report mode nothing is refused, so
     * nothing opens. web-uk and React DO have to read this field, because they
     * decide up front whether to interpose, and web-uk shipped without reading it
     * and blocked every member in a mode meant to block nobody.
     *
     * Declared so the shape is documented and an added field is visibly expected.
     */
    enforcement_blocking?: boolean;
  };
}

export interface LegalAcceptAllResponse {
  data: {
    accepted: string[];
    message: string;
  };
}

export interface LegalDocument {
  id: number;
  document_id: number;
  type: string;
  title: string;
  content: string;
  version_number: string | null;
  effective_date: string | null;
  summary_of_changes: string | null;
  has_previous_versions: boolean;
}

/** `data` is null when the community has published no document of this type. */
export interface LegalDocumentResponse {
  data: LegalDocument | null;
}

export function getLegalAcceptanceStatus(): Promise<LegalAcceptanceStatusResponse> {
  return api.get<LegalAcceptanceStatusResponse>(`${API_V2}/legal/acceptance/status`);
}

/**
 * Accept everything outstanding.
 *
 * Sends no body on purpose: the API recomputes the pending set inside a
 * transaction with the document rows locked, so a client-supplied list could
 * record acceptance of a version the member was never shown — which would corrupt
 * the very audit trail this exists to produce.
 */
export function acceptAllLegalDocuments(): Promise<LegalAcceptAllResponse> {
  return api.post<LegalAcceptAllResponse>(`${API_V2}/legal/acceptance/accept-all`);
}

/**
 * Read one document's full text.
 *
 * Unauthenticated on the server — a member must be able to read the terms before
 * they have an account, and while a gate is blocking everything else.
 */
export function getLegalDocument(type: string): Promise<LegalDocumentResponse> {
  return api.get<LegalDocumentResponse>(`${API_V2}/legal/${encodeURIComponent(type)}`);
}

/**
 * Is this error the acceptance gate refusing the request?
 *
 * 🔴 Matches on the CODE, never on the status or the message. A 403 has many
 * causes, and the message is translated into the member's language — matching on
 * it would work in English and quietly fail in the other ten.
 */
export function isLegalAcceptanceRequired(error: unknown): boolean {
  return error instanceof ApiResponseError && error.code === LEGAL_ACCEPTANCE_REQUIRED;
}

/** Documents the member still owes, newest state first. */
export function pendingDocuments(response: LegalAcceptanceStatusResponse | null | undefined): LegalAcceptanceDocument[] {
  const documents = response?.data?.documents;
  if (!Array.isArray(documents)) return [];

  return documents.filter((document) => document?.acceptance_status !== 'current');
}
