// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Present an API-supplied identifier as a readable label.
 *
 * 🔴 Use this instead of Nunjucks' built-in `capitalize`, which raises the first
 * letter AND LOWER-CASES THE REST. On the polls category filter that rendered
 * "local_events" as "Local_events", and it would equally render "NGO support"
 * as "Ngo support".
 *
 * This separates words on underscores and hyphens and only ever raises the
 * first letter, so a value that already reads correctly comes back unchanged.
 * It is a display fallback for values the API gives us without a translation —
 * it is NOT a substitute for a translated label where one exists.
 *
 * @param {unknown} value
 * @returns {string}
 */
function humanizeLabel(value) {
  const text = String(value == null ? '' : value)
    .replace(/[_-]+/g, ' ')
    .trim();

  if (text === '') return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

module.exports = { humanizeLabel };
