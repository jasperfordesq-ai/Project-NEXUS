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
