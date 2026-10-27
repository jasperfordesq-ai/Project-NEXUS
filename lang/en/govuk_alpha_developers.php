<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/en/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Developers',
    'meta_description' => 'Explore the Project NEXUS partner API for OAuth2 authentication, scoped endpoints, signed webhooks, and integration access.',
    'hero_title' => 'Build with NEXUS',
    'hero_subtitle' => 'A curated REST API for banking, payment, and municipal admin partners. OAuth2 client credentials, signed webhooks, and a sandbox you can hit in five minutes.',
    'feature_oauth_title' => 'OAuth2 client credentials',
    'feature_oauth_body' => 'Server-to-server authentication. Short-lived bearer tokens, scoped per partner.',
    'feature_curated_title' => 'Curated endpoint set',
    'feature_curated_body' => 'Only what banks and admin systems actually need: users, listings, wallet, aggregates.',
    'feature_webhooks_title' => 'Signed webhooks',
    'feature_webhooks_body' => 'HMAC-SHA256 signatures, automatic retries, delivery health in your dashboard.',
    'feature_rate_limit_title' => 'Per-partner rate limits',
    'feature_rate_limit_body' => 'Configurable per-minute quotas. 429 responses include Retry-After.',
    'request_access_cta' => 'Request access',
    'request_access_body' => 'Partner API access is provisioned by your community administrator. Contact them to get a client_id / client_secret pair.',
    'nav' => [
        'overview' => 'Overview',
        'auth' => 'Authentication',
        'endpoints' => 'Endpoints',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'API Authentication',
    'auth_intro' => 'Exchange your client credentials for a short-lived bearer token, then attach it to every request as Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Get client credentials',
    'auth_step1_body' => 'Your community admin provisions a client_id and client_secret in the admin console. The secret is shown only once at creation time.',
    'auth_step2_title' => '2. Exchange for a token',
    'auth_step2_body' => 'POST your credentials to /api/partner/v1/oauth/token. The response includes access_token, expires_in (3600s), and granted scope.',
    'auth_step3_title' => '3. Call the API',
    'auth_step3_body' => 'Attach the token to the Authorization header. Tokens are scoped — the API will return 403 insufficient_scope if you exceed your grant.',
    'tabs' => [
        'code_examples' => 'Code examples',
        'verification_examples' => 'Verification examples',
    ],
    'curl_example' => 'curl example',
    'js_example' => 'JavaScript example',
    'endpoints_meta_title' => 'API Endpoints',
    'endpoints_intro' => 'Hand-picked REST endpoints. All paths are prefixed with /api/partner/v1. All responses are JSON with API-Version: 2.0 header.',
    'endpoints_table_aria' => 'Partner API endpoints',
    'method_label' => 'Method',
    'path_label' => 'Path',
    'scope_label' => 'Scope',
    'description_label' => 'Description',
    'endpoint_descriptions' => [
        'oauth_token' => 'Exchange client credentials for a bearer token (client_credentials grant).',
        'oauth_revoke' => 'Revoke an issued bearer token (RFC 7009).',
        'users_list' => 'List active members. Add scope users.pii to receive email.',
        'users_detail' => 'Fetch a single member by ID.',
        'listings_list' => 'List active listings (services and requests).',
        'wallet_balance' => 'Read a member\'s time-credit balance in hours.',
        'wallet_credit' => 'Credit time hours from a settled bank transfer. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Bucketed community totals (no PII). Useful for partner dashboards.',
        'webhooks_list' => 'List your webhook subscriptions.',
        'webhooks_create' => 'Subscribe to events. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'API Webhooks',
    'webhooks_intro' => 'Subscribe to events with HTTPS callback URLs. Each delivery includes an X-Partner-Signature header — an HMAC-SHA256 of the raw body, keyed by the subscription secret returned at creation time.',
    'webhook_events_title' => 'Available events',
    'webhook_event_wallet_credited' => 'wallet.credited — fires when a partner credits time hours via /wallet/credit',
    'webhook_create_title' => 'Create a subscription',
    'webhook_create_body' => 'POST /api/partner/v1/webhooks/subscriptions with event_types (array) and target_url (https only). The response includes a one-time secret — store it.',
    'webhook_signing_title' => 'Verifying signatures',
    'webhook_signing_body' => 'Compute HMAC-SHA256 of the raw request body using your subscription secret. Compare with the X-Partner-Signature header in constant time.',
];
