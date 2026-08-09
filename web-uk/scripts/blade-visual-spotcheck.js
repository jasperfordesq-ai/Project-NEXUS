#!/usr/bin/env node
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const http = require('http');
const https = require('https');

const DEFAULT_LARAVEL_BASE_URL = 'http://127.0.0.1:8088';
const DEFAULT_WEB_BASE_URL = 'http://127.0.0.1:5180';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_TENANT_SLUG = 'hour-timebank';

function sharedTenantCheck(name, path, markers) {
  const normalizedPath = String(path || '/');
  return {
    name,
    laravel: { path: `/${DEFAULT_TENANT_SLUG}/accessible${normalizedPath}` },
    web: { path: `/${DEFAULT_TENANT_SLUG}/accessible${normalizedPath}` },
    markers,
    webForbiddenHtml: [`/${DEFAULT_TENANT_SLUG}/alpha`]
  };
}

const DEFAULT_VISUAL_SPOTCHECKS = [
  {
    name: 'tenant-home-hour-timebank',
    laravel: { path: '/hour-timebank/accessible' },
    web: { path: '/hour-timebank/accessible' },
    markers: [
      'Accessible',
      'Connecting Communities',
      'What you can do'
    ],
    webForbiddenHtml: ['/alpha']
  },
  {
    name: 'master-domain-root',
    laravelBootstrap: { host: 'project-nexus.ie' },
    web: { host: 'project-nexus.ie', path: '/' },
    bootstrapMarkerPaths: ['seo.h1_headline'],
    webForbiddenHtml: ['/alpha', '/accessible']
  },
  {
    name: 'cluster-domain-root',
    laravelBootstrap: { host: 'timebank.global' },
    web: { host: 'timebank.global', path: '/' },
    bootstrapMarkerPaths: ['seo.h1_headline'],
    webForbiddenHtml: ['/alpha', '/accessible']
  },
  sharedTenantCheck('public-login', '/login', [
    'Sign in',
    'Email address',
    'Password'
  ]),
  sharedTenantCheck('public-register', '/register', [
    'Register',
    'Email address',
    'Password'
  ]),
  sharedTenantCheck('public-forgot-password', '/login/forgot-password', [
    'Reset your password',
    'Email address'
  ]),
  sharedTenantCheck('public-reset-password', '/password/reset?token=reset-token', [
    'Choose a new password',
    'New password',
    'Confirm new password'
  ]),
  sharedTenantCheck('public-contact', '/contact', [
    'Contact Us',
    'Name',
    'Email',
    'Message'
  ]),
  sharedTenantCheck('public-cookie-settings', '/cookies', [
    'Cookies',
    'Analytics cookies',
    'Save cookie settings'
  ]),
  sharedTenantCheck('public-about', '/about', [
    'About TimeBank Ireland',
    'How it works',
    'Our values'
  ]),
  sharedTenantCheck('public-guide', '/guide', [
    'How timebanking works',
    'One hour always equals one time credit',
    'The three steps'
  ]),
  sharedTenantCheck('public-features', '/features', [
    'Features',
    'What you can do in this community',
    'Earn and spend time credits'
  ]),
  sharedTenantCheck('public-faq', '/faq', [
    'Frequently asked questions',
    'What is a time credit?',
    'One hour always equals one time credit'
  ]),
  sharedTenantCheck('public-help', '/help', [
    'Help centre',
    'Search help topics',
    'Account & Privacy'
  ]),
  sharedTenantCheck('public-trust-safety', '/trust-and-safety', [
    'Trust and safety',
    'Report a safeguarding concern',
    'How exchanges work'
  ]),
  sharedTenantCheck('public-accessibility', '/accessibility', [
    'Accessibility statement',
    'Our commitment',
    'WCAG 2.2 Level AA'
  ]),
  sharedTenantCheck('public-legal-hub', '/legal', [
    'Legal',
    'Terms',
    'Privacy'
  ]),
  sharedTenantCheck('public-privacy-policy', '/legal/privacy', [
    'Privacy policy',
    'Personal data',
    'Your rights'
  ]),
  sharedTenantCheck('public-report-problem', '/report-a-problem', [
    'Contact Us'
  ])
];

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function joinUrl(baseUrl, pathValue) {
  const base = stripTrailingSlash(baseUrl);
  const path = String(pathValue || '/');
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeVisibleText(html) {
  return decodeEntities(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function createHeadersFacade(headers) {
  const lowerHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    lowerHeaders[name.toLowerCase()] = value;
  }

  return {
    get(name) {
      const value = lowerHeaders[String(name || '').toLowerCase()];
      if (Array.isArray(value)) return value.join(', ');
      return value || null;
    }
  };
}

async function requestWithHostHeader({ url, timeoutMs, hostHeader, extraHeaders = {} }) {
  const parsedUrl = new URL(url);
  const transport = parsedUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: `${parsedUrl.pathname}${parsedUrl.search}`,
      method: 'GET',
      headers: { ...extraHeaders, Host: hostHeader }
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const status = response.statusCode || 0;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          headers: createHeadersFacade(response.headers),
          text: async () => buffer.toString('utf8')
        });
      });
    });

    const timer = setTimeout(() => {
      request.destroy(new Error(`Request to ${url} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    request.on('error', reject);
    request.on('close', () => clearTimeout(timer));
    request.end();
  });
}

async function fetchPage({ fetchImpl, timeoutMs, baseUrl, page }) {
  const url = joinUrl(baseUrl, page.path || '/');
  if (page.host) {
    const extraHeaders = page.headers || {};
    if (fetchImpl !== globalThis.fetch) {
      return fetchImpl(url, { hostHeader: page.host, headers: extraHeaders });
    }
    return requestWithHostHeader({ url, timeoutMs, hostHeader: page.host, extraHeaders });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function dataFromBootstrapPayload(payload) {
  return payload?.data || payload?.tenant || payload || {};
}

function valueAtPath(value, path) {
  return String(path || '')
    .split('.')
    .filter(Boolean)
    .reduce((current, key) => current && current[key], value);
}

async function fetchLaravelBootstrap({ fetchImpl, timeoutMs, laravelBaseUrl, bootstrap }) {
  const host = String(bootstrap.host || '').trim();
  const page = {
    path: bootstrap.path || '/api/v2/tenant/bootstrap',
    host,
    headers: host ? { Origin: `https://${host}` } : {}
  };

  return fetchPage({
    fetchImpl,
    timeoutMs,
    baseUrl: laravelBaseUrl,
    page
  });
}

async function parseJsonResponse(response) {
  const text = await response.text();
  return JSON.parse(text);
}

function resolveOptions(options = {}, env = process.env) {
  return {
    laravelBaseUrl: stripTrailingSlash(options.laravelBaseUrl || env.LARAVEL_BASE_URL || DEFAULT_LARAVEL_BASE_URL),
    webBaseUrl: stripTrailingSlash(options.webBaseUrl || env.WEB_UK_BASE_URL || DEFAULT_WEB_BASE_URL),
    timeoutMs: Number(options.timeoutMs || env.VISUAL_SPOTCHECK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    checks: options.checks || DEFAULT_VISUAL_SPOTCHECKS,
    fetchImpl: options.fetchImpl || globalThis.fetch
  };
}

function missingMarkers(markers, text) {
  const haystack = String(text || '').toLowerCase();
  return markers.filter((marker) => !haystack.includes(String(marker).toLowerCase()));
}

function forbiddenHtmlMatches(forbiddenHtml, html) {
  const haystack = String(html || '').toLowerCase();
  return forbiddenHtml.filter((item) => haystack.includes(String(item).toLowerCase()));
}

async function runBladeVisualSpotcheck(options = {}) {
  const config = resolveOptions(options);
  if (typeof config.fetchImpl !== 'function') {
    throw new Error('A fetch implementation is required to run the Blade visual spotcheck.');
  }

  const checks = [];

  for (const check of config.checks) {
    try {
      if (check.laravelBootstrap) {
        const [bootstrapResponse, webResponse] = await Promise.all([
          fetchLaravelBootstrap({
            fetchImpl: config.fetchImpl,
            timeoutMs: config.timeoutMs,
            laravelBaseUrl: config.laravelBaseUrl,
            bootstrap: check.laravelBootstrap
          }),
          fetchPage({
            fetchImpl: config.fetchImpl,
            timeoutMs: config.timeoutMs,
            baseUrl: config.webBaseUrl,
            page: check.web || {}
          })
        ]);

        const bootstrapPayload = await parseJsonResponse(bootstrapResponse);
        const bootstrapData = dataFromBootstrapPayload(bootstrapPayload);
        const bootstrapMarkerPaths = check.bootstrapMarkerPaths || [];
        const bootstrapMarkers = bootstrapMarkerPaths
          .map((path) => valueAtPath(bootstrapData, path))
          .filter((marker) => marker !== undefined && marker !== null && String(marker).trim() !== '')
          .map(String);
        const missingInBootstrap = bootstrapMarkerPaths.filter((path) => {
          const value = valueAtPath(bootstrapData, path);
          return value === undefined || value === null || String(value).trim() === '';
        });
        const markers = [
          ...(check.markers || []),
          ...bootstrapMarkers
        ];
        const webHtml = await webResponse.text();
        const webText = normalizeVisibleText(webHtml);
        const missingInWeb = missingMarkers(markers, webText);
        const forbiddenInWeb = forbiddenHtmlMatches(check.webForbiddenHtml || [], webHtml);
        const ok = bootstrapResponse.ok
          && webResponse.ok
          && missingInBootstrap.length === 0
          && missingInWeb.length === 0
          && forbiddenInWeb.length === 0;

        checks.push({
          name: check.name,
          ok,
          laravelStatus: bootstrapResponse.status,
          webStatus: webResponse.status,
          laravelPath: check.laravelBootstrap?.path || '/api/v2/tenant/bootstrap',
          webPath: check.web?.path || '/',
          laravelHost: check.laravelBootstrap?.host || '',
          webHost: check.web?.host || '',
          markers,
          bootstrapMarkerPaths,
          missingInBootstrap,
          missingInLaravel: [],
          missingInWeb,
          forbiddenInWeb
        });
        continue;
      }

      const [laravelResponse, webResponse] = await Promise.all([
        fetchPage({
          fetchImpl: config.fetchImpl,
          timeoutMs: config.timeoutMs,
          baseUrl: config.laravelBaseUrl,
          page: check.laravel || {}
        }),
        fetchPage({
          fetchImpl: config.fetchImpl,
          timeoutMs: config.timeoutMs,
          baseUrl: config.webBaseUrl,
          page: check.web || {}
        })
      ]);

      const laravelHtml = await laravelResponse.text();
      const webHtml = await webResponse.text();
      const laravelText = normalizeVisibleText(laravelHtml);
      const webText = normalizeVisibleText(webHtml);
      const markers = check.markers || [];
      const missingInLaravel = missingMarkers(markers, laravelText);
      const missingInWeb = missingMarkers(markers, webText);
      const forbiddenInWeb = forbiddenHtmlMatches(check.webForbiddenHtml || [], webHtml);
      const ok = laravelResponse.ok
        && webResponse.ok
        && missingInLaravel.length === 0
        && missingInWeb.length === 0
        && forbiddenInWeb.length === 0;

      checks.push({
        name: check.name,
        ok,
        laravelStatus: laravelResponse.status,
        webStatus: webResponse.status,
        laravelPath: check.laravel?.path || '/',
        webPath: check.web?.path || '/',
        laravelHost: check.laravel?.host || '',
        webHost: check.web?.host || '',
        markers,
        missingInLaravel,
        missingInWeb,
        forbiddenInWeb
      });
    } catch (error) {
      checks.push({
        name: check.name,
        ok: false,
        error: error.message
      });
    }
  }

  return {
    ok: checks.every((check) => check.ok),
    laravelBaseUrl: config.laravelBaseUrl,
    webBaseUrl: config.webBaseUrl,
    checks
  };
}

async function main() {
  const result = await runBladeVisualSpotcheck();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_VISUAL_SPOTCHECKS,
  normalizeVisibleText,
  resolveOptions,
  runBladeVisualSpotcheck
};
