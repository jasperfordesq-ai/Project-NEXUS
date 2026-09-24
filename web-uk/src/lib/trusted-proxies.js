// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

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

function applyTrustedProxies(app) {
  app.set('trust proxy', [...TRUSTED_PROXIES]);
  return app;
}

module.exports = {
  CLOUDFLARE_CIDRS,
  TRUSTED_PROXIES,
  applyTrustedProxies
};
