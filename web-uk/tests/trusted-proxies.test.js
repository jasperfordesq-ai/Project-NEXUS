// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * F-167: web-uk's rate limits and the visitor address it forwards to Laravel
 * were keyed on the Cloudflare EDGE address, because `trust proxy 1` trusted a
 * single hop and the host's Apache appends the edge it received the request
 * from. One person making ten bad sign-in attempts locked sign-in for everyone
 * routed through the same Cloudflare data centre.
 *
 * `req.ip` must now be the visitor behind Cloudflare, and a request that did
 * not come through a trusted hop must not be able to choose its own address.
 */
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const request = require('supertest');
const { CLOUDFLARE_CIDRS, applyTrustedProxies } = require('../src/lib/trusted-proxies');
const { requestClientContext } = require('../src/middleware/request-client-context');
const { getRequestClientIp } = require('../src/lib/request-client-context');

const DOCKER_GATEWAY = '172.18.0.1';
const CLOUDFLARE_EDGE = '162.158.94.10';
const VISITOR_A = '203.0.113.10';
const VISITOR_B = '198.51.100.20';

// supertest always connects from loopback. This stands in for the TCP peer the
// container really sees, so both a trusted and an untrusted peer can be tested.
function simulatedPeer(req, _res, next) {
  const peer = req.headers['x-test-peer'];
  if (peer) {
    Object.defineProperty(req.socket, 'remoteAddress', { value: peer, configurable: true });
  }
  next();
}

function buildApp(configure = applyTrustedProxies) {
  const app = express();
  configure(app);
  app.use(simulatedPeer);
  app.use(requestClientContext);
  app.get('/whoami', (req, res) => res.json({ ip: req.ip, forwarded: getRequestClientIp() }));
  return app;
}

describe('trusted proxies (F-167)', () => {
  it('shows the premise: trusting one hop makes req.ip the Cloudflare edge', async () => {
    const app = buildApp((a) => a.set('trust proxy', 1));
    const res = await request(app).get('/whoami')
      .set('x-test-peer', DOCKER_GATEWAY)
      .set('X-Forwarded-For', `${VISITOR_A}, ${CLOUDFLARE_EDGE}`);
    expect(res.body.ip).toBe(CLOUDFLARE_EDGE);
  });

  it('resolves the visitor behind Cloudflare and forwards that address to the API', async () => {
    const res = await request(buildApp()).get('/whoami')
      .set('x-test-peer', DOCKER_GATEWAY)
      .set('X-Forwarded-For', `${VISITOR_A}, ${CLOUDFLARE_EDGE}`);
    expect(res.body).toEqual({ ip: VISITOR_A, forwarded: VISITOR_A });
  });

  it('ignores an address the visitor prepended before Cloudflare', async () => {
    const res = await request(buildApp()).get('/whoami')
      .set('x-test-peer', DOCKER_GATEWAY)
      .set('X-Forwarded-For', `10.9.9.9, 6.6.6.6, ${VISITOR_A}, ${CLOUDFLARE_EDGE}`);
    expect(res.body.ip).toBe(VISITOR_A);
  });

  it('handles an IPv6 visitor behind an IPv6 Cloudflare edge and a loopback hop', async () => {
    const res = await request(buildApp()).get('/whoami')
      .set('x-test-peer', '127.0.0.1')
      .set('X-Forwarded-For', '2001:db8::7, 2606:4700:10::1');
    expect(res.body.ip).toBe('2001:db8::7');
  });

  it('does not let a peer that is not a trusted proxy choose its address', async () => {
    const direct = '192.0.2.77';
    const spoofVisitor = await request(buildApp()).get('/whoami')
      .set('x-test-peer', direct)
      .set('X-Forwarded-For', VISITOR_A);
    expect(spoofVisitor.body).toEqual({ ip: direct, forwarded: direct });

    const spoofCloudflare = await request(buildApp()).get('/whoami')
      .set('x-test-peer', direct)
      .set('X-Forwarded-For', `${VISITOR_A}, ${CLOUDFLARE_EDGE}`);
    expect(spoofCloudflare.body.ip).toBe(direct);
  });

  it('keeps two visitors behind the same Cloudflare edge in separate sign-in buckets', async () => {
    const previous = process.env.NODE_ENV;
    let authLimiter;
    try {
      process.env.NODE_ENV = 'production'; // the limiters skip themselves outside production
      jest.isolateModules(() => {
        ({ authLimiter } = require('../src/lib/rateLimiter'));
      });
    } finally {
      process.env.NODE_ENV = previous;
    }

    const app = express();
    applyTrustedProxies(app);
    app.use(simulatedPeer);
    app.use((_req, res, next) => {
      res.render = (view) => res.type('text').send(view);
      next();
    });
    app.post('/login', authLimiter, (_req, res) => res.status(200).send('ok'));

    const attempt = (visitor) => request(app).post('/login')
      .set('x-test-peer', DOCKER_GATEWAY)
      .set('X-Forwarded-For', `${visitor}, ${CLOUDFLARE_EDGE}`);

    for (let i = 0; i < 10; i += 1) {
      expect((await attempt(VISITOR_A)).status).toBe(200);
    }
    expect((await attempt(VISITOR_A)).status).toBe(429);
    // Same Cloudflare edge, different person: not locked out.
    expect((await attempt(VISITOR_B)).status).toBe(200);
  });

  it('is what server.js installs', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');
    expect(source).toContain('applyTrustedProxies(app)');
    expect(source).not.toMatch(/app\.set\(\s*['"]trust proxy['"]\s*,\s*1\s*\)/);
  });

  const clientIpPhp = path.join(__dirname, '../../app/Core/ClientIp.php');
  (fs.existsSync(clientIpPhp) ? it : it.skip)('mirrors the API\'s Cloudflare list exactly (app/Core/ClientIp.php)', () => {
    const php = fs.readFileSync(clientIpPhp, 'utf8');
    const block = php.match(/CLOUDFLARE_PROXIES\s*=\s*\[([\s\S]*?)\];/);
    expect(block).not.toBeNull();
    const phpCidrs = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(phpCidrs.length).toBeGreaterThan(10);
    expect([...CLOUDFLARE_CIDRS]).toEqual(phpCidrs);
  });
});
