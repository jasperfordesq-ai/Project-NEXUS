#!/usr/bin/env node
// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs/promises');
const path = require('node:path');
const { URL } = require('node:url');

const DEFAULT_SCREENSHOT_ROUTES = Object.freeze([
  { name: 'home', path: '/hour-timebank/accessible' },
  { name: 'login', path: '/hour-timebank/accessible/login' },
  { name: 'register', path: '/hour-timebank/accessible/register' },
  { name: 'contact', path: '/hour-timebank/accessible/contact' },
  { name: 'accessibility', path: '/hour-timebank/accessible/accessibility' },
  { name: 'legal', path: '/hour-timebank/accessible/legal' }
]);

const DEFAULT_SCREENSHOT_VIEWPORTS = Object.freeze([
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'reflow-320', width: 320, height: 800, requireNoOverflow: true }
]);

function stripTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sanitizeSegment(value) {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!sanitized) throw new Error('Screenshot artifact names must contain a safe character.');
  return sanitized;
}

function assertSafeBaseUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label} must not contain credentials.`);
  }
  if (/(^|\/)alpha(?:\/|$)/i.test(parsed.pathname)) {
    throw new Error(`${label} must not use the legacy /alpha mount.`);
  }
  return stripTrailingSlash(parsed.href);
}

function assertCanonicalRoute(route) {
  const routePath = String(route?.path || '');
  if (!/^\/hour-timebank\/accessible(?:\/|$)/.test(routePath)) {
    throw new Error(`Screenshot route must use /hour-timebank/accessible: ${routePath || '<empty>'}`);
  }
  if (/(^|\/)alpha(?:\/|$)/i.test(routePath)) {
    throw new Error(`Screenshot route must not use /alpha: ${routePath}`);
  }
  return {
    name: sanitizeSegment(route.name),
    path: routePath
  };
}

function joinUrl(baseUrl, routePath) {
  return `${stripTrailingSlash(baseUrl)}${routePath}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildReviewPairs(results) {
  const pairsByKey = new Map();
  for (const result of results || []) {
    const key = `${result.route}::${result.viewport}`;
    const pair = pairsByKey.get(key) || {
      route: result.route,
      path: result.path,
      viewport: result.viewport,
      width: result.width,
      height: result.height
    };
    if (!['laravel-blade', 'web-uk'].includes(result.surface)) {
      throw new Error(`Unknown screenshot surface: ${result.surface}`);
    }
    if (pair[result.surface]) {
      throw new Error(`Duplicate screenshot surface for ${key}: ${result.surface}`);
    }
    pair[result.surface] = result;
    pairsByKey.set(key, pair);
  }

  const pairs = [...pairsByKey.values()];
  for (const pair of pairs) {
    if (!pair['laravel-blade'] || !pair['web-uk']) {
      throw new Error(`Incomplete screenshot pair: ${pair.route} / ${pair.viewport}`);
    }
  }
  return pairs;
}

