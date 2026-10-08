// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Carry the API's own refusal message across a POST-redirect-GET.
 *
 * Some refusals cannot be told apart by their code. "Apply" answers 422
 * VALIDATION_ERROR both for "this opportunity is no longer active" and for "you run
 * this organisation" (8 Oct 2026), and an expense claim answers 403 FORBIDDEN for
 * several different reasons. The API's message says which, in the member's own
 * language (`request()` forwards the request locale as `Accept-Language`), so the
 * failing POST stashes it here and the page it redirects to shows it in place of a
 * generic "something went wrong".
 *
 * Same one-shot session stash as lib/form-replay.js: written on the failure exit,
 * read and DELETED by the matching GET, and scoped by a key so a refusal on one page
 * can never surface on another. Rendered as text only (Nunjucks autoescapes); a page
 * with nothing stashed falls back to its own translated message.
 */

const { rememberFormReplay, consumeFormReplay } = require('./form-replay');

const BUCKET = 'apiRefusal';
const MAX_LENGTH = 300;

function refusalMessageOf(error) {
  const firstError = Array.isArray(error?.data?.errors) ? error.data.errors[0] : null;
  const message = firstError?.message ?? error?.data?.message;
  return typeof message === 'string' ? message.trim().slice(0, MAX_LENGTH) : '';
}

/** Stash the API's message for one page. Does nothing when the API gave none. */
function rememberApiRefusal(req, key, error) {
  const message = refusalMessageOf(error);
  if (message) rememberFormReplay(req, BUCKET, key, { message });
  return message;
}

/** Read the stashed message for one page and delete it; '' when there is none. */
function consumeApiRefusal(req, key) {
  const stored = consumeFormReplay(req, BUCKET, key);
  return stored && typeof stored.message === 'string' ? stored.message : '';
}

module.exports = { rememberApiRefusal, consumeApiRefusal, refusalMessageOf };
