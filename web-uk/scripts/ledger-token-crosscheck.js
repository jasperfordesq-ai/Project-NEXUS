// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Detects the `/organisations` class of defect: a Web UK helper that sends no
 * bearer token, calling a Laravel endpoint that refuses anonymous callers. Such a
 * page is broken for every member, and neither the consumer ledger nor the test
 * suite can see it — the ledger records that a test NAMES the helper, not that the
 * request would have succeeded, and a mocked test answers whatever the mock says.
 *
 * 🔴 There are ZERO subjects today: the one real instance was fixed, and no
 * parameterless GET is currently classified `guest`. This is therefore a REGRESSION
 * guard that catches nothing at the moment, which is precisely why its behaviour is
 * pinned by tests rather than left to be assumed alive.
 */

/** Paths where at least one caller sends no token. Worst case wins: a token-sending
 *  sibling does not rescue the page whose helper omits it. */
function buildNoTokenIndex(rows) {
  const index = new Map();
  for (const row of rows || []) {
    if (row && row.authMode === 'guest' && row.path) {
      index.set(row.path, row.helper || row.function || '(helper)');
    }
  }
  return index;
}

/** A finding string, or null when this path is fine. */
function noTokenFinding(path, anonStatus, index) {
  if (anonStatus !== 401) return null;
  if (!index.has(path)) return null;
  return `the ledger records ${index.get(path)} calling this WITHOUT a bearer token, `
    + 'but the API refuses an anonymous caller (401) — broken for every member, '
    + 'exactly the /organisations defect';
}

module.exports = { buildNoTokenIndex, noTokenFinding };
