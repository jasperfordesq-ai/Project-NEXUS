// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const DEFAULT_BASE_URL = 'http://127.0.0.1:5080';
const DEFAULT_TENANT = 'hour-timebank';

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

async function check(fetchImpl, baseUrl, name, path, options = {}) {
  try {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(options.timeoutMs || 30_000),
      headers: options.headers || {}
    });
    const body = await response.text();
    const bodyOk = typeof options.validateBody === 'function' ? options.validateBody(body) : true;
    return {
      name,
      ok: response.status === options.expectedStatus && bodyOk,
      expectedStatus: options.expectedStatus,
      actualStatus: response.status,
      bodyOk,
      body: body.slice(0, 500)
    };
  } catch (error) {
    return {
      name,
      ok: false,
      expectedStatus: options.expectedStatus,
      actualStatus: 0,
      body: error.message
    };
  }
}

async function runAspNetReadinessAudit(options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch;
  const baseUrl = stripTrailingSlash(options.baseUrl || process.env.ASPNET_BASE_URL || DEFAULT_BASE_URL);
  const tenant = options.tenant || process.env.ASPNET_SMOKE_TENANT || DEFAULT_TENANT;
  const tenantHeaders = { 'X-Tenant-Slug': tenant };
  const encodedTenant = encodeURIComponent(tenant);

  const checks = await Promise.all([
    check(fetchImpl, baseUrl, 'health', '/health', { expectedStatus: 200 }),
    check(fetchImpl, baseUrl, 'tenant-bootstrap-by-slug', `/api/v2/tenant/bootstrap?slug=${encodedTenant}`, {
      expectedStatus: 200,
      headers: tenantHeaders,
      validateBody: (body) => {
        try {
          const tenantData = JSON.parse(body)?.data;
          return Number.isInteger(tenantData?.id)
            && tenantData.id > 0
            && typeof tenantData?.name === 'string'
            && tenantData.name.trim() !== ''
            && typeof tenantData?.slug === 'string'
            && tenantData.slug.trim() !== ''
            && tenantData?.modules !== null
            && typeof tenantData?.modules === 'object'
            && !Array.isArray(tenantData.modules)
            && tenantData?.features !== null
            && typeof tenantData?.features === 'object'
            && !Array.isArray(tenantData.features)
            && typeof tenantData?.compliance?.insurance_enabled === 'boolean';
        } catch {
          return false;
        }
      }
    }),
    check(fetchImpl, baseUrl, 'platform-stats-by-slug', '/api/v2/platform/stats', {
      expectedStatus: 200,
      headers: tenantHeaders,
      validateBody: (body) => {
        try {
          const stats = JSON.parse(body)?.data;
          return ['members', 'hours_exchanged', 'listings', 'skills', 'communities']
            .every((key) => typeof stats?.[key] === 'number')
            && ['tenant', 'platform'].includes(stats?.scope);
        } catch {
          return false;
        }
      }
    })
  ]);

  const ready = checks.every((item) => item.ok);
  const health = checks.find((item) => item.name === 'health');
  const tenantChecks = checks.filter((item) => item.name !== 'health');
  const requiresLegacyTenantId = tenantChecks.length > 0
    && tenantChecks.every((item) => item.actualStatus === 400)
    && tenantChecks.some((item) => /X-Tenant-ID header is required/i.test(item.body || ''));
  const runtimeAssessment = ready
    ? {
      status: 'compatible',
      detail: 'The running ASP.NET backend satisfies the public slug-first bootstrap contract.'
    }
    : health?.ok && requiresLegacyTenantId
      ? {
        status: 'stale-tenant-middleware',
        detail: 'The process is healthy but still requires legacy X-Tenant-ID routing on public v2 endpoints. Rebuild or replace the local runtime from current source before retrying.'
      }
      : {
        status: health?.ok ? 'contract-incomplete' : 'backend-unavailable',
        detail: health?.ok
          ? 'The process is healthy but one or more public ASP.NET compatibility contracts are incomplete.'
          : 'The ASP.NET health endpoint is unavailable.'
      };

  return {
    target: 'aspnet',
    baseUrl,
    tenant,
    ready,
    runtimeAssessment,
    checks
  };
}

if (require.main === module) {
  runAspNetReadinessAudit().then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 1;
  });
}

module.exports = { runAspNetReadinessAudit };
