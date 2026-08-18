// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { splitDate } = require('./date-input');
const { resolveBackendThumbnailUrl } = require('./accessible-shell');

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

  // Ask the API for a member-uploaded image at the size it is displayed at:
  //   <img src="{{ member.avatar | thumb(96, 96) }}" width="48" height="48" ...>
  //
  // 🔴 The size belongs HERE, in the markup, not in the route. The route does not know
  // whether its avatar lands in a 32px comment badge or a 128px profile header, and the
  // same record feeds both — which is why every image was being served at full upload
  // size regardless of how small it was drawn. Height defaults to width (square), and a
  // missing or unsupported image passes through unchanged rather than breaking.
  //
  // Pass the RENDERED pixel size, doubled where the file is small enough to make a sharp
  // retina image cheap; the CSS still decides the layout box.
  env.addFilter('thumb', (value, width, height, fit) => resolveBackendThumbnailUrl(value, { width, height, fit }));

  return env;
}

module.exports = { registerTemplateFilters };
