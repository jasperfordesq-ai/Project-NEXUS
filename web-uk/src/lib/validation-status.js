// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "Error: " page-title prefix, for pages that signal validation failure with a status
 * STRING rather than an error collection.
 *
 * `src/views/layouts/base.njk` computes:
 *
 *   pageValidationFailed = pageHasErrors or hasErrors or error
 *                          or (errors and (errors | length))
 *                          or (fieldErrors and (fieldErrors | length))
 *
 * and its own comment records the gap this module closes: "Forms that instead signal
 * validation via a `status == 'x-invalid'` string still rely on their own per-field error
 * announcement … wiring the title prefix for those is a smaller, separate follow-up."
 *
 * 🔴 It has to be the ROUTE that passes the flag. A child template's top-level
 * `{% set pageHasErrors = … %}` runs AFTER the parent layout has already rendered
 * `<head>`, so the title is computed before the set ever executes — the same trap that
 * left contact.njk rendering an error summary under an unprefixed title. Templates may
 * still read the status for their own field-level markup; only the title needs this.
 *
 * Scope is deliberately narrow: a *validation* failure, i.e. the member's own input was
 * rejected. A transient load or send failure is a different thing (GDS pairs those with
 * `data-disable-auto-focus="true"` summaries) and does not earn the prefix.
 */

/** A status string is a validation failure when it ends in `-invalid`. */
function isValidationFailureStatusValue(status) {
  return /-invalid$/.test(String(status ?? '').trim());
}

/**
 * Accepts either a raw status string, or the `{ status, type }` banner object the routes
 * already build, so a caller can pass whichever it happens to be holding.
 */
function isValidationFailureStatus(input) {
  if (input === null || input === undefined) return false;
  if (typeof input === 'object') {
    return isValidationFailureStatusValue(input.status);
  }
  return isValidationFailureStatusValue(input);
}

module.exports = { isValidationFailureStatus, isValidationFailureStatusValue };
