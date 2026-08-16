// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Convert newlines in user-supplied text to <br> for display.
 *
 * SECURITY: the input is HTML-escaped FIRST, then newlines are turned into
 * <br>. The order matters — escaping after inserting <br> would also escape our
 * own tags, and escaping only some characters would let a member inject markup.
 * A literal "<br>" typed by a user is therefore rendered as text, not a real
 * line break. Templates emit the result with `| safe`, so this function is the
 * sole line of defence for that content.
 *
 * @param {string} str
 * @returns {string}
 */
function nl2br(str) {
  if (!str) return '';
  const escaped = String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  return escaped.replace(/\n/g, '<br>');
}

module.exports = { nl2br };
