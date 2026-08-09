'use strict';

const { localeForIntl } = require('./localization');
const { getRequestLocale } = require('./request-locale-context');

function getRequestIntlLocale() {
  return localeForIntl(getRequestLocale() || 'en');
}

module.exports = { getRequestIntlLocale };
