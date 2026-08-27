// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared token builder for the GDPR audit-log translation keys rendered by
 * EnterpriseDashboard and GdprAuditLog.
 *
 * 🔴 The value CAN be null, and both pages must survive it. `gdpr_audit_log`
 * declares `action` NOT NULL but `entity_type` nullable, and
 * GdprService::logAction() passes null for entity_type when an account is
 * deleted (app/Services/Enterprise/GdprService.php) — deliberately, because the
 * entity the row would point at no longer exists.
 *
 * Until 2026-08-27 each page kept a private copy of this function typed
 * `(value: string)` that called .toLowerCase() straight away. A single deleted
 * account therefore threw during render and took the whole admin page down to
 * the top-level error boundary, while the API response itself was a clean 200
 * — see production support report NXR-260827-ND1UJA (/admin/enterprise on
 * timebank.global). Three tenants were affected the day it was reported.
 *
 * Falling back to the `unknown` token makes the callers' existing
 * `enterprise.gdpr_audit_action_unknown` / `enterprise.gdpr_entity_type_unknown`
 * keys render, which is what their `defaultValue` already asked for.
 */
export const GDPR_AUDIT_UNKNOWN_TOKEN = 'unknown';

export function translationToken(value: string | null | undefined): string {
  const token = (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return token || GDPR_AUDIT_UNKNOWN_TOKEN;
}
