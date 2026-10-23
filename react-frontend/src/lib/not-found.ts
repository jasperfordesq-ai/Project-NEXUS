// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import type { ApiResponse } from '@/lib/api';

/**
 * Error codes the API uses for "this record does not exist" (or has gone).
 * `HTTP_404` / `HTTP_410` are what the client reports when the server sent a
 * bare status with no code of its own.
 */
const NOT_FOUND_CODES = new Set(['NOT_FOUND', 'RESOURCE_NOT_FOUND', 'HTTP_404', 'HTTP_410']);

/**
 * True only when the server said the record is not there: a not-found error
 * code, or a successful answer with nothing in it.
 *
 * A page uses this to decide whether to tell crawlers "404". A server error,
 * timeout or network failure is NOT a missing page, and must never be reported
 * as one: that would tell search engines to drop a page that still exists.
 */
export function isNotFoundResponse(
  res: Pick<ApiResponse<unknown>, 'success' | 'data' | 'code' | 'errors'> | null | undefined,
): boolean {
  if (!res) return false;
  if (res.success) return res.data === undefined || res.data === null;
  const codes = [res.code, ...(res.errors ?? []).map((error) => error.code)];
  return codes.some((code) => typeof code === 'string' && NOT_FOUND_CODES.has(code));
}
