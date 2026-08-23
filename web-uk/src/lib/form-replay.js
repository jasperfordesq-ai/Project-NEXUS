// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Keep what the member typed when a submission fails.
 *
 * Every form in this app answers a failure with a redirect (POST-redirect-GET), which is
 * the right pattern — but it means `req.body` is gone by the time the GET re-renders. Any
 * field that is not written back from somewhere therefore comes back BLANK, so a member
 * who wrote a long comment, a safeguarding report, or an expense claim and tripped a
 * validation rule or a passing API failure lost all of it and had to start again.
 *
 * The established fix is a one-shot session stash: write on every failure exit, read and
 * DELETE on the matching GET. `storeTransferForm` in routes/wallet.js and
 * `rememberListingForm`/`consumeListingFormState` in routes/marketplace-actions.js +
 * marketplace.js are the two worked examples. This module is the same idea factored out,
 * because the same twenty lines were about to be copied into seven more route files.
 *
 * Rules that matter:
 *
 * - 🔴 Consume ONCE. If the stash survived the render, the next clean visit to the page
 *   would arrive pre-filled with a submission the member had already abandoned — on a
 *   create form that reads as a draft they never wrote, and on wallet-shaped forms it is
 *   how you resend something by accident.
 * - 🔴 Only ever store echoed INPUT. Nothing here is authoritative: the POST handler
 *   re-validates everything on the next submit, exactly as it did the first time.
 * - 🔴 A `key` scopes the stash to one target (a group id, a post slug, a resource id), so
 *   a failure on one page cannot pre-fill the same form on a different one.
 * - File inputs cannot be repopulated by HTML at all — the browser forbids setting a file
 *   input's value. Where a form mixes a file with typed fields, stash the typed fields:
 *   the member must re-pick the file either way, and losing the description as well is the
 *   avoidable half.
 */

const SESSION_ROOT = 'formReplay';

function bucketOf(req, bucket, { create = false } = {}) {
  if (!req || !req.session) return null;
  if (create) {
    req.session[SESSION_ROOT] ||= {};
    req.session[SESSION_ROOT][bucket] ||= {};
  }
  const root = req.session[SESSION_ROOT];
  return root && root[bucket] ? root[bucket] : null;
}

/**
 * Stash the submitted values for one form. Call this on EVERY failure exit — the
 * validation redirect and the API-failure redirect alike. A failure the member did not
 * cause is the one where losing their words stings most.
 */
function rememberFormReplay(req, bucket, key, values) {
  const store = bucketOf(req, bucket, { create: true });
  if (!store) return;
  store[String(key)] = values;
}

/** Read the stash for one form and delete it, so it is used exactly once. */
function consumeFormReplay(req, bucket, key) {
  const store = bucketOf(req, bucket);
  if (!store) return null;
  const id = String(key);
  const values = store[id];
  delete store[id];
  return values && typeof values === 'object' ? values : null;
}

module.exports = { rememberFormReplay, consumeFormReplay };
