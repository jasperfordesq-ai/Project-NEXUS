#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Prerender Worker - runs inside a Playwright Docker container.
 *
 * Reads a JSON manifest from stdin:
 *   { "urls": [{ "url": "https://hour-timebank.ie/about", "output": "/out/hour-timebank.ie/about/index.html" }, ...] }
 *
 * Visits each URL with headless Chromium, waits for React to render with
 * real tenant data, and saves the fully rendered HTML to the output path.
 */

import { chromium } from 'playwright';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { dirname, resolve, sep } from 'path';
import { pathToFileURL } from 'url';

const TIMEOUT = 30000;
const SETTLE_TIME = 2000; // Wait for React hydration + API calls
const CONCURRENCY = Math.max(1, Number.parseInt(process.env.PRERENDER_CONCURRENCY || '4', 10) || 4);
// The publish contract below accepts only complete 200 documents. Any other
// status from <meta name="prerender-status-code"> is retained and rejected.
const ALLOW_PRIVATE_HOSTS = process.env.PRERENDER_ALLOW_PRIVATE_HOSTS === '1';
const PUBLIC_HOST_CACHE = new Map();
const PUBLIC_HOST_CACHE_MS = 30000;
const OUTPUT_ROOT = resolve('/output');
const ROUTE_RE = /^\/[A-Za-z0-9._~/%:@!$()*+,;=\-]*$/;
const MAINTENANCE_AUTH_SECRET = '/run/secrets/nexus-prerender-maintenance';

function readMaintenanceAuthToken(path = MAINTENANCE_AUTH_SECRET) {
  try {
    const token = readFileSync(path, 'utf-8').trim();
    if (!/^[A-Za-z0-9+/=]{48,256}$/.test(token)) {
      throw new Error('private maintenance render credential has an invalid format');
    }
    return token;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function maintenanceAuthHeaders(entry, requestUrl, currentHeaders, token) {
  if (!token) return null;
  const requested = new URL(requestUrl);
  const canonical = new URL(entry.canonicalUrl);
  if (requested.origin !== canonical.origin) return null;

  return {
    ...currentHeaders,
    authorization: `Basic ${Buffer.from(`prerender:${token}`, 'utf-8').toString('base64')}`,
  };
}

function normalizeManifestRoute(route) {
  if (typeof route !== 'string' || route.length > 1024 || !ROUTE_RE.test(route)) return null;
  if (route !== '/') route = route.replace(/\/+$/, '');
  route ||= '/';
  if (route.includes('//') || /(?:^|\/)\.{1,2}(?:\/|$)/.test(route)) return null;
  if (/%(?![0-9A-Fa-f]{2})/.test(route) || /%(?:00|25|2e|2f|5c)/i.test(route)) return null;
  return route;
}

function validateManifestEntry(entry) {
  if (!entry || typeof entry !== 'object') throw new Error('manifest entry must be an object');
  if (!/^[1-9][0-9]*$/.test(String(entry.tenantId || ''))) {
    throw new Error('manifest entry has an invalid tenantId');
  }
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(String(entry.tenantSlug || ''))) {
    throw new Error('manifest entry has an invalid tenantSlug');
  }
  if (normalizeManifestRoute(entry.route) !== entry.route) {
    throw new Error(`manifest entry has an unsafe or non-canonical route: ${entry.route}`);
  }

  let canonical;
  let renderUrl;
  try {
    canonical = new URL(entry.canonicalUrl);
    renderUrl = new URL(entry.url);
  } catch {
    throw new Error('manifest entry contains an invalid URL');
  }
  const host = String(entry.host || '').toLowerCase().replace(/\.$/, '');
  if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes('..')) {
    throw new Error(`manifest entry has an unsafe host: ${entry.host}`);
  }
  if (canonical.protocol !== 'https:' || canonical.hostname.toLowerCase() !== host
      || renderUrl.hostname.toLowerCase() !== host
      || normalizedDocumentUrl(renderUrl.href) !== normalizedDocumentUrl(canonical.href)) {
    throw new Error('manifest URL, canonical URL, and host do not identify the same document');
  }

  let canonicalPath = canonical.pathname;
  if (canonicalPath !== '/') canonicalPath = canonicalPath.replace(/\/+$/, '');
  canonicalPath ||= '/';
  if (normalizeManifestRoute(canonicalPath) !== canonicalPath) {
    throw new Error(`manifest canonical path is unsafe: ${canonical.pathname}`);
  }
  const expectedCachePath = `${host}${canonicalPath === '/' ? '' : canonicalPath}/index.html`;
  if (entry.cachePath !== expectedCachePath) {
    throw new Error(`manifest cachePath mismatch: expected ${expectedCachePath}`);
  }
  const expectedOutput = `${OUTPUT_ROOT}${sep}${expectedCachePath.split('/').join(sep)}`;
  const resolvedOutput = resolve(String(entry.output || ''));
  if (resolvedOutput !== expectedOutput || !resolvedOutput.startsWith(`${OUTPUT_ROOT}${sep}`)) {
    throw new Error('manifest output escapes /output or does not match cachePath');
  }
  return entry;
}

