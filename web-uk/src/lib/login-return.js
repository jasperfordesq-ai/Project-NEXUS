// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Where sign-in may send a member back to, instead of the dashboard.
 *
 * 🔴 Deliberately an ALLOWLIST of exact path shapes, never "any relative path":
 * a free-form return address is an open redirect (`//evil.example`, `/\evil`,
 * encoded variants), and the only journey that needs one today is a signed-out
 * visitor opening a group invitation link. Add a shape here only with a test.
 *
 * The value is mount-relative (`/groups/invite/...`); the caller turns it into
 * a tenant-aware address with `urlFor`, exactly like every other redirect.
 */
const ALLOWED_RETURN_PATHS = [
  /^\/groups\/invite\/[A-Za-z0-9]{40}$/
];

function safeLoginReturnPath(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 200) return '';
  return ALLOWED_RETURN_PATHS.some((pattern) => pattern.test(text)) ? text : '';
}

module.exports = { safeLoginReturnPath };
