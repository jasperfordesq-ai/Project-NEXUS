// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-248 (E-055 A-3): web-uk trusts Cloudflare's published ranges to say who the
 * visitor is (F-167). Every Cloudflare customer's Workers egress from those same
 * ranges, so a Worker pointed at this origin could choose `req.ip` — the key of
 * every web-uk rate limit and the address forwarded to Laravel (F-110).
 *
 * With CLOUDFLARE_ORIGIN_SECRET set, a Cloudflare hop is trusted only when the
 * request carries the matching X-Nexus-Origin-Secret header (our zone's
 * Transform Rule adds it). Otherwise `req.ip` is the Cloudflare edge address.
 * With the setting unset nothing changes. The header never travels further
 * into the app than the trust check.
 */
const express = require('express');
const request = require('supertest');
const { applyTrustedProxies, ORIGIN_SECRET_HEADER } = require('../src/lib/trusted-proxies');
const { requestClientContext } = require('../src/middleware/request-client-context');
const { getRequestClientIp } = require('../src/lib/request-client-context');

const SECRET = 'f248-test-origin-secret-0123456789abcdef';
const DOCKER_GATEWAY = '172.18.0.1';
const CLOUDFLARE_EDGE = '162.158.94.10';
const FORGED = '198.51.100.20';

function simulatedPeer(req, _res, next) {
  const peer = req.headers['x-test-peer'];
  if (peer) {
    Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
  }
  next();
}

function buildApp(originSecret) {
  const app = express();
  applyTrustedProxies(app, { originSecret });
  app.use(simulatedPeer);
  app.use(requestClientContext);
  app.get('/whoami', (req, res) => res.json({
    ip: req.ip,
    ips: req.ips,
    forwarded: getRequestClientIp(),
    secretHeaderSeen: Object.prototype.hasOwnProperty.call(req.headers, 'x-nexus-origin-secret')
      || req.rawHeaders.some((h) => String(h).toLowerCase() === 'x-nexus-origin-secret')
  }));
  return app;
}

function viaWorker(app, secretHeader) {
  const r = request(app).get('/whoami')
    .set('x-test-peer', DOCKER_GATEWAY)
    .set('X-Forwarded-For', `${FORGED}, ${CLOUDFLARE_EDGE}`);
  return secretHeader === undefined ? r : r.set('X-Nexus-Origin-Secret', secretHeader);
}

describe('Cloudflare origin secret (F-248)', () => {
  it('names the header our Cloudflare zone adds', () => {
    expect(ORIGIN_SECRET_HEADER).toBe('x-nexus-origin-secret');
  });

  it('does not trust the forwarded address when the header is missing', async () => {
    const res = await viaWorker(buildApp(SECRET));
    expect(res.body.ip).toBe(CLOUDFLARE_EDGE);
    expect(res.body.forwarded).toBe(CLOUDFLARE_EDGE);
    expect(res.body.ips).toEqual([CLOUDFLARE_EDGE]);
  });

  it('does not trust the forwarded address when the header is wrong', async () => {
    const res = await viaWorker(buildApp(SECRET), 'not-the-secret');
    expect(res.body.ip).toBe(CLOUDFLARE_EDGE);
    expect(res.body.forwarded).toBe(CLOUDFLARE_EDGE);
  });

  it('trusts the visitor behind Cloudflare when the header matches, and hides the header', async () => {
    const res = await viaWorker(buildApp(SECRET), SECRET);
    expect(res.body.ip).toBe(FORGED);
    expect(res.body.forwarded).toBe(FORGED);
    expect(res.body.secretHeaderSeen).toBe(false);
  });

  it('removes a wrong header too, so it cannot reach logs or Sentry', async () => {
    const res = await viaWorker(buildApp(SECRET), 'not-the-secret');
    expect(res.body.secretHeaderSeen).toBe(false);
  });

  it('still lets a direct, untrusted peer not choose its address', async () => {
    const res = await request(buildApp(SECRET)).get('/whoami')
      .set('x-test-peer', '192.0.2.77')
      .set('X-Forwarded-For', FORGED)
      .set('X-Nexus-Origin-Secret', SECRET);
    expect(res.body.ip).toBe('192.0.2.77');
  });

  it('control: with the secret unset, behaviour is exactly as before', async () => {
    for (const unset of [undefined, '', '   ']) {
      const res = await viaWorker(buildApp(unset));
      expect(res.body.ip).toBe(FORGED);
      expect(res.body.forwarded).toBe(FORGED);
    }
  });

  it('reads CLOUDFLARE_ORIGIN_SECRET from the environment by default', async () => {
    const previous = process.env.CLOUDFLARE_ORIGIN_SECRET;
    try {
      process.env.CLOUDFLARE_ORIGIN_SECRET = SECRET;
      const app = express();
      applyTrustedProxies(app);
      app.use(simulatedPeer);
      app.get('/whoami', (req, res) => res.json({ ip: req.ip }));
      const res = await viaWorker(app);
      expect(res.body.ip).toBe(CLOUDFLARE_EDGE);
    } finally {
      if (previous === undefined) delete process.env.CLOUDFLARE_ORIGIN_SECRET;
      else process.env.CLOUDFLARE_ORIGIN_SECRET = previous;
    }
  });
});
