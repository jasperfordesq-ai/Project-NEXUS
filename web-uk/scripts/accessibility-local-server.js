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
