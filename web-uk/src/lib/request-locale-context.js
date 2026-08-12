// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const localeStorage = new AsyncLocalStorage();

function runWithRequestLocale(locale, callback) {
  return localeStorage.run({ locale }, callback);
}

function getRequestLocale() {
  return localeStorage.getStore()?.locale || null;
}

module.exports = {
  getRequestLocale,
  runWithRequestLocale
};
