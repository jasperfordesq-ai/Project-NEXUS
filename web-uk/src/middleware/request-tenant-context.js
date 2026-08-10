// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { runWithRequestTenant } = require('../lib/request-tenant-context');

function requestTenantContext(req, _res, next) {
  const routedTenantSlug = req.accessibleRouting?.tenantSlug
    || req.accessibleRouting?.tenant?.slug
    || null;
  return runWithRequestTenant(routedTenantSlug, next);
}

module.exports = { requestTenantContext };
