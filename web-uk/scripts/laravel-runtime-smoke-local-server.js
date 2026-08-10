// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

process.env.NODE_ENV = 'test';
process.env.COOKIE_SECRET = process.env.COOKIE_SECRET || 'smoke-secret-12345678901234567890';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'smoke-session-12345678901234567890';
process.env.ACCESSIBLE_BACKEND_TARGET = process.env.ACCESSIBLE_BACKEND_TARGET || 'laravel';
process.env.TENANT_ID = process.env.TENANT_ID || '2';
if (process.env.SMOKE_COMPACT === '1') {
  process.env.DISABLE_REQUEST_LOGGING = '1';
}

const MAX_COMPACT_DETAIL_LENGTH = 160;

function compactString(value) {
  const text = String(value);
  return text.length > MAX_COMPACT_DETAIL_LENGTH
    ? `${text.slice(0, MAX_COMPACT_DETAIL_LENGTH)}... [truncated ${text.length - MAX_COMPACT_DETAIL_LENGTH} characters]`
    : text;
}

function compactFailure(check) {
  const failure = {};
  for (const key of ['name', 'status', 'location', 'path']) {
    if (check[key] !== undefined) {
      failure[key] = typeof check[key] === 'string' ? compactString(check[key]) : check[key];
    }
  }

  if (check.detail !== undefined) {
    failure.detail = compactString(check.detail);
  }

  return failure;
}

function compactResult(result) {
  return {
    ok: result.ok,
    total: result.checks.length,
    failed: result.checks.filter((check) => !check.ok).map(compactFailure)
  };
}

async function main() {
  const compact = process.env.SMOKE_COMPACT === '1';
  const report = console.log.bind(console);
  const reportError = console.error.bind(console);
  if (compact) {
    console.log = () => {};
    console.info = () => {};
    console.warn = () => {};
    console.error = () => {};
  }

  try {
    const app = require('../src/server');
    const { runLaravelRuntimeSmokeAgainstApp } = require('./laravel-runtime-smoke');
    const result = await runLaravelRuntimeSmokeAgainstApp(app);
    const output = compact ? compactResult(result) : result;
    report(JSON.stringify(output, null, 2));
    if (!result.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    reportError(error);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { compactFailure, compactResult, MAX_COMPACT_DETAIL_LENGTH };
