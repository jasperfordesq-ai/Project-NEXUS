// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Build-time static pre-rendering for public pages.
 *
 * Runs after `vite build` — spins up a local static server for the built
 * dist/ folder, visits each public route with Playwright, captures the
 * fully-rendered HTML (with React Helmet meta tags baked in), and writes
 * it as a static .html file in dist/.
 *
 * nginx serves these files directly to ALL visitors (users AND bots).
 * React hydrates on top and takes over client-side routing.
 *
 * Usage:
 *   node scripts/prerender.mjs                    # Pre-render all routes
 *   node scripts/prerender.mjs --routes /about    # Pre-render specific route
 *
 * Optional env:
 *   NEXUS_PRERENDER_SITEMAP_URL=https://app.project-nexus.ie/sitemap.xml
 *   NEXUS_PRERENDER_DYNAMIC_LIMIT=80
 *   NEXUS_PRERENDER_SITEMAP_LIMIT=12
 *   NEXUS_PRERENDER_SITEMAP_TIMEOUT_MS=10000
 *   NEXUS_PRERENDER_PORT=4173
 *   NEXUS_SKIP_DYNAMIC_PRERENDER=1
 *
 * Requirements:
 *   - dist/ must exist (run `vite build` first)
 *   - @playwright/test must be installed
 *   - VITE_API_BASE env var for API calls during rendering
 */

import { chromium } from '@playwright/test';
import { createServer } from 'http';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(__dirname, '..', 'dist');
const INDEX_PATH = join(DIST_DIR, 'index.html');
const SPA_FALLBACK_PATH = join(DIST_DIR, '_spa.html');
const PORT = Math.max(1, Number.parseInt(process.env.NEXUS_PRERENDER_PORT || '4173', 10) || 4173);
const DEFAULT_SITEMAP_URL = `${process.env.VITE_APP_URL || 'https://app.project-nexus.ie'}/sitemap.xml`;
const DYNAMIC_ROUTE_LIMIT = Math.max(0, Number.parseInt(process.env.NEXUS_PRERENDER_DYNAMIC_LIMIT || '80', 10) || 80);
const SITEMAP_FETCH_LIMIT = Math.max(1, Number.parseInt(process.env.NEXUS_PRERENDER_SITEMAP_LIMIT || '12', 10) || 12);
const SITEMAP_FETCH_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.NEXUS_PRERENDER_SITEMAP_TIMEOUT_MS || '10000', 10) || 10000);

// ─── Public routes to pre-render ─────────────────────────────────────────────
// These are pages that must be indexable by Google and should load instantly.
// Protected/auth routes are NOT pre-rendered (they redirect to login anyway).
const PUBLIC_ROUTES = [
  '/',
  '/about',
  '/faq',
  '/contact',
  '/help',
  '/blog',
  '/terms',
  '/privacy',
  '/accessibility',
  '/cookies',
  '/community-guidelines',
  '/trust-and-safety',
  '/account-deletion',
  '/child-safety',
  '/acceptable-use',
  '/legal',
  '/terms/versions',
  '/privacy/versions',
  '/accessibility/versions',
  '/cookies/versions',
  '/community-guidelines/versions',
  '/acceptable-use/versions',
  '/timebanking-guide',
  '/regional-analytics',
  '/platform/terms',
  '/platform/privacy',
  '/platform/disclaimer',
  '/features',
  '/changelog',
  '/developers',
  '/developers/auth',
  '/developers/endpoints',
  '/developers/webhooks',
  '/coupons',
];

// Published blog articles use an account-free public projection and are the
// only dynamic feature URLs this build-time sitemap fallback may select.
const DYNAMIC_ROUTE_PATTERNS = [
  /^\/(?:[a-z0-9-]+\/)?blog\/[^/?#]+$/i,
];

function shouldSkipPrerender() {
  return process.env.NEXUS_SKIP_PRERENDER === '1' || process.env.NEXUS_SKIP_PRERENDER === 'true';
}

function writeSpaFallback(html) {
  writeFileSync(SPA_FALLBACK_PATH, html, 'utf-8');
}

function extractXmlLocs(xml) {
  return [...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/gi)]
    .map(match => match[1].trim())
    .filter(Boolean);
}

function isDynamicPrerenderRoute(pathname) {
  return DYNAMIC_ROUTE_PATTERNS.some(pattern => pattern.test(pathname));
}

async function fetchSitemapXml(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(SITEMAP_FETCH_TIMEOUT_MS),
    headers: {
      'User-Agent': 'NexusPrerender/1.0',
      Accept: 'application/xml,text/xml,*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}`);
  }

  return response.text();
}

async function fetchDynamicRoutesFromSitemap() {
  if (process.env.NEXUS_SKIP_DYNAMIC_PRERENDER === '1' || process.env.NEXUS_SKIP_DYNAMIC_PRERENDER === 'true') {
    console.log('Skipping dynamic route discovery because NEXUS_SKIP_DYNAMIC_PRERENDER is set.');
    return [];
  }

  const sitemapUrl = process.env.NEXUS_PRERENDER_SITEMAP_URL || DEFAULT_SITEMAP_URL;
  const queue = [sitemapUrl];
  const seenSitemaps = new Set();
  const routes = new Set();

  try {
    while (queue.length > 0 && seenSitemaps.size < SITEMAP_FETCH_LIMIT && routes.size < DYNAMIC_ROUTE_LIMIT) {
      const current = queue.shift();
      if (!current || seenSitemaps.has(current)) continue;
      seenSitemaps.add(current);

      const xml = await fetchSitemapXml(current);
      const locs = extractXmlLocs(xml);

      for (const loc of locs) {
        let parsed;
        try {
          parsed = new URL(loc);
        } catch {
          continue;
        }

        if (parsed.pathname.endsWith('.xml')) {
          queue.push(parsed.href);
          continue;
        }

        if (isDynamicPrerenderRoute(parsed.pathname)) {
          routes.add(parsed.pathname);
          if (routes.size >= DYNAMIC_ROUTE_LIMIT) break;
        }
      }
    }
  } catch (err) {
    console.warn(`Could not discover dynamic pre-render routes from sitemap: ${err.message}`);
    return [];
  }

  return [...routes];
}