function renderReviewHtml(manifest) {
  const pairs = buildReviewPairs(manifest.results);
  const sections = pairs.map((pair) => `
    <section class="pair">
      <h2>${escapeHtml(pair.route)} <span>${escapeHtml(pair.viewport)} (${pair.width} × ${pair.height})</span></h2>
      <p><code>${escapeHtml(pair.path)}</code></p>
      <div class="images">
        <figure><figcaption>Laravel Blade</figcaption><img src="${escapeHtml(pair['laravel-blade'].screenshot)}" alt="Laravel Blade ${escapeHtml(pair.route)} at ${escapeHtml(pair.viewport)}"></figure>
        <figure><figcaption>Web UK</figcaption><img src="${escapeHtml(pair['web-uk'].screenshot)}" alt="Web UK ${escapeHtml(pair.route)} at ${escapeHtml(pair.viewport)}"></figure>
      </div>
      <p class="review-line">Outcome: ☐ Match ☐ Minor difference ☐ Material difference &nbsp; Reviewer: __________ &nbsp; Date: __________</p>
      <p class="review-line">Notes:</p>
    </section>`).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Blade and Web UK visual review — ${escapeHtml(manifest.snapshotId)}</title>
  <style>
    body { color: #0b0c0c; font: 16px/1.5 Arial, sans-serif; margin: 2rem; }
    h1, h2 { margin-bottom: .5rem; } h2 span { color: #505a5f; font-size: 1rem; }
    .pair { border-top: 4px solid #1d70b8; margin-top: 2rem; padding-top: 1rem; page-break-before: always; }
    .images { display: grid; gap: 1rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    figure { margin: 0; min-width: 0; } figcaption { font-weight: bold; margin-bottom: .5rem; }
    img { border: 1px solid #b1b4b6; display: block; height: auto; max-width: 100%; }
    .review-line { border-bottom: 1px solid #b1b4b6; min-height: 2rem; padding-bottom: .5rem; }
    @media (max-width: 800px) { .images { grid-template-columns: 1fr; } body { margin: 1rem; } }
  </style>
</head>
<body>
  <h1>Laravel Blade and Web UK visual review</h1>
  <dl>
    <dt>Snapshot</dt><dd>${escapeHtml(manifest.snapshotId)}</dd>
    <dt>Laravel Blade</dt><dd>${escapeHtml(manifest.laravelBaseUrl)}</dd>
    <dt>Web UK</dt><dd>${escapeHtml(manifest.webBaseUrl)}</dd>
    <dt>Generated</dt><dd>${escapeHtml(manifest.generatedAt)}</dd>
  </dl>
  <p>This worksheet does not certify parity until every pair has a named reviewer, date, outcome, and resolved notes.</p>
  ${sections}
</body>
</html>
`;
}

function renderReviewMarkdown(manifest) {
  const pairs = buildReviewPairs(manifest.results);
  const sections = pairs.map((pair) => `## ${pair.route} — ${pair.viewport} (${pair.width} x ${pair.height})

Path: \`${pair.path}\`

| Laravel Blade | Web UK |
|---|---|
| ![Laravel Blade ${pair.route}](${pair['laravel-blade'].screenshot}) | ![Web UK ${pair.route}](${pair['web-uk'].screenshot}) |

- [ ] Match
- [ ] Minor difference
- [ ] Material difference
- Reviewer:
- Date:
- Notes:
`).join('\n');

  return `# Laravel Blade and Web UK visual review

- Snapshot: \`${manifest.snapshotId}\`
- Laravel Blade: \`${manifest.laravelBaseUrl}\`
- Web UK: \`${manifest.webBaseUrl}\`
- Generated: \`${manifest.generatedAt}\`

This worksheet is incomplete until every pair has exactly one outcome, a named
reviewer, a date, and resolved notes.

${sections}`;
}

function resolveCaptureOptions(options = {}, env = process.env) {
  const laravelBaseUrl = options.laravelBaseUrl || env.LARAVEL_BLADE_BASE_URL;
  const webBaseUrl = options.webBaseUrl || env.WEB_UK_BASE_URL;
  if (!laravelBaseUrl || !webBaseUrl) {
    throw new Error('Set LARAVEL_BLADE_BASE_URL and WEB_UK_BASE_URL before capturing screenshots.');
  }
  const disposableLaravelConfirmed = options.disposableLaravelConfirmed
    ?? env.DISPOSABLE_LARAVEL_CONFIRMED === '1';
  if (!disposableLaravelConfirmed) {
    throw new Error('Set DISPOSABLE_LARAVEL_CONFIRMED=1 only after verifying the Laravel environment is disposable.');
  }

  const snapshotId = sanitizeSegment(
    options.snapshotId || env.VISUAL_SNAPSHOT_ID || new Date().toISOString()
  );
  const outputRoot = path.resolve(
    options.outputRoot || env.VISUAL_SCREENSHOT_OUTPUT || path.join(__dirname, '..', 'artifacts', 'visual-comparison')
  );
  const routes = (options.routes || DEFAULT_SCREENSHOT_ROUTES).map(assertCanonicalRoute);
  const viewports = (options.viewports || DEFAULT_SCREENSHOT_VIEWPORTS).map((viewport) => ({
    name: sanitizeSegment(viewport.name),
    width: Number(viewport.width),
    height: Number(viewport.height),
    requireNoOverflow: Boolean(viewport.requireNoOverflow)
  }));

  if (new Set(routes.map((route) => route.name)).size !== routes.length) {
    throw new Error('Screenshot route names must be unique.');
  }
  if (new Set(viewports.map((viewport) => viewport.name)).size !== viewports.length) {
    throw new Error('Screenshot viewport names must be unique.');
  }

  for (const viewport of viewports) {
    if (!Number.isInteger(viewport.width) || !Number.isInteger(viewport.height)
      || viewport.width < 1 || viewport.height < 1) {
      throw new Error(`Invalid screenshot viewport: ${viewport.name}`);
    }
  }

  const timeoutMs = Number(options.timeoutMs || env.VISUAL_SCREENSHOT_TIMEOUT_MS || 60000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('VISUAL_SCREENSHOT_TIMEOUT_MS must be a positive integer.');
  }

  return {
    laravelBaseUrl: assertSafeBaseUrl(laravelBaseUrl, 'LARAVEL_BLADE_BASE_URL'),
    webBaseUrl: assertSafeBaseUrl(webBaseUrl, 'WEB_UK_BASE_URL'),
    snapshotId,
    outputRoot,
    outputDirectory: path.join(outputRoot, snapshotId),
    timeoutMs,
    routes,
    viewports
  };
}

async function captureSurface(browser, surface, options) {
  const results = [];
  for (const viewport of options.viewports) {
    const unsafeRequests = [];
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      locale: 'en-GB',
      colorScheme: 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block'
    });

    await context.route('**/*', async (route) => {
      const method = route.request().method().toUpperCase();
      if (!['GET', 'HEAD'].includes(method)) {
        unsafeRequests.push(`${method} ${route.request().url()}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });

    try {
      for (const route of options.routes) {
        const page = await context.newPage();
        const url = joinUrl(surface.baseUrl, route.path);
        const response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: options.timeoutMs
        });
        await page.evaluate(() => globalThis.document.fonts?.ready);

        const state = await page.evaluate(() => ({
          href: globalThis.window.location.href,
          title: globalThis.document.title,
          h1Count: globalThis.document.querySelectorAll('h1').length,
          mainCount: globalThis.document.querySelectorAll('main').length,
          scrollWidth: globalThis.document.documentElement.scrollWidth,
          clientWidth: globalThis.document.documentElement.clientWidth
        }));
        const status = response?.status() || 0;
        const failures = [];
        if (status < 200 || status >= 400) failures.push(`HTTP ${status}`);
        if (state.h1Count !== 1) failures.push(`${state.h1Count} h1 elements`);
        if (state.mainCount !== 1) failures.push(`${state.mainCount} main elements`);
        if (/(^|\/)alpha(?:\/|$)/i.test(new URL(state.href).pathname)) {
          failures.push('redirected to legacy /alpha mount');
        }
        if (viewport.requireNoOverflow && state.scrollWidth > state.clientWidth + 1) {
          failures.push(`horizontal overflow ${state.scrollWidth}/${state.clientWidth}`);
        }

        const relativeFile = path.join(
          sanitizeSegment(surface.name),
          viewport.name,
          `${route.name}.png`
        );
        const outputFile = path.join(options.outputDirectory, relativeFile);
        await fs.mkdir(path.dirname(outputFile), { recursive: true });
        await page.screenshot({ path: outputFile, fullPage: true, animations: 'disabled' });
        await page.close();

        results.push({
          surface: surface.name,
          route: route.name,
          path: route.path,
          viewport: viewport.name,
          width: viewport.width,
          height: viewport.height,
          status,
          title: state.title,
          finalUrl: state.href,
          h1Count: state.h1Count,
          mainCount: state.mainCount,
          scrollWidth: state.scrollWidth,
          clientWidth: state.clientWidth,
          screenshot: relativeFile.replace(/\\/g, '/'),
          failures
        });
      }
    } finally {
      await context.close();
    }

    if (unsafeRequests.length > 0) {
      throw new Error(`Screenshot capture blocked unsafe requests:\n${unsafeRequests.join('\n')}`);
    }
  }
  return results;
}

async function runScreenshotCapture(rawOptions = {}, dependencies = {}) {
  const options = resolveCaptureOptions(rawOptions, dependencies.env || process.env);
  const chromium = dependencies.chromium || require('@playwright/test').chromium;
  const browser = await chromium.launch({ headless: true });
  let results;
  try {
    results = [
      ...await captureSurface(browser, { name: 'laravel-blade', baseUrl: options.laravelBaseUrl }, options),
      ...await captureSurface(browser, { name: 'web-uk', baseUrl: options.webBaseUrl }, options)
    ];
  } finally {
    await browser.close();
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    snapshotId: options.snapshotId,
    laravelBaseUrl: options.laravelBaseUrl,
    webBaseUrl: options.webBaseUrl,
    requestPolicy: 'GET_AND_HEAD_ONLY',
    routes: options.routes,
    viewports: options.viewports,
    ok: results.every((result) => result.failures.length === 0),
    results
  };
  await fs.mkdir(options.outputDirectory, { recursive: true });
  await fs.writeFile(
    path.join(options.outputDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  await Promise.all([
    fs.writeFile(path.join(options.outputDirectory, 'review.html'), renderReviewHtml(manifest), 'utf8'),
    fs.writeFile(path.join(options.outputDirectory, 'review.md'), renderReviewMarkdown(manifest), 'utf8')
  ]);
  return { ...manifest, outputDirectory: options.outputDirectory };
}

async function main() {
  const result = await runScreenshotCapture();
  console.log(`Screenshot manifest: ${path.join(result.outputDirectory, 'manifest.json')}`);
  console.log(`Review worksheets: ${path.join(result.outputDirectory, 'review.html')} and review.md`);
  console.log(`Captured ${result.results.length} images; structural result: ${result.ok ? 'PASS' : 'FAIL'}.`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_SCREENSHOT_ROUTES,
  DEFAULT_SCREENSHOT_VIEWPORTS,
  assertCanonicalRoute,
  assertSafeBaseUrl,
  buildReviewPairs,
  captureSurface,
  escapeHtml,
  joinUrl,
  renderReviewHtml,
  renderReviewMarkdown,
  resolveCaptureOptions,
  runScreenshotCapture,
  sanitizeSegment
};
