// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

/**
 * The community's public information pages — About, Contact, Trust and safety.
 *
 * `GET /api/v2/public-page-content/{pageKey}`
 * (`App\Http\Controllers\Api\StaticPublicPageController` →
 * `App\Services\StaticPublicPageContentService`). Public: no token required.
 *
 * 🔴 These are NOT legal documents. `legal_documents.document_type` is an enum of
 * `terms, privacy, cookies, accessibility, community_guidelines, acceptable_use`
 * — About, Contact and Trust and safety are not in it, so `GET /v2/legal/{type}`
 * cannot serve them and asking it for `about` is a 404.
 *
 * 🔴 The page key for trust and safety is **`trust-safety`**. Its `path` is
 * `/trust-and-safety`, which is the web URL, not the key — asking for
 * `trust-and-safety` returns `RESOURCE_NOT_FOUND` (verified against the local
 * API on 2026-09-06).
 *
 * The service defines exactly six keys: `about`, `features`, `contact`,
 * `trust-safety`, `timebanking-guide`, `legal`.
 */

/** The six page keys the server actually serves. */
export const STATIC_PAGE_KEYS = ['about', 'features', 'contact', 'trust-safety', 'timebanking-guide', 'legal'] as const;

export type StaticPageKey = (typeof STATIC_PAGE_KEYS)[number];

/**
 * One entry inside a section.
 *
 * Every field is optional because the shape genuinely varies by page: About's
 * steps arrive as `{ title, description }`, Contact's subjects and Trust's bullet
 * lists as `{ key, description }`, and the About credits block as
 * `{ key, title, description }`. Rendering has to cope with all three.
 */
export interface StaticPageItem {
  key?: string;
  title?: string;
  description?: string;
  path?: string;
}

export interface StaticPageSection {
  key: string;
  title: string;
  body: string;
  items: StaticPageItem[];
}

export interface StaticPageContent {
  route_key: string;
  page_key: string;
  path: string;
  title: string;
  lead: string;
  sections: StaticPageSection[];
  tenant?: { id: number; slug: string; name: string } | null;
}

interface StaticPageEnvelope {
  data?: StaticPageContent | null;
}

export function isStaticPageKey(value: string): value is StaticPageKey {
  return (STATIC_PAGE_KEYS as readonly string[]).includes(value);
}

/** Read one page's content. Returns null when the community has published none. */
export async function getStaticPageContent(pageKey: string): Promise<StaticPageContent | null> {
  const response = await api.get<StaticPageEnvelope>(
    `${API_V2}/public-page-content/${encodeURIComponent(pageKey)}`,
  );
  const page = response?.data ?? null;
  if (!page) return null;

  return {
    route_key: String(page.route_key ?? ''),
    page_key: String(page.page_key ?? pageKey),
    path: String(page.path ?? ''),
    title: String(page.title ?? ''),
    lead: String(page.lead ?? ''),
    tenant: page.tenant ?? null,
    sections: Array.isArray(page.sections)
      ? page.sections
          .filter((section): section is StaticPageSection => !!section)
          .map((section) => ({
            key: String(section.key ?? ''),
            title: String(section.title ?? ''),
            body: String(section.body ?? ''),
            items: Array.isArray(section.items) ? section.items.filter(Boolean) : [],
          }))
      : [],
  };
}

export interface ContactMessagePayload {
  name: string;
  email: string;
  /** The human-readable subject, as the website sends it — it lands in the email subject line. */
  subject: string;
  message: string;
}

interface ContactSubmitResponse {
  data?: { message?: string } | null;
}

/**
 * Send the community's organisers a message — `POST /api/v2/contact`.
 *
 * 🔴 This endpoint is gated by Cloudflare Turnstile
 * (`CoreController::apiSubmit` → `TurnstileService`), and a native app cannot
 * render that widget. `TurnstileService::verify()` returns true when
 * `TURNSTILE_SECRET_KEY` is unset, which is how production is configured today,
 * so a token-less submission is accepted. If the key is ever set, the API
 * answers `422 TURNSTILE_FAILED` — the contact screen watches for exactly that
 * code and tells the member to write to their organisers directly rather than
 * showing a generic failure. Do not paper over it with a fake token.
 */
export function submitContactMessage(payload: ContactMessagePayload): Promise<ContactSubmitResponse> {
  return api.post<ContactSubmitResponse>(`${API_V2}/contact`, {
    name: payload.name.trim(),
    email: payload.email.trim(),
    subject: payload.subject.trim(),
    message: payload.message.trim(),
  });
}

/** The API's code when the Turnstile bot check refuses a submission. */
export const TURNSTILE_FAILED = 'TURNSTILE_FAILED';