function validateManifest(manifest) {
  if (!manifest || !Array.isArray(manifest.urls) || manifest.urls.length === 0) {
    throw new Error('No URLs in manifest');
  }
  const cachePaths = new Set();
  const outputs = new Set();
  for (const entry of manifest.urls) {
    validateManifestEntry(entry);
    if (cachePaths.has(entry.cachePath) || outputs.has(entry.output)) {
      throw new Error(`duplicate manifest output: ${entry.cachePath}`);
    }
    cachePaths.add(entry.cachePath);
    outputs.add(entry.output);
  }
  return manifest;
}

function isNonPublicAddress(address) {
  const value = String(address || '').toLowerCase().split('%')[0];
  const mappedV4 = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedV4) return isNonPublicAddress(mappedV4);

  if (isIP(value) === 4) {
    const octets = value.split('.').map(Number);
    const [a, b, c] = octets;
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 168)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }

  if (isIP(value) === 6) {
    if (value === '::' || value === '::1') return true;
    if (/^(?:fc|fd|fe[89ab]|ff)/.test(value)) return true;
    if (/^2001:(?:db8|0?10|0?2):/.test(value)) return true;
    const first = Number.parseInt(value.split(':')[0] || '0', 16);
    return !Number.isFinite(first) || first < 0x2000 || first > 0x3fff;
  }

  return true;
}

async function assertPublicHostname(hostname) {
  if (ALLOW_PRIVATE_HOSTS) return;
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`non-public hostname is not allowed: ${host || '(empty)'}`);
  }

  const cached = PUBLIC_HOST_CACHE.get(host);
  if (cached && cached.expiresAt > Date.now()) {
    await cached.verification;
    return;
  }

  const verification = (async () => {
    const resolved = isIP(host)
      ? [{ address: host }]
      : await lookup(host, { all: true, verbatim: true });
    if (!resolved.length || resolved.some(({ address }) => isNonPublicAddress(address))) {
      throw new Error(`hostname resolves to a non-public address: ${host}`);
    }
  })();
  PUBLIC_HOST_CACHE.set(host, { expiresAt: Date.now() + PUBLIC_HOST_CACHE_MS, verification });
  try {
    await verification;
  } catch (error) {
    PUBLIC_HOST_CACHE.delete(host);
    throw error;
  }
}

async function assertPublicUrl(value) {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`unsupported URL protocol: ${parsed.protocol}`);
  }
  await assertPublicHostname(parsed.hostname);
}

async function waitForUsefulRender(page) {
  // Honour an app-level readiness signal if the page provides one. Patterns:
  //   window.prerenderReady = false  (default — explicit "still loading")
  //   window.prerenderReady = true   (set when data + UI are ready)
  // If the signal is never set, fall back to the DOM-content heuristic so
  // routes that haven't opted in still render usefully.
  const readyResult = await page.waitForFunction(() => {
    if (window.prerenderReady === true) return 'signal';
    if (window.prerenderReady === false) return false; // explicit "wait"
    const root = document.querySelector('#root');
    const bodyText = document.body?.innerText?.trim() || '';
    return Boolean(root?.children.length) && bodyText.length > 200 ? 'heuristic' : false;
  }, { timeout: 15000 }).catch(() => null);
  return readyResult ? await readyResult.jsonValue() : null;
}

/**
 * Extract the page's intended HTTP status code from a meta tag emitted by
 * the React app (e.g. NotFoundPage, TenantShell community-not-found,
 * MaintenancePage). Returns 200 only when the tag is absent. Invalid or
 * unsupported values are returned to the publish contract and rejected.
 */
async function extractStatusCode(page) {
  try {
    const raw = await page.evaluate(() => {
      const el = document.querySelector('meta[name="prerender-status-code"]');
      return el ? el.getAttribute('content') : null;
    });
    if (!raw) return 200;
    const n = Number.parseInt(raw, 10);
    if (!Number.isFinite(n)) return null;
    return n;
  } catch {
    return null;
  }
}

/**
 * Extract a Location URL for 3xx status codes from the standard meta refresh
 * pattern or a `prerender-header` meta tag emitted by the app. Returns null
 * if status isn't a redirect or no target is found.
 */
