<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * TurnstileService — verifies Cloudflare Turnstile challenge tokens.
 *
 * Used as a bot-defence layer on public, unauthenticated form submissions
 * (registration, contact, etc.). The widget renders a `cf-turnstile-response`
 * hidden input on the client; the server POSTs it to Cloudflare's siteverify
 * endpoint along with the secret key and trusts only the resulting `success`
 * flag.
 *
 * Behaviour:
 * - When TURNSTILE_SECRET_KEY is unset OR set to the always-passes test key
 *   `1x0000000000000000000000000000000AA`, verification is skipped (returns
 *   true) and a debug line is logged. This keeps local dev + CI working
 *   without hitting Cloudflare.
 * - On verification failure (network error, invalid response, success=false),
 *   returns false and logs at info level with the error-codes array Cloudflare
 *   returned.
 * - Verification has a 4-second hard timeout so a Cloudflare outage can't
 *   stall the registration request indefinitely.
 */
class TurnstileService
{
    private const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
    private const TEST_PASS_SECRET = '1x0000000000000000000000000000000AA';
    private const TIMEOUT_SECONDS = 4;

    /**
     * Verify a Turnstile token. Returns true if Cloudflare accepts it, the
     * service is disabled, or the test-pass key is configured. Returns
     * false on network error, malformed response, or explicit failure.
     */
    public function verify(?string $token, ?string $remoteIp = null): bool
    {
        // 🔴 config(), NEVER env(). This read used to be
        // `env('TURNSTILE_SECRET_KEY', '')`, and the deploy runs `artisan optimize`
        // — after which Laravel stops loading `.env` and `env()` returns its
        // default. Combined with the empty-secret fail-open below, that silently
        // disabled the bot check in production no matter how it was configured.
        // See config/turnstile.php for the full account.
        $secret = (string) config('turnstile.secret', '');

        if ($secret === '' || $secret === self::TEST_PASS_SECRET) {
            Log::debug('turnstile.skipped', ['reason' => $secret === '' ? 'unset' : 'test_pass_key']);
            return true;
        }

        if ($token === null || trim($token) === '') {
            Log::info('turnstile.missing_token');
            return false;
        }

        try {
            $response = Http::asForm()
                ->timeout(self::TIMEOUT_SECONDS)
                ->post(self::SITEVERIFY_URL, array_filter([
                    'secret' => $secret,
                    'response' => $token,
                    'remoteip' => $remoteIp,
                ]));
        } catch (\Throwable $e) {
            Log::info('turnstile.network_error', ['error' => $e->getMessage()]);
            return false;
        }

        if (! $response->ok()) {
            Log::info('turnstile.http_error', ['status' => $response->status()]);
            return false;
        }

        $body = $response->json();
        $success = is_array($body) && ! empty($body['success']);

        if (! $success) {
            Log::info('turnstile.rejected', [
                'error_codes' => $body['error-codes'] ?? [],
                'hostname' => $body['hostname'] ?? null,
            ]);
        }

        return $success;
    }
}
