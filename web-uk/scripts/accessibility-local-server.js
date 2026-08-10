// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const artifactRoot = path.join(projectRoot, 'artifacts', 'accessibility');
const laravelBaseUrl = process.env.LARAVEL_BASE_URL || 'http://127.0.0.1:8088';
const manualMode = process.argv.slice(2).includes('--manual');

// Requiring src/server.js only returns the Express app when NODE_ENV=test.
// This runner then owns a fresh ephemeral listener for the current checkout.
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'web-uk-accessibility-local-session-secret';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'web-uk-accessibility-local-cookie-secret';
process.env.LARAVEL_BASE_URL = laravelBaseUrl;

const app = require('../src/server');

/**
 * Is the Chromium build THIS copy of Playwright needs actually installed?
 *
 * Resolves the executable path through Playwright's own API rather than
 * guessing at directory names, so it stays correct across Playwright versions
 * and operating systems.
 */
function checkBrowserAvailable() {
  let chromium;
  try {
    ({ chromium } = require('@playwright/test'));
  } catch (error) {
    return { ok: false, detail: `@playwright/test could not be loaded: ${error.message}` };
  }

  let executablePath;
  try {
    executablePath = chromium.executablePath();
  } catch (error) {
    // Thrown when the build for this Playwright version was never downloaded.
    return { ok: false, detail: error.message.split('\n')[0] };
  }

  if (!executablePath || !fs.existsSync(executablePath)) {
    let version = 'unknown';
    try {
      version = require('@playwright/test/package.json').version;
    } catch { /* version is a nicety, not required */ }
    return {
      ok: false,
      detail: `Playwright ${version} expects a browser at ${executablePath}, which does not exist.`,
    };
  }

  return { ok: true, detail: executablePath };
}

fs.mkdirSync(artifactRoot, { recursive: true });

const server = app.listen(0, '127.0.0.1');
let playwrightProcess;
let shuttingDown = false;

function closeServer() {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
  });
}

async function finish(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeServer();
  process.exitCode = exitCode;
}

server.on('error', (error) => {
  console.error(`Accessibility server failed: ${error.message}`);
  void finish(1);
});

server.on('listening', () => {
  const address = server.address();
  const baseURL = `http://127.0.0.1:${address.port}`;

  console.log(`Accessibility gate server: ${baseURL}`);
  console.log(`Laravel API base URL: ${laravelBaseUrl}`);

  if (manualMode) {
    console.log('Manual inspection mode is active. Press Ctrl+C to stop.');
    return;
  }

  const playwrightCli = require.resolve('@playwright/test/cli');
  const playwrightConfig = process.env.WEB_UK_PLAYWRIGHT_CONFIG || 'playwright.accessibility.config.js';

  // Fail fast, once, with an instruction — instead of letting every spec fail
  // separately on a missing browser.
  //
  // Playwright stores browsers in ONE shared location keyed by build number, and
  // each Playwright version demands a specific build. This repository declares
  // Playwright four times at three different versions (root, web-uk, e2e,
  // aspnet-backend/e2e), so installing browsers for one tree does not satisfy
  // another. On 2026-08-10 the root tree had chromium-1217 (Playwright 1.59.1)
  // while web-uk needed chromium-1228 (1.61.1): every accessibility spec failed
  // with "Executable doesn't exist", which reads like the PRODUCT is broken
  // rather than the harness being uninstalled. That misreading is why 115 points
  // of accessibility work sat blocked.
  const browserCheck = checkBrowserAvailable();
  if (!browserCheck.ok) {
    console.error('');
    console.error('=========================================================');
    console.error(' Accessibility gate cannot start: browser not installed');
    console.error('=========================================================');
    console.error(`  ${browserCheck.detail}`);
    console.error('');
    console.error('  This is a SETUP problem, not a product failure. Run:');
    console.error('');
    console.error('      npm --prefix web-uk run playwright:install');
    console.error('');
    console.error('  Browsers are shared across all Playwright copies in this');
    console.error('  repository and are keyed by build number, so installing for');
    console.error('  one directory does not cover another.');
    console.error('');
    void finish(1);
    return;
  }

  playwrightProcess = spawn(
    process.execPath,
    [playwrightCli, 'test', `--config=${playwrightConfig}`, ...process.argv.slice(2)],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        WEB_UK_ACCESSIBILITY_BASE_URL: baseURL
      },
      stdio: 'inherit'
    }
  );

  playwrightProcess.on('error', (error) => {
    console.error(`Could not start Playwright: ${error.message}`);
    void finish(1);
  });

  playwrightProcess.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Playwright stopped after signal ${signal}.`);
    }
    void finish(Number.isInteger(code) ? code : 1);
  });
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (playwrightProcess && !playwrightProcess.killed) {
      playwrightProcess.kill(signal);
    }
    void finish(1);
  });
}