async function extractRedirectTarget(page, status) {
  if (status !== 301 && status !== 302) return null;
  try {
    return await page.evaluate(() => {
      const headerMeta = document.querySelector('meta[name="prerender-header"][content^="Location:" i]');
      if (headerMeta) {
        const v = headerMeta.getAttribute('content') || '';
        const idx = v.toLowerCase().indexOf('location:');
        if (idx !== -1) return v.slice(idx + 9).trim() || null;
      }
      const canonical = document.querySelector('link[rel="canonical"]');
      return canonical ? canonical.getAttribute('href') : null;
    });
  } catch {
    return null;
  }
}

function isApiPath(pathname) {
  return /\/(?:api\/)?v2(?:\/|$)/.test(String(pathname || ''));
}

async function waitForApiSettlement(page, pendingApiRequests, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let emptySince = null;
  while (Date.now() < deadline) {
    if (pendingApiRequests.size === 0) {
      emptySince ??= Date.now();
      if (Date.now() - emptySince >= 500) return true;
    } else {
      emptySince = null;
    }
    await page.waitForTimeout(100);
  }
  return pendingApiRequests.size === 0;
}

async function renderPage(page, url, pendingApiRequests = new Map()) {
  const navigationResponse = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });

  const readiness = await waitForUsefulRender(page);

  // Wait for React Helmet to inject meta tags
  await page.waitForSelector('[data-rh]', { timeout: 10000 }).catch(() => {});

  // Network idle is useful when it happens, but public pages can contain
  // authenticated pollers or third-party noise. The render contract is DOM
  // content plus SEO tags, so do not let a stray request block the whole tenant.
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Extra settle time for tenant bootstrap + content rendering
  await page.waitForTimeout(SETTLE_TIME);

  // `networkidle` is deliberately best-effort because third-party widgets can
  // remain chatty, but every first-party API request must finish. Otherwise a
  // loading skeleton can satisfy the old text-length heuristic and be cached.
  const apiSettled = await waitForApiSettlement(page, pendingApiRequests);

  // Strip dynamically injected Google Maps assets. They are added at runtime
  // by APIProvider. Leaving them in the prerendered HTML causes double-loading
  // when the SPA boots.
  await page.evaluate(() => {
    const HOST_RE = /maps\.googleapis\.com|maps-api-v3|maps\.gstatic\.com/;
    document.querySelectorAll('script[src]').forEach((s) => {
      if (HOST_RE.test(s.getAttribute('src') || '')) s.remove();
    });
    document.querySelectorAll('link[href]').forEach((l) => {
      const rel = (l.getAttribute('rel') || '').toLowerCase();
      const href = l.getAttribute('href') || '';
      if (
        (rel.includes('preload') || rel.includes('modulepreload') ||
         rel.includes('prefetch') || rel.includes('preconnect') ||
         rel.includes('dns-prefetch')) &&
        HOST_RE.test(href)
      ) {
        l.remove();
      }
    });
  });

  const status = await extractStatusCode(page);
  const redirect = await extractRedirectTarget(page, status);
  const pageContract = await page.evaluate(() => ({
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || null,
    errorBoundary: document.querySelector('[data-prerender-error-boundary="true"]') !== null,
    robots: document.querySelector('meta[name="robots"]')?.getAttribute('content') || null,
    title: (document.title || '').trim(),
    bodyTextLength: (document.body?.innerText || '').trim().length,
  }));
  const html = stripNonCoreModulePreloads(await page.content());
  const markdown = status === 200 ? await extractMarkdown(page) : null;
  return {
    html,
    status,
    redirect,
    readiness,
    markdown,
    pageContract,
    navigationStatus: navigationResponse?.status() ?? null,
    finalUrl: page.url(),
    apiSettled,
    pendingApiPaths: [...pendingApiRequests.values()].slice(0, 10),
  };
}

async function renderedTenantIdentity(page) {
  return page.evaluate(() => ({
    id: window.localStorage.getItem('nexus_tenant_id'),
    slug: window.localStorage.getItem('nexus_tenant_slug'),
  }));
}

