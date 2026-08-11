// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const DEFAULT_LARAVEL_BASE_URL = 'http://127.0.0.1:8090';
const DEFAULT_ASPNET_BASE_URL = 'http://localhost:5080';

const targetStatus = {
  laravel: 'source-of-truth',
  aspnet: 'future-not-certified'
};

function stripTrailingSlash(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function resolveBackendContract(env = process.env) {
  const target = String(env.ACCESSIBLE_BACKEND_TARGET || 'laravel').trim().toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(targetStatus, target)) {
    throw new Error(`Unsupported accessible backend target: ${target}`);
  }

  const isExplicitApiOverride = Boolean(String(env.API_BASE_URL || '').trim());
  const baseUrlSource = isExplicitApiOverride
    ? 'api-base-url'
    : `${target}-base-url`;
  const targetDefaultBaseUrl = target === 'aspnet'
    ? (env.ASPNET_BASE_URL || DEFAULT_ASPNET_BASE_URL)
    : (env.LARAVEL_BASE_URL || DEFAULT_LARAVEL_BASE_URL);

  return {
    target,
    baseUrl: stripTrailingSlash(env.API_BASE_URL || targetDefaultBaseUrl),
    baseUrlSource,
    status: targetStatus[target]
  };
}

function getApiBaseUrl(env = process.env) {
  return resolveBackendContract(env).baseUrl;
}

/**
 * The backend origin as a BROWSER must reach it, which is not always the origin
 * this server uses.
 *
 * 🔴 In Docker the API is reached at `http://host.docker.internal:8090`, a
 * hostname that resolves inside the container and NOT on the developer's
 * machine. Tenant logo `src` attributes and the CSP `img-src` allowlist are
 * consumed by the browser, so building them from the server-to-server origin
 * produces a broken image and a policy that permits an unreachable host. Found
 * for real the first time a tenant had a logo uploaded — nothing had exercised
 * it before, because no local tenant had one.
 *
 * Set `PUBLIC_ASSET_BASE_URL` when the two differ. It falls back to the API
 * origin, so single-origin setups (production, native `npm run dev`) need no
 * configuration and behave exactly as before.
 */
function getPublicAssetBaseUrl(env = process.env) {
  const configured = String(env.PUBLIC_ASSET_BASE_URL || '').trim();
  return configured ? stripTrailingSlash(configured) : getApiBaseUrl(env);
}

module.exports = {
  DEFAULT_ASPNET_BASE_URL,
  DEFAULT_LARAVEL_BASE_URL,
  getApiBaseUrl,
  getPublicAssetBaseUrl,
  resolveBackendContract
};
