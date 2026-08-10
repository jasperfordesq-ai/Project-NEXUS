// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { isolatedRunnerArgs } = require('./accessibility-isolated-selection');

const projectRoot = path.resolve(__dirname, '..');
let accessibilityProcess;
let unsafeBackendMethod = null;
let shuttingDown = false;

const mockLaravel = http.createServer((req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');

  if (!['GET', 'HEAD'].includes(method)) {
    unsafeBackendMethod = `${method} ${requestUrl.pathname}`;
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'The isolated accessibility backend is read-only.' }));
    return;
  }

  if (requestUrl.pathname === '/api/v2/auth/registration-info') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        registration_mode: 'open',
        requires_invite_code: false,
        is_closed: false,
        can_register: true
      }
    }));
    return;
  }

  if (requestUrl.pathname === '/api/v2/tenants') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
    return;
  }

  if (requestUrl.pathname === '/api/v2/tenant/bootstrap') {
    const slug = requestUrl.searchParams.get('slug') || req.headers['x-tenant-slug'] || 'hour-timebank';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: {
        id: 2,
        slug,
        name: 'Hour Timebank',
        modules: {},
        features: {}
      }
    }));
    return;
  }

  if (requestUrl.pathname === '/api/v2/platform/stats') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      data: { members: 0, hours_exchanged: 0, listings: 0, communities: 0 }
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'No isolated accessibility fixture exists for this read.' }));
});

function closeMockLaravel() {
  return new Promise((resolve) => {
    if (!mockLaravel.listening) {
      resolve();
      return;
    }
    mockLaravel.close(() => resolve());
  });
}

async function finish(exitCode) {
  if (shuttingDown) return;
  shuttingDown = true;
  await closeMockLaravel();
  if (unsafeBackendMethod) {
    console.error(`Isolated accessibility gate attempted unsafe backend method: ${unsafeBackendMethod}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = exitCode;
}

mockLaravel.on('error', (error) => {
  console.error(`Isolated accessibility backend failed: ${error.message}`);
  void finish(1);
});

mockLaravel.on('listening', () => {
  const address = mockLaravel.address();
  const laravelBaseUrl = `http://127.0.0.1:${address.port}`;
  console.log(`Isolated accessibility backend: ${laravelBaseUrl}`);

  accessibilityProcess = spawn(
    process.execPath,
    [path.join(__dirname, 'accessibility-local-server.js'), ...isolatedRunnerArgs(process.argv.slice(2))],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        ACCESSIBLE_BACKEND_TARGET: 'laravel',
        API_BASE_URL: '',
        LARAVEL_BASE_URL: laravelBaseUrl
      },
      stdio: 'inherit'
    }
  );

  accessibilityProcess.on('error', (error) => {
    console.error(`Could not start the isolated accessibility gate: ${error.message}`);
    void finish(1);
  });

  accessibilityProcess.on('exit', (code, signal) => {
    if (signal) {
      console.error(`Isolated accessibility gate stopped after signal ${signal}.`);
    }
    void finish(Number.isInteger(code) ? code : 1);
  });
});

mockLaravel.listen(0, '127.0.0.1');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (accessibilityProcess && !accessibilityProcess.killed) {
      accessibilityProcess.kill(signal);
    }
    void finish(1);
  });
}
