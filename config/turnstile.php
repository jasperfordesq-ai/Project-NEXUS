<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Cloudflare Turnstile — the bot challenge on `POST /api/v2/contact`.
 *
 * 🔴 THIS FILE EXISTS BECAUSE THE CHECK WAS SILENTLY DISABLED IN PRODUCTION.
 *
 * `TurnstileService::verify()` read the secret with `env('TURNSTILE_SECRET_KEY')`
 * at REQUEST time. `scripts/deploy/bluegreen-deploy.sh` runs `php artisan
 * optimize` on every deploy, which caches config and stops Laravel loading `.env`
 * at all — so from that moment `env()` returns its default no matter what the
 * server's `.env` actually says. Proven on the container: a variable that read
 * `nexus` before `config:cache` read as absent afterwards.
 *
 * The service then treats an empty secret as "not configured" and returns TRUE —
 * i.e. every submission passes. So the contact form had no bot protection in
 * production regardless of configuration, and nothing surfaced it: the widget
 * rendered, the request succeeded, and the only trace was a `turnstile.skipped`
 * line at debug level, which `LOG_LEVEL=warning` discards.
 *
 * 🔴 Its unit test passed throughout, because the test set the value with
 * `putenv()` and then asserted `env()` read it back — exercising the same broken
 * mechanism rather than the production one. Read config here; never `env()`
 * outside this file.
 *
 * Fail-open on an unset secret is kept deliberately. An installation that has not
 * configured Turnstile should not have its contact form refuse everybody. What
 * changes is that "unset" now means genuinely unset, rather than "we deployed".
 */
return [
    /*
     * The Cloudflare secret key. Empty disables verification (fail open) — see
     * above for why that is intentional.
     */
    'secret' => env('TURNSTILE_SECRET_KEY', ''),

    /*
     * The public site key. The API does not use it; it is here so the one
     * authoritative place for Turnstile config is this file, and so a deployment
     * can be checked for consistency between the two halves.
     */
    'site_key' => env('TURNSTILE_SITE_KEY', ''),
];
