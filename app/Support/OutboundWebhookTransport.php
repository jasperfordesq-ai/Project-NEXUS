<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

/**
 * The one place an outbound webhook actually leaves the process.
 *
 * WebhookDispatchService resolves this through the container, so a test can
 * bind a fake and exercise dispatch, test-send and retry without touching
 * the network. The curl options come from OutboundUrlGuard, which pins the
 * resolved address so a DNS answer cannot be swapped for a private one
 * between the SSRF check and the request.
 */
class OutboundWebhookTransport
{
    /** Seconds a receiver gets to answer before the delivery counts as failed. */
    public const TIMEOUT_SECONDS = 10;

    /**
     * @param array<int, string> $headers e.g. ['Content-Type: application/json']
     * @return array{http_code: int, response: string, error: string}
     */
    public function post(string $url, string $body, array $headers): array
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, OutboundUrlGuard::curlOptionsForUrl($url) + [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => self::TIMEOUT_SECONDS,
        ]);

        $response = curl_exec($ch);
        $httpCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = (string) curl_error($ch);
        curl_close($ch);

        return [
            'http_code' => $httpCode,
            'response' => is_string($response) ? $response : '',
            'error' => $error,
        ];
    }
}
