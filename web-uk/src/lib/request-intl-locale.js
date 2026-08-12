// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { localeForIntl } = require('./localization');
const { getRequestLocale } = require('./request-locale-context');

function getRequestIntlLocale() {
  return localeForIntl(getRequestLocale() || 'en');
}

module.exports = { getRequestIntlLocale };