// 🔴 TWO faults, deliberately worded so they can never be confused.
//
// Until 2026-09-19 both threw the same `tenant identity mismatch` text, which
// made the dangerous one invisible. Measured over 30 hours of production
// renders: 14 pages failed out of 22,228 (0.06%), of which 8 were the harmless
// fault — the page reported NO tenant at all (`got -#-`) because the tenant
// bootstrap did not complete during that render — and ZERO were the dangerous
// one. An operator who dismisses that message daily, correctly, would dismiss
// a genuine cross-tenant leak arriving in the same words.
//
//   unresolved -> the page resolved no tenant. Transport/bootstrap failure.
//                 Routine, self-healing: the snapshot is discarded, the
//                 previous one is kept, and the next sweep re-renders it.
//   mismatch   -> the page resolved a DIFFERENT tenant. One community's
//                 content was rendered under another's host. Never routine.
//
// A partially resolved identity (one key present) is reported as a MISMATCH on
// purpose: the page did resolve something, and under-reporting a real leak is
// far worse than one spurious alarm.
function assertExpectedTenant(entry, identity) {
  const expectedId = String(entry.tenantId ?? '');
  const expectedSlug = String(entry.tenantSlug ?? '');
  if (!expectedId || !expectedSlug) {
    throw new Error('manifest entry is missing tenant identity');
  }

  const actualId = String(identity?.id ?? '');
  const actualSlug = String(identity?.slug ?? '');
  if (actualId === expectedId && actualSlug === expectedSlug) return;

  if (!actualId && !actualSlug) {
    const error = new Error(
      `tenant identity unresolved for ${expectedSlug}#${expectedId} — the page reported no tenant, `
      + 'so its bootstrap did not complete during this render; snapshot discarded, previous one kept',
    );
    error.tenantIdentityFault = 'unresolved';
    throw error;
  }

  const error = new Error(
    `tenant identity MISMATCH: expected ${expectedSlug}#${expectedId}, page reported `
    + `${actualSlug || '-'}#${actualId || '-'} — a DIFFERENT tenant was rendered under this host`,
  );
  error.tenantIdentityFault = 'mismatch';
  throw error;
}

function normalizedDocumentUrl(value) {
  const parsed = new URL(value);
  parsed.search = '';
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLowerCase();
  if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString();
}

function isCriticalApiPath(entryRoute, pathname) {
  if (/\/(?:api\/)?v2\/tenant\/bootstrap(?:\/|$)/.test(pathname)) return true;
  if (entryRoute === '/blog') {
    return /\/(?:api\/)?v2\/blog(?:\/categories)?(?:\/|$|\?)/.test(pathname);
  }
  if (/^\/blog\/[^/]+$/.test(entryRoute)) {
    return /\/(?:api\/)?v2\/blog\/[^/]+/.test(pathname);
  }
  if (/^\/page\/[^/]+$/.test(entryRoute)) {
    return /\/(?:api\/)?v2\/pages\/[^/]+/.test(pathname);
  }
  return false;
}

function assertRenderContract(
  entry,
  render,
  apiServerErrors,
  blockedRequests,
  pageErrors = [],
  failedCriticalRequests = [],
) {
  if (!render.readiness) throw new Error('render readiness timed out');
  if (!render.apiSettled) {
    throw new Error(`first-party API requests did not settle (${render.pendingApiPaths.join(', ')})`);
  }
  if (render.navigationStatus !== null && render.navigationStatus >= 400) {
    throw new Error(`navigation returned HTTP ${render.navigationStatus}`);
  }
  // Complete 200 documents and the platform's explicit tenant-maintenance
  // 503 page are publishable. Redirects and content-level 404/410 pages are
  // never cached as successful documents. The publisher installs 503 status
  // sidecars and nginx mappings in the same host-tree transaction.
  if (![200, 503].includes(render.status)) {
    throw new Error(`page declared non-publishable status ${render.status}`);
  }
  if (render.status === 503 && render.redirect) {
    throw new Error('maintenance snapshot must not redirect');
  }
  if (render.pageContract.errorBoundary) throw new Error('React error boundary rendered');
  if (render.status === 200 && /(?:^|[,\s])noindex(?:[,\s]|$)/i.test(render.pageContract.robots || '')) {
    throw new Error('planned 200 route rendered a noindex document');
  }
  if (!render.pageContract.title) throw new Error('rendered document has no title');
  if (render.pageContract.bodyTextLength < 200) throw new Error('rendered document has insufficient visible content');
  if (apiServerErrors.length > 0) {
    throw new Error(`API error during render (${apiServerErrors.slice(0, 3).join(', ')})`);
  }
  if (blockedRequests.length > 0) {
    throw new Error(`blocked non-public request during render (${blockedRequests.slice(0, 3).join(', ')})`);
  }
  if (pageErrors.length > 0) {
    throw new Error(`page error during render (${pageErrors.slice(0, 3).join(', ')})`);
  }
  if (failedCriticalRequests.length > 0) {
    throw new Error(`critical API request failed during render (${failedCriticalRequests.slice(0, 3).join(', ')})`);
  }

  const expected = normalizedDocumentUrl(entry.canonicalUrl || entry.url);
  const actual = normalizedDocumentUrl(render.finalUrl);
  if (actual !== expected) {
    throw new Error(`final URL mismatch (expected ${expected}, got ${actual})`);
  }

  // Canonicals are tenant-configurable. When a tenant explicitly disables
  // them, absence is valid; when present they must still identify this exact
  // route and must never leak the renderer bypass parameter.
  if (render.pageContract.canonical) {
    const canonical = new URL(render.pageContract.canonical, render.finalUrl);
    if (!['http:', 'https:'].includes(canonical.protocol)) {
      throw new Error(`invalid canonical protocol ${canonical.protocol}`);
    }
    if (canonical.searchParams.has('nexus_prerender_bypass')) {
      throw new Error('canonical URL contains the prerender bypass parameter');
    }
    if (normalizedDocumentUrl(canonical.toString()) !== expected) {
      throw new Error(`canonical URL mismatch (expected ${expected}, got ${normalizedDocumentUrl(canonical.toString())})`);
    }
  }
}

