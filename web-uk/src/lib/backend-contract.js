// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const DEFAULT_LARAVEL_BASE_URL = 'http://127.0.0.1:8088';
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

module.exports = {
  DEFAULT_ASPNET_BASE_URL,
  DEFAULT_LARAVEL_BASE_URL,
  getApiBaseUrl,
  resolveBackendContract
};
