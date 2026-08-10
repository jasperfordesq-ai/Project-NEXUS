// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');

const tenantStorage = new AsyncLocalStorage();

function normalizeTenantSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  return /^[a-z0-9_-]+$/.test(slug) ? slug : null;
}

function runWithRequestTenant(tenantSlug, callback) {
  return tenantStorage.run({ tenantSlug: normalizeTenantSlug(tenantSlug) }, callback);
}

function getRequestTenantSlug() {
  return tenantStorage.getStore()?.tenantSlug || null;
}

module.exports = {
  getRequestTenantSlug,
  normalizeTenantSlug,
  runWithRequestTenant
};