// ─── Lightweight static file server ──────────────────────────────────────────
// Serves dist/ locally so Playwright can visit pages. Mimics nginx behaviour:
// known files are served directly, everything else gets index.html (SPA routing).
function createStaticServer(spaShell) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
  };

  return createServer((req, res) => {
    const urlPath = req.url.split('?')[0]; // strip query params
    let filePath = join(DIST_DIR, urlPath === '/' ? '/index.html' : urlPath);

    // If the file doesn't exist, serve the cached SPA shell
    if (!existsSync(filePath)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(spaShell);
      return;
    }

    const ext = filePath.substring(filePath.lastIndexOf('.'));
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    try {
      const content = readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch {
      // Fallback to cached SPA shell
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(spaShell);
    }
  });
}

function stripRuntimeMapsAssets(html) {
  return html
    .replace(/<script[^>]+(?:maps\.googleapis\.com|maps-api-v3|maps\.gstatic\.com)[^>]*><\/script>/gi, '')
    .replace(/<link[^>]+(?:maps\.googleapis\.com|maps-api-v3|maps\.gstatic\.com)[^>]*>/gi, '');
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

// ─── Pre-render a single route ───────────────────────────────────────────────
async function capturePageContent(page) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt > 0) {
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
      return await page.content();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function prerenderRoute(page, route) {
  const url = `http://localhost:${PORT}${route}`;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
      // Public pages can keep analytics, maps, or API requests alive. Capture the
      // settled DOM we have instead of blocking the whole production build.
    });

    // Wait for React Helmet to inject meta tags (data-rh attribute)
    await page.waitForSelector('[data-rh]', { timeout: 1500 }).catch(() => {
      // Some pages may not have Helmet tags — that's ok
    });

    // Wait a bit more for any lazy-loaded content
    await page.waitForTimeout(1000);

    // Get the full rendered HTML
    let html = await capturePageContent(page);

    // Clean up: remove Vite HMR scripts that shouldn't be in static output
    html = html.replace(/<script[^>]*type="module"[^>]*src="\/src\/[^"]*"[^>]*><\/script>/g, '');
    html = stripRuntimeMapsAssets(html);
    html = stripNonCoreModulePreloads(html);

    // Write the static HTML file
    const outputPath = route === '/'
      ? join(DIST_DIR, 'index.html')
      : join(DIST_DIR, route, 'index.html');

    const outputDir = dirname(outputPath);
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, html, 'utf-8');

    const size = Buffer.byteLength(html, 'utf-8');
    console.log(`  ✓ ${route} (${(size / 1024).toFixed(1)}KB)`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${route} — ${err.message}`);
    return false;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(DIST_DIR)) {
    console.error('dist/ not found. Run `vite build` first.');
    process.exit(1);
  }

  if (!existsSync(INDEX_PATH)) {
    console.error('dist/index.html not found. Run `vite build` first.');
    process.exit(1);
  }

  // Keep a pristine SPA shell beside any rendered snapshots. nginx serves
  // /_spa.html to real users so prerendered public-page DOM can never flash on
  // protected/admin routes while React hydrates.
  const originalIndex = readFileSync(INDEX_PATH, 'utf-8');
  writeSpaFallback(originalIndex);

  if (shouldSkipPrerender()) {
    console.log('Skipping pre-render because NEXUS_SKIP_PRERENDER is set.');
    console.log('SPA fallback saved as dist/_spa.html');
    return;
  }

  // Parse --routes flag for selective pre-rendering
  const args = process.argv.slice(2);
  const routesIdx = args.indexOf('--routes');
  const routes = routesIdx !== -1
    ? args.slice(routesIdx + 1).filter(r => r.startsWith('/'))
    : [...new Set([...PUBLIC_ROUTES, ...(await fetchDynamicRoutesFromSitemap())])];

  console.log(`\nPre-rendering ${routes.length} public pages...\n`);

  const server = createStaticServer(originalIndex);
  let success = 0;
  let failed = 0;
  let browser;

  try {
    await new Promise(resolve => server.listen(PORT, resolve));

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'NexusPrerender/1.0',
      viewport: { width: 1280, height: 720 },
    });

    for (const route of routes) {
      const page = await context.newPage();
      const ok = await prerenderRoute(page, route);
      ok ? success++ : failed++;
      await page.close();
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await new Promise(resolve => server.close(resolve)).catch(() => {});
    writeFileSync(INDEX_PATH, originalIndex, 'utf-8');
  }

  console.log(`\nDone: ${success} succeeded, ${failed} failed`);
  console.log(`SPA fallback saved as dist/_spa.html`);
  console.log(`SPA shell restored as dist/index.html`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Pre-render failed:', err);
  process.exit(1);
});
