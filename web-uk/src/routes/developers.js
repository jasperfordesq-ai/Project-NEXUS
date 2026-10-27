// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Partner API developer documentation — the accessible counterpart of React's
 * DevelopersHomePage, DevelopersAuthPage, DevelopersEndpointsPage and
 * DevelopersWebhooksPage (react-frontend/src/pages/developers/), served at the
 * same four public paths.
 *
 * The pages are static: React fetches nothing for them, so neither does this.
 * The prose comes from lang/<locale>/govuk_alpha_developers.php (copied from
 * React's `developers.*` keys). The code samples, HTTP methods, endpoint paths
 * and scope names below are literal technical text that React also keeps out of
 * its translations — they stay identical in every language. When React's
 * samples or endpoint list change, change them here in the same commit.
 */

const express = require('express');
const { breadcrumbJsonLdFor, pageDescription } = require('../lib/seo-meta');

const router = express.Router();
const NS = 'govuk_alpha_developers';

const CURL_SNIPPET = `# 1. Exchange credentials for an access token
curl -X POST https://api.project-nexus.ie/api/partner/v1/oauth/token \\
  -H "Content-Type: application/json" \\
  -d '{
    "grant_type": "client_credentials",
    "client_id": "pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "client_secret": "sk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "scope": "users.read wallet.read"
  }'

# 2. Use the token on subsequent calls
curl https://api.project-nexus.ie/api/partner/v1/users \\
  -H "Authorization: Bearer at_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

const JS_SNIPPET = `// Node 18+ / modern browser
async function getToken() {
  const res = await fetch('https://api.project-nexus.ie/api/partner/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: process.env.NEXUS_CLIENT_ID,
      client_secret: process.env.NEXUS_CLIENT_SECRET,
      scope: 'users.read wallet.read',
    }),
  });
  if (!res.ok) throw new Error('Auth failed: ' + res.status);
  return res.json(); // { access_token, token_type, expires_in, scope }
}

async function listUsers(accessToken) {
  const res = await fetch('https://api.project-nexus.ie/api/partner/v1/users', {
    headers: { Authorization: \`Bearer \${accessToken}\` },
  });
  return res.json();
}`;

const NODE_VERIFY = `// Verify an inbound NEXUS webhook (Node 18+)
import crypto from 'crypto';

function verifySignature(rawBody, signatureHeader, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');
  // Constant-time comparison
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Express handler
app.post('/webhooks/nexus', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.header('X-Partner-Signature') || '';
  if (!verifySignature(req.body, sig, process.env.NEXUS_WEBHOOK_SECRET)) {
    return res.status(401).send('invalid signature');
  }
  const event = JSON.parse(req.body.toString());
  // event.event_type === 'wallet.credited'
  // event.data === { transaction_id, user_id, hours, reference }
  res.status(200).send('ok');
});`;

const PHP_VERIFY = `<?php
// Verify an inbound NEXUS webhook (PHP 8+)
$rawBody = file_get_contents('php://input');
$signature = $_SERVER['HTTP_X_PARTNER_SIGNATURE'] ?? '';
$secret = getenv('NEXUS_WEBHOOK_SECRET');

$expected = hash_hmac('sha256', $rawBody, $secret);
if (! hash_equals($expected, $signature)) {
    http_response_code(401);
    echo 'invalid signature';
    exit;
}

$event = json_decode($rawBody, true);
// $event['event_type'] === 'wallet.credited'
http_response_code(200);
echo 'ok';`;

// Mirrors React's ENDPOINTS list (DevelopersEndpointsPage.tsx).
const ENDPOINTS = Object.freeze([
  { method: 'POST', path: '/api/partner/v1/oauth/token', descriptionKey: 'oauth_token' },
  { method: 'POST', path: '/api/partner/v1/oauth/revoke', descriptionKey: 'oauth_revoke' },
  { method: 'GET', path: '/api/partner/v1/users', scope: 'users.read', descriptionKey: 'users_list' },
  { method: 'GET', path: '/api/partner/v1/users/{id}', scope: 'users.read', descriptionKey: 'users_detail' },
  { method: 'GET', path: '/api/partner/v1/listings', scope: 'listings.read', descriptionKey: 'listings_list' },
  { method: 'GET', path: '/api/partner/v1/wallet/balance/{userId}', scope: 'wallet.read', descriptionKey: 'wallet_balance' },
  { method: 'POST', path: '/api/partner/v1/wallet/credit', scope: 'wallet.write', descriptionKey: 'wallet_credit' },
  { method: 'GET', path: '/api/partner/v1/aggregates/community', scope: 'aggregates.read', descriptionKey: 'aggregates_community' },
  { method: 'GET', path: '/api/partner/v1/webhooks/subscriptions', scope: 'webhooks.manage', descriptionKey: 'webhooks_list' },
  { method: 'POST', path: '/api/partner/v1/webhooks/subscriptions', scope: 'webhooks.manage', descriptionKey: 'webhooks_create' }
]);

const FEATURES = Object.freeze(['oauth', 'curated', 'webhooks', 'rate_limit']);

const SECTIONS = Object.freeze([
  { path: '/developers/auth', navKey: 'auth' },
  { path: '/developers/endpoints', navKey: 'endpoints' },
  { path: '/developers/webhooks', navKey: 'webhooks' }
]);

function tr(res, key) {
  return res.locals.t(`${NS}.${key}`);
}

// Shared locals: the page title, a description taken from the page's own lead
// paragraph (as React's PageMeta does), and breadcrumbs back to /developers.
function pageLocals(res, { path, titleKey, h1Key, descriptionKey }) {
  const title = tr(res, titleKey);
  const trail = [{ name: tr(res, 'page_title'), path: '/developers' }];
  if (path !== '/developers') trail.push({ name: tr(res, h1Key), path });
  return {
    title,
    titleKey: `${NS}.${titleKey}`,
    activeNav: '',
    // pageDescription strips markup, and auth_intro is plain text that contains a
    // literal `<token>`; escape it so the description keeps it instead of dropping it.
    metaDescription: pageDescription(tr(res, descriptionKey).replace(/&/g, '&amp;').replace(/</g, '&lt;')),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, trail),
    sections: SECTIONS
  };
}

router.get('/developers', (req, res) => {
  res.render('developers/home', {
    ...pageLocals(res, { path: '/developers', titleKey: 'page_title', descriptionKey: 'meta_description' }),
    features: FEATURES
  });
});

router.get('/developers/auth', (req, res) => {
  res.render('developers/auth', {
    ...pageLocals(res, { path: '/developers/auth', titleKey: 'auth_meta_title', h1Key: 'nav.auth', descriptionKey: 'auth_intro' }),
    steps: [1, 2, 3],
    curlSnippet: CURL_SNIPPET,
    jsSnippet: JS_SNIPPET
  });
});

router.get('/developers/endpoints', (req, res) => {
  res.render('developers/endpoints', {
    ...pageLocals(res, { path: '/developers/endpoints', titleKey: 'endpoints_meta_title', h1Key: 'nav.endpoints', descriptionKey: 'endpoints_intro' }),
    endpoints: ENDPOINTS
  });
});

router.get('/developers/webhooks', (req, res) => {
  res.render('developers/webhooks', {
    ...pageLocals(res, { path: '/developers/webhooks', titleKey: 'webhooks_meta_title', h1Key: 'nav.webhooks', descriptionKey: 'webhooks_intro' }),
    nodeSnippet: NODE_VERIFY,
    phpSnippet: PHP_VERIFY
  });
});

module.exports = router;
module.exports.ENDPOINTS = ENDPOINTS;
