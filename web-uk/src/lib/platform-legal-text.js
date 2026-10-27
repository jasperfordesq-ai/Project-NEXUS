// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * The body of the platform's own three legal documents (Project NEXUS, not any
 * community): /platform/terms, /platform/privacy and /platform/disclaimer.
 *
 * Generated from React's page files — see scripts/build-platform-legal-text.js for
 * why the body has exactly one source and is canonically English, while the page
 * chrome around it is translated in lang/<locale>/govuk_alpha_platform_legal.php.
 */

const generated = require('./generated/platform-legal-text.json');

const DOCUMENT_KEYS = Object.freeze(Object.keys(generated.documents));

/** The URL each document is published at, identical on both frontends. */
const PLATFORM_LEGAL_PATHS = Object.freeze({
  terms: '/platform/terms',
  privacy: '/platform/privacy',
  disclaimer: '/platform/disclaimer'
});

function platformLegalDocument(key) {
  return Object.prototype.hasOwnProperty.call(generated.documents, key)
    ? generated.documents[key]
    : null;
}

module.exports = {
  DOCUMENT_KEYS,
  PLATFORM_LEGAL_LANGUAGE: generated.language,
  PLATFORM_LEGAL_PATHS,
  platformLegalDocument
};
