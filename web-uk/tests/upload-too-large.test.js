// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { parseMultipartForm } = require('../src/middleware/multipart');

// An over-limit upload must surface as a real 413 (so the error handler renders
// the friendly "file is too large" page), not a bare 500. This builds a minimal
// app around the real multipart middleware with a small size limit and a terminal
// handler that mirrors the 413 branch in src/lib/errorHandler.js.
function buildApp(limit) {
  const app = express();
  app.post('/upload', parseMultipartForm({ maxFileSize: limit }), (req, res) => res.status(200).json({ ok: true }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.status === 413) return res.status(413).json({ tooLarge: true });
    return res.status(err.status || 500).json({ error: true, status: err.status || 500 });
  });
  return app;
}

describe('over-limit upload maps to 413, not 500', () => {
  it('rejects a file larger than the limit with 413', async () => {
    const app = buildApp(1024);
    const oversized = Buffer.alloc(4096, 0x61);
    const res = await request(app).post('/upload').attach('file', oversized, 'big.txt');
    expect(res.status).toBe(413);
    expect(res.body.tooLarge).toBe(true);
  });

  it('accepts a file within the limit', async () => {
    const app = buildApp(1024);
    const small = Buffer.alloc(100, 0x61);
    const res = await request(app).post('/upload').attach('file', small, 'small.txt');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('ships a 413 error template that uses the translated 413 copy', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'views', 'errors', '413.njk'), 'utf8');
    expect(src).toContain('error_pages.413_title');
    expect(src).toContain('error_pages.413_body');
  });
});
