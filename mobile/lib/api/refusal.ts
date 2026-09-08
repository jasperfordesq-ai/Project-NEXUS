// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Telling a refusal apart from a failure.
 *
 * 🔴 A screen that shows "could not load — Try again" for a 403 has told the member
 * something untrue and handed them a button that can never work. The server did not
 * fail; it understood perfectly and said no. The member is not the organiser, or was
 * removed as one, or opened a link meant for somebody else. Retrying an answer like
 * that produces the same answer for ever.
 *
 * The pattern recurs because the natural way to write a loader — `catch { setFailed(true) }`
 * — throws the status away before anyone can look at it. Bind the error and ask this.
 */

import { ApiResponseError } from '@/lib/api/client';

/**
 * The statuses that mean "no", not "something went wrong".
 *
 * - 401: not signed in, or the session is no longer accepted here.
 * - 403: signed in and not allowed. The common one on organiser-only screens.
 * - 404: from an owner-scoped endpoint this is usually "not yours" wearing a
 *   different number — servers routinely answer 404 rather than 403 so that a
 *   stranger cannot learn the record exists. Treated the same, with wording that
 *   allows for it genuinely being gone.
 *
 * 5xx is deliberately absent: that IS a failure, and retrying it can work.
 */
const REFUSAL_STATUSES = new Set([401, 403, 404]);

/**
 * For callers that already hold a status — `useApi`/`usePaginatedApi` expose
 * `errorStatus`, so those screens never see the error object itself. Same list, so
 * the two paths cannot drift into disagreeing about what counts as a refusal.
 */
export function isRefusalStatus(status: number | null | undefined): boolean {
  return typeof status === 'number' && REFUSAL_STATUSES.has(status);
}

/** The refusal status, or null when this is an ordinary failure worth retrying. */
export function refusalStatus(error: unknown): number | null {
  if (error instanceof ApiResponseError && REFUSAL_STATUSES.has(error.status)) {
    return error.status;
  }
  return null;
}

/** Whether the server said no, as opposed to something going wrong. */
export function isRefusal(error: unknown): boolean {
  return refusalStatus(error) !== null;
}
