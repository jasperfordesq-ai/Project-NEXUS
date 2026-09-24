// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-206: formidable calls back from its stream 'end' event, outside the
 * AsyncLocalStorage context the request started in. So on every upload route
 * the API calls made after parsing carried no visitor address (F-110), no
 * language and no community fallback. The parser must hand control back
 * inside the request's own context.
 */
const http = require('node:http');
const express = require('express');
const request = require('supertest');
const { parseMultipartForm } = require('../src/middleware/multipart');
const { requestClientContext } = require('../src/middleware/request-client-context');
const { getRequestClientIp } = require('../src/lib/request-client-context');
const { runWithRequestLocale, getRequestLocale } = require('../src/lib/request-locale-context');
const { runWithRequestTenant, getRequestTenantSlug } = require('../src/lib/request-tenant-context');

// Sends the multipart body in pieces with pauses, as a real browser upload over
// a network does, so the parser's callback fires from a LATER socket event —
// which is where the context used to be lost. (supertest writes the whole body
// at once, so the parser can finish inside the request's first tick.)
function slowUpload(app, headers) {
  const boundary = '----nexusE035Boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\nhello\r\n`
    + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="slow.txt"\r\n`
    + 'Content-Type: text/plain\r\n\r\n'
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const chunks = [head, Buffer.alloc(4096, 0x61), Buffer.alloc(4096, 0x62), tail];

  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const req = http.request({
        host: '127.0.0.1',
        port,
        method: 'POST',
        path: '/upload',
        headers: {
          ...headers,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': chunks.reduce((sum, chunk) => sum + chunk.length, 0)
        }
      }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (piece) => { body += piece; });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      });
      req.on('error', (error) => { server.close(); reject(error); });
      let index = 0;
      const writeNext = () => {
        if (index >= chunks.length) return req.end();
        req.write(chunks[index]);
        index += 1;
        return setTimeout(writeNext, 25);
      };
      writeNext();
    });
  });
}

function buildApp() {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(requestClientContext);
  app.use((req, _res, next) => runWithRequestLocale(String(req.headers['x-test-locale'] || ''), next));
  app.use((req, _res, next) => runWithRequestTenant(String(req.headers['x-test-tenant'] || ''), next));
  app.post('/upload', parseMultipartForm({ maxFileSize: 1024 * 1024 }), (req, res) => {
    res.json({
      clientIp: getRequestClientIp(),
      locale: getRequestLocale(),
      tenant: getRequestTenantSlug(),
      field: req.body.caption || null
    });
  });
  return app;
}

describe('multipart uploads keep the request context (F-206)', () => {
  it('still knows the visitor, language and community after parsing a file upload', async () => {
    const res = await request(buildApp())
      .post('/upload')
      .set('X-Forwarded-For', '203.0.113.44')
      .set('x-test-locale', 'ga')
      .set('x-test-tenant', 'acme')
      .field('caption', 'hello')
      .attach('file', Buffer.alloc(256, 0x61), 'photo.txt');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientIp: '203.0.113.44', locale: 'ga', tenant: 'acme', field: 'hello' });
  });

  it('still knows the visitor after an upload that arrives over several network reads', async () => {
    const res = await slowUpload(buildApp(), {
      'X-Forwarded-For': '203.0.113.55',
      'x-test-locale': 'de',
      'x-test-tenant': 'acme'
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ clientIp: '203.0.113.55', locale: 'de', tenant: 'acme', field: 'hello' });
  });

  it('keeps concurrent uploads from different visitors apart', async () => {
    const app = buildApp();
    const send = (ip) => request(app)
      .post('/upload')
      .set('X-Forwarded-For', ip)
      .attach('file', Buffer.alloc(64 * 1024, 0x62), 'big.txt');
    const [one, two] = await Promise.all([send('203.0.113.1'), send('198.51.100.2')]);
    expect(one.body.clientIp).toBe('203.0.113.1');
    expect(two.body.clientIp).toBe('198.51.100.2');
  });
});