function stripNonCoreModulePreloads(html) {
  return html.replace(/<link\b[^>]*>/gi, (tag) => {
    const rel = tag.match(/\brel=["']([^"']+)["']/i)?.[1] || '';
    if (!rel.split(/\s+/).includes('modulepreload')) return tag;

    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1] || '';
    if (/^\/assets\/vendor-(?:react|i18n)-[^/]+\.js$/i.test(href)) return tag;

    return '';
  });
}

/**
 * Convert the rendered DOM to a clean Markdown body for AI crawlers (GPTBot,
 * ClaudeBot, Perplexity, etc). LLMs ingest Markdown more efficiently than
 * full HTML — fewer tokens, less noise, better structural signal.
 *
 * Scope: heading hierarchy, paragraphs, links, lists, code blocks, images.
 * Skips: navigation, footer, ads, scripts. Anything inside <header>, <nav>,
 * <footer>, <aside> is dropped — they're per-page chrome, not content.
 *
 * Best-effort: produces useful Markdown even on tenants that don't use
 * semantic HTML. Returns null on extraction failure.
 */
async function extractMarkdown(page) {
  try {
    return await page.evaluate(() => {
      const ROOT_SELECTORS = ['main', 'article', '[role="main"]', '#root > div > main', '#root'];
      let root = null;
      for (const sel of ROOT_SELECTORS) {
        const found = document.querySelector(sel);
        if (found) { root = found; break; }
      }
      if (!root) return null;

      // Clone so we can mutate without affecting the live DOM (and the HTML
      // snapshot, which is read separately).
      const clone = root.cloneNode(true);
      // Strip chrome + scripts before walking.
      const KILL = ['header', 'nav', 'footer', 'aside', 'script', 'style', 'noscript',
                    'form[role="search"]', '[aria-hidden="true"]', '[data-prerender-skip]'];
      for (const sel of KILL) {
        for (const el of clone.querySelectorAll(sel)) el.remove();
      }

      const out = [];
      const escapeMd = (s) => s.replace(/[\\`*_{}[\]()#+\-.!]/g, (c) => '\\' + c);
      const trimTxt = (s) => (s || '').replace(/\s+/g, ' ').trim();

      // Recursive walker — emits Markdown blocks for known structural nodes,
      // recurses through unknown containers.
      const walk = (node, depth = 0) => {
        if (!node) return;
        if (node.nodeType === 3) {
          const t = trimTxt(node.textContent || '');
          if (t) out.push({ inline: t });
          return;
        }
        if (node.nodeType !== 1) return;
        const tag = node.tagName.toLowerCase();

        const childText = () => {
          const buf = [];
          for (const c of node.childNodes) {
            if (c.nodeType === 3) {
              const t = c.textContent || '';
              if (t.trim()) buf.push(t.replace(/\s+/g, ' '));
            } else if (c.nodeType === 1) {
              const ct = c.tagName.toLowerCase();
              const inner = (c.textContent || '').replace(/\s+/g, ' ').trim();
              if (!inner) continue;
              if (ct === 'a') {
                const href = c.getAttribute('href') || '';
                buf.push(href ? `[${inner}](${href})` : inner);
              } else if (ct === 'strong' || ct === 'b') {
                buf.push(`**${inner}**`);
              } else if (ct === 'em' || ct === 'i') {
                buf.push(`*${inner}*`);
              } else if (ct === 'code') {
                buf.push('`' + inner + '`');
              } else if (ct === 'br') {
                buf.push('\n');
              } else {
                buf.push(inner);
              }
            }
          }
          return buf.join(' ').replace(/ +/g, ' ').trim();
        };

        if (/^h[1-6]$/.test(tag)) {
          const level = parseInt(tag[1], 10);
          const text = (node.textContent || '').trim();
          if (text) out.push({ block: '#'.repeat(level) + ' ' + text });
          return;
        }
        if (tag === 'p') {
          const t = childText();
          if (t) out.push({ block: t });
          return;
        }
        if (tag === 'ul' || tag === 'ol') {
          const items = [];
          let idx = 1;
          for (const li of node.querySelectorAll(':scope > li')) {
            const t = trimTxt(li.textContent || '');
            if (!t) continue;
            items.push(tag === 'ol' ? `${idx++}. ${t}` : `- ${t}`);
          }
          if (items.length) out.push({ block: items.join('\n') });
          return;
        }
        if (tag === 'pre') {
          const code = (node.textContent || '').replace(/\n+$/, '');
          if (code.trim()) out.push({ block: '```\n' + code + '\n```' });
          return;
        }
        if (tag === 'blockquote') {
          const t = (node.textContent || '').trim();
          if (t) out.push({ block: t.split('\n').map((l) => '> ' + l.trim()).join('\n') });
          return;
        }
        if (tag === 'img') {
          const src = node.getAttribute('src') || '';
          const alt = (node.getAttribute('alt') || '').trim();
          if (src) out.push({ block: `![${escapeMd(alt)}](${src})` });
          return;
        }
        if (tag === 'hr') { out.push({ block: '---' }); return; }
        if (tag === 'a' && node.childElementCount === 0) {
          const t = (node.textContent || '').trim();
          const href = node.getAttribute('href') || '';
          if (t && href) out.push({ inline: `[${t}](${href})` });
          return;
        }

        // Default: recurse into children.
        for (const c of node.childNodes) walk(c, depth + 1);
      };
      walk(clone);

      // Compose: blocks separated by blank lines, inline runs merged into paragraphs.
      const lines = [];
      let inlineBuf = [];
      const flushInline = () => {
        if (inlineBuf.length) {
          const p = inlineBuf.join(' ').replace(/ +/g, ' ').trim();
          if (p) lines.push(p);
          inlineBuf = [];
        }
      };
      for (const e of out) {
        if (e.block !== undefined) {
          flushInline();
          lines.push(e.block);
        } else if (e.inline !== undefined) {
          inlineBuf.push(e.inline);
        }
      }
      flushInline();

      const title = (document.querySelector('title')?.textContent || '').trim();
      const desc = (document.querySelector('meta[name="description"]')?.getAttribute('content') || '').trim();
      const canonical = (document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '').trim();

      const header = [
        '---',
        title  ? `title: ${title.replace(/\n/g, ' ')}` : null,
        desc   ? `description: ${desc.replace(/\n/g, ' ')}` : null,
        canonical ? `canonical: ${canonical}` : null,
        `generated: ${new Date().toISOString()}`,
        '---',
        '',
      ].filter(Boolean).join('\n');

      const body = lines.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!body) return null;
      return header + body + '\n';
    });
  } catch {
    return null;
  }
}

async function main() {
  const input = readFileSync('/dev/stdin', 'utf-8');
  const manifest = validateManifest(JSON.parse(input));
  const maintenanceAuthToken = readMaintenanceAuthToken();

  console.log(`Pre-rendering ${manifest.urls.length} pages with concurrency ${CONCURRENCY}...`);

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-webrtc',
      '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    ],
  });

  // Viewport variant. Default desktop; flip to mobile via PRERENDER_VIEWPORT=mobile.
  // Mobile uses a representative iPhone size + Safari Mobile UA so any mobile-only
  // CSS / responsive layouts render correctly. The serving layer (nginx) is
  // currently single-variant, so a `mobile` snapshot is only useful with a
  // follow-up routing change — the option exists so per-route mobile renders
  // can be staged independently of the routing flip.
  const variant = (process.env.PRERENDER_VIEWPORT || 'desktop').toLowerCase();
  const isMobile = variant === 'mobile';
  const contextOptions = {
    serviceWorkers: 'block',
    userAgent: isMobile
      ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 NexusPrerender/1.0'
      : 'NexusPrerender/1.0 (internal; deploy-time rendering)',
    viewport: isMobile ? { width: 414, height: 896 } : { width: 1280, height: 720 },
    isMobile,
    hasTouch: isMobile,
  };
  console.log(`Viewport: ${isMobile ? 'mobile (414x896)' : 'desktop (1280x720)'}`);

  const results = {
    success: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    entries: [],
  };
  const successfulCachePaths = [];
  const failedCachePaths = [];
  // Per-route status overrides for nginx. Built from non-200 results so the
  // bash injection step can ship an nginx config snippet.
  // Shape: { "<cachePath>": { status: 404, location: "..." | null, route: "/foo", host: "x.tld" } }
  const statusOverrides = {};
  let nextIndex = 0;

  async function renderEntry(entry) {
    // One isolated context per entry is intentional. Path-hosted tenants share
    // an origin, and therefore localStorage; concurrent pages in one context
    // can overwrite nexus_tenant_id while sibling API calls are still active.
    const context = await browser.newContext(contextOptions);
    const page = await context.newPage();
    const label = entry.canonicalUrl || entry.url;
    const apiServerErrors = [];
    const blockedRequests = [];
    const pageErrors = [];
    const failedCriticalRequests = [];
    const pendingApiRequests = new Map();
    const pendingApiInspections = new Set();
    page.on('pageerror', (error) => pageErrors.push(String(error?.message || error)));
    page.on('request', (request) => {
      try {
        const parsed = new URL(request.url());
        if (isApiPath(parsed.pathname)) pendingApiRequests.set(request, parsed.pathname);
      } catch {
        // The request route guard rejects malformed URLs.
      }
    });
    page.on('requestfinished', (request) => pendingApiRequests.delete(request));
    page.on('requestfailed', (request) => {
      try {
        const parsed = new URL(request.url());
        if (isApiPath(parsed.pathname)) {
          failedCriticalRequests.push(`${request.failure()?.errorText || 'request failed'} ${parsed.pathname}`);
        }
      } catch {
        // URL validation at the request boundary handles malformed values.
      } finally {
        pendingApiRequests.delete(request);
      }
    });
    await page.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      try {
        const parsed = new URL(requestUrl);
        if (['http:', 'https:'].includes(parsed.protocol)) {
          await assertPublicHostname(parsed.hostname);
        }
        const authenticatedHeaders = maintenanceAuthHeaders(
          entry,
          requestUrl,
          route.request().headers(),
          maintenanceAuthToken,
        );
        await route.continue(authenticatedHeaders ? { headers: authenticatedHeaders } : undefined);
      } catch (error) {
        blockedRequests.push(`${requestUrl} (${error.message})`);
        await route.abort('blockedbyclient');
      }
    });
    page.on('response', (response) => {
      try {
        const parsed = new URL(response.url());
        if (isApiPath(parsed.pathname) && response.status() >= 400) {
          apiServerErrors.push(`${response.status()} ${parsed.pathname}`);
        }
        if (isApiPath(parsed.pathname)
            && response.status() >= 200
            && response.status() < 300
            && response.status() !== 204
            && /json/i.test(response.headers()['content-type'] || '')) {
          const inspection = response.json()
            .then((payload) => {
              if (payload && typeof payload === 'object'
                  && payload.success === false
                  && payload.requires_2fa !== true) {
                apiServerErrors.push(`logical failure ${parsed.pathname}`);
              }
            })
            .catch(() => apiServerErrors.push(`invalid JSON ${parsed.pathname}`))
            .finally(() => pendingApiInspections.delete(inspection));
          pendingApiInspections.add(inspection);
        }
        if (response.status() >= 400 && isCriticalApiPath(entry.route, parsed.pathname)) {
          failedCriticalRequests.push(`${response.status()} ${parsed.pathname}`);
        }
      } catch {
        // Ignore malformed third-party response URLs; navigation validation
        // below still protects the snapshot being published.
      }
    });
    try {
      await assertPublicUrl(entry.url);
      if (entry.canonicalUrl) await assertPublicUrl(entry.canonicalUrl);
      const render = await renderPage(page, entry.url, pendingApiRequests);
      await Promise.allSettled([...pendingApiInspections]);
      const { html, status, redirect, readiness, markdown } = render;
      const tenantIdentity = await renderedTenantIdentity(page);
      assertExpectedTenant(entry, tenantIdentity);
      assertRenderContract(
        entry,
        render,
        apiServerErrors,
        blockedRequests,
        pageErrors,
        failedCriticalRequests,
      );
      const size = Buffer.byteLength(html, 'utf-8');

      if (size < 3000) {
        console.log(`  skipped ${label} - too small (${size}B)`);
        results.failed++;
        results.entries.push({
          url: label,
          output: entry.output,
          cachePath: entry.cachePath || null,
          status: 'failed',
          reason: `too small (${size}B)`,
        });
        if (entry.cachePath) failedCachePaths.push(entry.cachePath);
        return;
      }

      const outputDir = dirname(entry.output);
      mkdirSync(outputDir, { recursive: true });
      writeFileSync(entry.output, html, 'utf-8');

      // Integrity sidecar: SHA-256 of the bytes we just wrote. Lets the
      // PHP side detect corruption (truncated writes, downstream filesystem
      // tampering, bit rot) without re-hashing megabytes on every inspect.
      // Format: "<hex>  <byte-count>" — same shape as `sha256sum` output
      // so an operator can verify by hand.
      //
      // The trailing newline is REQUIRED, and `sha256sum` emits one too. POSIX
      // `read` returns non-zero at EOF on an unterminated final line even when
      // it assigned every variable, so a sidecar without it made the publisher's
      // `read -r recorded_hash recorded_bytes < "$checksum"` abort the entire
      // authoritative publish under `set -e` — silently. The reader now
      // tolerates that status as well, but do not drop this newline: it is what
      // makes the file well-formed.
      const sha = createHash('sha256').update(html, 'utf-8').digest('hex');
      writeFileSync(`${outputDir}/index.html.sha256`, `${sha}  ${Buffer.byteLength(html, 'utf-8')}\n`, 'utf-8');
      // Persist immutable ownership beside the snapshot. Hostnames and path
      // prefixes can later be reassigned; reconciliation must distinguish an
      // old tenant's HTML from a valid snapshot for the new owner.
      writeFileSync(`${outputDir}/_tenant.json`, JSON.stringify({
        tenantId: Number(entry.tenantId),
        tenantSlug: String(entry.tenantSlug),
        host: String(entry.host).toLowerCase(),
      }), 'utf-8');

      // Sidecar Markdown for AI crawlers (Phase 5). LLMs ingest Markdown
      // more efficiently than HTML — fewer tokens, less chrome noise. Only
      // for 200 responses; non-200s aren't useful as ingested content.
      if (markdown && status === 200) {
        writeFileSync(`${outputDir}/index.md`, markdown, 'utf-8');
      }

      // Drop a sidecar `_status` file so PrerenderService::inspect can surface
      // the intended HTTP status. The bash injection step also reads these
      // when assembling the nginx override map.
      if (status && status !== 200) {
        writeFileSync(`${outputDir}/_status`, String(status), 'utf-8');
        if (entry.cachePath) {
          statusOverrides[entry.cachePath] = {
            status,
            location: redirect,
            route: entry.route || null,
            host: entry.host || null,
          };
        }
      }

      console.log(`  rendered ${label} (${(size / 1024).toFixed(1)}KB) [status=${status}, ready=${readiness || 'timeout'}]`);
      results.success++;
      results.entries.push({
        url: label,
        output: entry.output,
        cachePath: entry.cachePath || null,
        status: 'rendered',
        httpStatus: status,
        redirectLocation: redirect || null,
        readiness: readiness || 'timeout',
        tenantId: tenantIdentity.id,
        tenantSlug: tenantIdentity.slug,
        bytes: size,
      });
      if (entry.cachePath) successfulCachePaths.push(entry.cachePath);
    } catch (err) {
      console.log(`  failed ${label} - ${err.message}`);
      results.failed++;
      results.entries.push({
        url: label,
        output: entry.output,
        cachePath: entry.cachePath || null,
        status: 'failed',
        reason: err.message,
      });
      if (entry.cachePath) failedCachePaths.push(entry.cachePath);
    } finally {
      await context.close();
    }
  }

  async function worker() {
    while (nextIndex < manifest.urls.length) {
      const entry = manifest.urls[nextIndex];
      nextIndex++;
      await renderEntry(entry);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, manifest.urls.length) }, () => worker())
  );

  await browser.close();

  results.finishedAt = new Date().toISOString();
  writeFileSync('/output/.prerender-results.json', JSON.stringify(results, null, 2), 'utf-8');
  writeFileSync('/output/.prerender-successes.txt', `${successfulCachePaths.join('\n')}\n`, 'utf-8');
  writeFileSync('/output/.prerender-failures.txt', `${failedCachePaths.join('\n')}\n`, 'utf-8');
  writeFileSync('/output/.prerender-status-overrides.json', JSON.stringify(statusOverrides, null, 2), 'utf-8');

  console.log(`\nDone: ${results.success} succeeded, ${results.failed} failed`);
  process.exit(results.failed > 0 ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

export {
  assertExpectedTenant,
  assertRenderContract,
  isApiPath,
  isNonPublicAddress,
  isCriticalApiPath,
  maintenanceAuthHeaders,
  normalizeManifestRoute,
  normalizedDocumentUrl,
  validateManifest,
  validateManifestEntry,
};
