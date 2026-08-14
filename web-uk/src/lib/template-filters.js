// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { splitDate } = require('./date-input');

/**
 * Filters that TEMPLATES DEPEND ON, registered from one place.
 *
 * 🔴 Why this module exists: `dateParts` was registered only in `server.js`, and 18 test
 * files build their own Nunjucks environment with their own ad-hoc filter list. The moment a
 * template used the filter, every one of those environments that renders that template threw
 * `Template render error` — not a missing-filter message, just a render failure pointing at a
 * line number. Anything a template cannot render without belongs here, and both the server
 * and any test environment should call this.
 *
 * Filters that only ONE view needs, or that a test deliberately stubs (`nl2br`, `string`),
 * are not moved here — this is for the ones a template genuinely cannot work without.
 */
function registerTemplateFilters(env) {
  if (!env || typeof env.addFilter !== 'function') return env;

  // Split a stored 'YYYY-MM-DD' into the day/month/year parts the GOV.UK date input needs:
  //   {{ nexusDateInput({ name: "deadline", value: job.deadline | dateParts }, t) }}
  //
  // 🔴 Prefer this over threading a `<name>Parts` variable through the route. Doing it that
  // way caused three converted fields to silently stop repopulating on their edit forms
  // (the route was never updated), and leaked one view-only field into an API request body
  // because it was added to an object that doubles as the outgoing payload.
  env.addFilter('dateParts', (value) => splitDate(value));

  return env;
}

module.exports = { registerTemplateFilters };
