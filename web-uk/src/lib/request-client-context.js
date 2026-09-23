// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { isIP } = require('node:net');

// The visitor's address for the request being served, so every Laravel API call
// made on its behalf can say who it is for (F-110). Without it every call arrives
// from web-uk's own container address and Laravel's per-address limits (sign-in
// lockout, password reset, verification resend) are shared by every visitor.
const clientStorage = new AsyncLocalStorage();

function normalizeClientIp(value) {
  let ip = String(value || '').trim();
  if (ip.toLowerCase().startsWith('::ffff:') && isIP(ip.slice(7)) === 4) {
    ip = ip.slice(7);
  }
  return isIP(ip) ? ip : null;
}

function runWithRequestClient(clientIp, callback) {
  return clientStorage.run({ clientIp: normalizeClientIp(clientIp) }, callback);
}

function getRequestClientIp() {
  return clientStorage.getStore()?.clientIp || null;
}

module.exports = {
  getRequestClientIp,
  normalizeClientIp,
  runWithRequestClient
};
