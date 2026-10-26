// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const { requestHost } = require('../middleware/tenant-routing');

/**
 * The full address (scheme, host, port, tenant prefix, path) of one of this
 * site's own pages, for handing to another service that will send the member
 * back here — Stripe's hosted payment and ID-check pages.
 *
 * 🔴 Why absolute: Laravel accepts a payment `return_url` only when it is an
 * absolute address on THIS community's accessible site or website. A bare path
 * ("/premium/return") is read as a WEBSITE path, so a member who paid here was
 * sent back to the React site afterwards.
 *
 * Production is always https behind the proxy; anywhere else the request's own
 * protocol is used, so a local http site still produces a working address. The
 * host is the one the member used (x-forwarded-host first, as tenant routing
 * reads it), keeping any port, so the address leads back to this same site.
 */
function absoluteUrl(req, res, pathname) {
  const urlFor = res && res.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  const path = urlFor(pathname);
  const headers = (req && req.headers) || {};
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : (req.protocol || 'https');
  const rawHost = String(headers['x-forwarded-host'] || headers.host || '').split(',').pop().trim().toLowerCase();
  // The host exactly as the member reached it (a "www." kept, the port kept);
  // anything that is not a plain host[:port] falls back to the routing host.
  const host = /^[a-z0-9.-]+(?::\d{1,5})?$/.test(rawHost) ? rawHost : requestHost(req);
  if (!host) return path;
  return `${protocol}://${host}${path.startsWith('/') ? path : `/${path}`}`;
}

module.exports = { absoluteUrl };
