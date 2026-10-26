// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const localeStorage = new AsyncLocalStorage();

// `region` is the community's formatting region (ISO 3166-1 alpha-2), carried
// beside the language so every date and number formatted during the request
// follows the community's conventions while the words follow the member's
// language. See localeForIntl in ./localization.
function runWithRequestLocale(locale, callback, region = null) {
  return localeStorage.run({ locale, region }, callback);
}

function getRequestLocale() {
  return localeStorage.getStore()?.locale || null;
}

function getRequestRegion() {
  return localeStorage.getStore()?.region || null;
}

module.exports = {
  getRequestLocale,
  getRequestRegion,
  runWithRequestLocale
};
