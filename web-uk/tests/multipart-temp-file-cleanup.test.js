// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const express = require('express');
const request = require('supertest');
const { parseMultipartForm } = require('../src/middleware/multipart');

// F-111: upload parsing is mounted before the CSRF and sign-in checks, so a
// request refused by those checks (or by any early return) never reaches the
// route handler that deletes the temporary file. The middleware itself must
// remove every parsed temp file once the response has closed.

function waitForClose() {
  // The cleanup runs on the response 'close' event and unlinks asynchronously.
  return new Promise(resolve => setTimeout(resolve, 100));
}

function buildApp(terminal, options = {}) {
  const app = express();
  const seen = [];
  app.post(
    '/upload',
    parseMultipartForm({ maxFileSize: 1024 * 1024, ...options }),
    (req, _res, next) => {
      for (const value of Object.values(req.files || {})) {
        for (const file of Array.isArray(value) ? value : [value]) {
          if (file && file.filepath) seen.push(file.filepath);
        }
      }
      next();
    },
    terminal
  );
  return { app, seen };
}

describe('multipart temp-file cleanup (F-111)', () => {
  it('deletes the uploaded temp file when the request is refused before the route handler', async () => {
    // Mirrors the CSRF middleware refusing the request with 419.
    const { app, seen } = buildApp((_req, res) => res.status(419).send('refused'));
    const res = await request(app).post('/upload').attach('file', Buffer.alloc(512, 0x61), 'a.txt');
    expect(res.status).toBe(419);
    expect(seen).toHaveLength(1);
    await waitForClose();
    expect(fs.existsSync(seen[0])).toBe(false);
  });

  it('deletes every file of a multiple-file upload when refused', async () => {
    const { app, seen } = buildApp((_req, res) => res.redirect('/login'), { multiples: true });
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.alloc(64, 0x61), 'one.txt')
      .attach('files', Buffer.alloc(64, 0x62), 'two.txt');
    expect(res.status).toBe(302);
    expect(seen).toHaveLength(2);
    await waitForClose();
    for (const filepath of seen) {
      expect(fs.existsSync(filepath)).toBe(false);
    }
  });

  it('keeps the file readable for the handler and tolerates a handler that already deleted it', async () => {
    let contents = null;
    const { app, seen } = buildApp(async (req, res) => {
      contents = await fs.promises.readFile(req.files.file.filepath, 'utf8');
      await fs.promises.unlink(req.files.file.filepath);
      res.status(200).json({ ok: true });
    });
    const res = await request(app).post('/upload').attach('file', Buffer.from('hello'), 'h.txt');
    expect(res.status).toBe(200);
    expect(contents).toBe('hello');
    await waitForClose();
    expect(fs.existsSync(seen[0])).toBe(false);
  });
});
