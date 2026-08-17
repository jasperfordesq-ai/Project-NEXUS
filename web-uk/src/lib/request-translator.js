// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { createTranslator } = require('./localization');
const { getRequestLocale } = require('./request-locale-context');

// 🔴 The reason this exists. Modules that format values outside a route handler have no
// `res.locals.t`, so several reached for `createTranslator('en')` at module load — a
// translator permanently pinned to English, which then rendered English strings to every
// member whatever their language. The request locale is already carried in
// AsyncLocalStorage (see request-locale-context.js, and request-intl-locale.js which does
// exactly this for number and date formatting), so a per-call translator needs no
// threading through call sites. Falls back to English outside a request, which is what
// tests and start-up code get.
function getRequestTranslator() {
  return createTranslator(getRequestLocale() || 'en');
}

function translateForRequest(key, replacements = {}) {
  return getRequestTranslator()(key, replacements);
}

module.exports = { getRequestTranslator, translateForRequest };
