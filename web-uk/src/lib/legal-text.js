// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Text for the two static compliance pages both frontends publish: account deletion,
 * and child safety standards.
 *
 * Generated — see scripts/build-legal-text.js for where it comes from and why it has
 * exactly one source rather than a hand-maintained copy per frontend.
 */

const generated = require('./generated/legal-text.json');

const FALLBACK_LOCALE = 'en';

/**
 * One page's strings in the requested language.
 *
 * Falls back to English per PAGE rather than failing: a member who has switched to a
 * language we somehow lack this page in should still be told how to delete their
 * account, in a language they may not prefer, rather than shown an error.
 */
function legalPageText(page, locale) {
  const forLocale = generated.text[locale] || generated.text[FALLBACK_LOCALE];
  return (forLocale && forLocale[page]) || generated.text[FALLBACK_LOCALE][page];
}

module.exports = {
  legalPageText,
  pages: generated.pages,
};
