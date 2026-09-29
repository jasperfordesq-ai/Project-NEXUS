// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

/**
 * Which hops in front of web-uk may tell it who the visitor is (F-167).
 *
 * The request path in production is: visitor → Cloudflare → the host's Apache
 * → this container (published on 127.0.0.1, so the container sees a Docker
 * bridge or loopback address). Each proxy APPENDS the address it received the
 * request from to X-Forwarded-For. Express walks that list from the right and
 * stops at the first address it does not trust — that is `req.ip`.
 *
 * With `trust proxy 1` (the previous setting) Express trusted exactly one hop,
 * so `req.ip` was the Cloudflare EDGE address Apache appended, not the visitor.
 * Every rate limit (10 sign-in attempts per 15 minutes, 100 pages per 15
 * minutes) and the address forwarded to Laravel (F-110) was therefore shared by
 * everyone routed through the same Cloudflare data centre.
 *
 * Trusting loopback, the private ranges Docker uses, and Cloudflare's published
 * ranges makes `req.ip` the visitor behind Cloudflare. A request that does NOT
 * arrive through a trusted hop cannot choose its own address: Express stops at
 * the untrusted peer and ignores whatever X-Forwarded-For it sent.
 *
 * 🔴 CLOUDFLARE_CIDRS must match `CLOUDFLARE_PROXIES` in app/Core/ClientIp.php
 * (the API's canonical list). tests/trusted-proxies.test.js fails when the two
 * drift. Cloudflare publishes the list at https://www.cloudflare.com/ips/.
 *
 * F-248: those ranges are shared by every Cloudflare customer, including their
 * Workers, so a Cloudflare address alone does not prove the request came
 * through OUR zone. When CLOUDFLARE_ORIGIN_SECRET is set, a Cloudflare hop is
 * trusted only if the request carries a matching X-Nexus-Origin-Secret header
 * (added by our zone's Transform Rule); otherwise `req.ip` is the Cloudflare
 * address itself, so a forged X-Forwarded-For cannot choose a rate-limit
 * bucket. The header is removed from the request as soon as it is checked, so
 * it never reaches logs, Sentry, or the API. Unset = previous behaviour.
 */
const CLOUDFLARE_CIDRS = Object.freeze([
  // Cloudflare IPv4 ranges
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  // Cloudflare IPv6 ranges
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32'
]);

// `loopback` = 127.0.0.0/8 and ::1; `uniquelocal` = 10/8, 172.16/12,
// 192.168/16 and fc00::/7 — the same internal ranges ClientIp.php trusts.
const TRUSTED_PROXIES = Object.freeze(['loopback', 'uniquelocal', ...CLOUDFLARE_CIDRS]);

// Node lower-cases incoming header names.
const ORIGIN_SECRET_HEADER = 'x-nexus-origin-secret';

// The internal hops only (what `loopback` + `uniquelocal` mean to Express),
// used when a Cloudflare hop has NOT proved it is our zone.
const INTERNAL_BLOCKLIST = new net.BlockList();
INTERNAL_BLOCKLIST.addSubnet('127.0.0.0', 8, 'ipv4');
INTERNAL_BLOCKLIST.addSubnet('10.0.0.0', 8, 'ipv4');
INTERNAL_BLOCKLIST.addSubnet('172.16.0.0', 12, 'ipv4');
INTERNAL_BLOCKLIST.addSubnet('192.168.0.0', 16, 'ipv4');
INTERNAL_BLOCKLIST.addAddress('::1', 'ipv6');
INTERNAL_BLOCKLIST.addSubnet('fc00::', 7, 'ipv6');

function isInternalAddress(address) {
  const value = String(address || '');
  const mapped = value.toLowerCase().startsWith('::ffff:') ? value.slice(7) : '';
  if (mapped && net.isIPv4(mapped)) return INTERNAL_BLOCKLIST.check(mapped, 'ipv4');
  if (net.isIPv4(value)) return INTERNAL_BLOCKLIST.check(value, 'ipv4');
  if (net.isIPv6(value)) return INTERNAL_BLOCKLIST.check(value, 'ipv6');
  return false;
}

// Same walk as Express/proxy-addr, trusting internal hops only: nearest hop
// first (the socket peer, then X-Forwarded-For right to left), stopping at the
// first address that is not trusted — here, the Cloudflare edge.
function internalOnlyChain(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .reverse();
  const hops = [req.socket && req.socket.remoteAddress, ...forwarded];
  const chain = [];
  for (const hop of hops) {
    chain.push(hop);
    if (!isInternalAddress(hop)) break;
  }
  return chain;
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

function removeOriginSecretHeader(req) {
  delete req.headers[ORIGIN_SECRET_HEADER];
  if (Array.isArray(req.rawHeaders)) {
    for (let i = req.rawHeaders.length - 2; i >= 0; i -= 2) {
      if (String(req.rawHeaders[i]).toLowerCase() === ORIGIN_SECRET_HEADER) {
        req.rawHeaders.splice(i, 2);
      }
    }
  }
}

function cloudflareOriginSecretGate(originSecret) {
  const expected = digest(originSecret);
  return function verifyCloudflareOriginSecret(req, _res, next) {
    const provided = req.headers[ORIGIN_SECRET_HEADER];
    removeOriginSecretHeader(req);
    // Constant time: compare fixed-length digests, never the raw strings.
    const verified = typeof provided === 'string'
      && provided.trim() !== ''
      && crypto.timingSafeEqual(digest(provided.trim()), expected);
    if (!verified) {
      // Own properties shadow Express's req.ip / req.ips getters for this
      // request only; they are lazy so later middleware sees the live socket.
      Object.defineProperty(req, 'ip', {
        configurable: true,
        enumerable: true,
        get() {
          const chain = internalOnlyChain(this);
          return chain[chain.length - 1];
        }
      });
      Object.defineProperty(req, 'ips', {
        configurable: true,
        enumerable: true,
        get() {
          const chain = internalOnlyChain(this).reverse();
          chain.pop();
          return chain;
        }
      });
    }
    next();
  };
}

function applyTrustedProxies(app, { originSecret = process.env.CLOUDFLARE_ORIGIN_SECRET } = {}) {
  app.set('trust proxy', [...TRUSTED_PROXIES]);
  const secret = String(originSecret || '').trim();
  if (secret !== '') {
    // First middleware on the app (server.js calls this before any app.use).
    app.use(cloudflareOriginSecretGate(secret));
  }
  return app;
}

module.exports = {
  CLOUDFLARE_CIDRS,
  TRUSTED_PROXIES,
  ORIGIN_SECRET_HEADER,
  applyTrustedProxies
};
