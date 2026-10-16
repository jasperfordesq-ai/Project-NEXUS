<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Identity;

/**
 * StripeIdentityProvider — Integration with Stripe Identity for document + selfie verification.
 *
 * WHY STRIPE IDENTITY AS FIRST PROVIDER:
 * 1. Best developer experience — clean REST API, excellent docs, TypeScript SDK
 * 2. Global coverage — supports 33+ countries, 100+ document types
 * 3. Flexible pricing — pay-per-verification, no minimums (good for low-volume tenants)
 * 4. Document + Selfie support — covers the two most common verification levels
 * 5. Hosted flow AND embedded SDK — supports both redirect and in-app verification
 * 6. Webhook support — real-time status updates with HMAC signature verification
 * 7. Existing Stripe ecosystem — many platforms already have Stripe accounts
 * 8. PCI/SOC2 compliant — handles sensitive document data securely
 * 9. No contract required — self-serve signup, instant activation
 *
 * REQUIRED ENV VARS (per-tenant in provider_config or global fallback):
 * - STRIPE_IDENTITY_SECRET_KEY (sk_live_... or sk_test_...)
 * - STRIPE_IDENTITY_WEBHOOK_SECRET (whsec_...)
 *
 * STRIPE IDENTITY API:
 * - POST /v1/identity/verification_sessions — create session
 * - GET  /v1/identity/verification_sessions/{id} — get status
 * - POST /v1/identity/verification_sessions/{id}/cancel — cancel
 * - Webhook event: identity.verification_session.verified / requires_input / ...
 *
 * @see https://docs.stripe.com/identity
 */
class StripeIdentityProvider implements IdentityVerificationProviderInterface
{
    private const API_BASE = 'https://api.stripe.com/v1';

    public function getSlug(): string
    {
        return 'stripe_identity';
    }

    public function getName(): string
    {
        return 'Stripe Identity';
    }

    public function getSupportedLevels(): array
    {
        return ['document_only', 'document_selfie'];
    }

    public function createSession(int $userId, int $tenantId, string $level, array $metadata = []): array
    {
        $apiKey = $this->getApiKey($metadata);

        // Map our verification levels to Stripe's verification check types
        $options = ['type' => 'document'];
        if ($level === 'document_selfie') {
            $options = ['type' => 'document', 'document' => ['require_matching_selfie' => true]];
        }

        $params = [
            'type' => 'document',
            'metadata' => [
                'nexus_user_id' => (string) $userId,
                'nexus_tenant_id' => (string) $tenantId,
            ],
        ];

        if ($level === 'document_selfie') {
            $params['options'] = ['document' => ['require_matching_selfie' => 'true']];
        }

        // Allowed countries (optional)
        if (!empty($metadata['allowed_countries'])) {
            $params['options']['document']['allowed_types'] = ['driving_license', 'passport', 'id_card'];
        }

        // Stripe Identity doesn't accept name/DOB upfront for matching.
        // Instead, after verification passes, we retrieve verified_outputs
        // (name + DOB extracted from document) and compare against the user's profile.
        // Pass email/phone in provided_details if available.
        if (!empty($metadata['provided_details']['email'])) {
            $params['provided_details'] = ['email' => $metadata['provided_details']['email']];
        }

        // Return URL after hosted verification
        $frontendUrl = \App\Core\TenantContext::getFrontendUrl();
        $slugPrefix = \App\Core\TenantContext::getSlugPrefix();
        $params['return_url'] = $frontendUrl . $slugPrefix . '/verify-identity/callback';

        $response = $this->stripeRequest('POST', '/identity/verification_sessions', $params, $apiKey);

        return [
            'provider_session_id' => $response['id'],
            'redirect_url' => $response['url'] ?? null,
            'client_token' => $response['client_secret'] ?? null,
            'expires_at' => isset($response['expires_at'])
                ? date('Y-m-d\TH:i:s\Z', $response['expires_at'])
                : null,
        ];
    }

    public function getSessionStatus(string $providerSessionId): array
    {
        // The session was created with the key of the community that owns it
        // (its own key when it stored one, else the platform's). Reading it
        // back with any other key answers 404, so resolve the same key here.
        $apiKey = $this->credentialsForSession($providerSessionId)['api_key'];

        // Expand verified_outputs to get name/DOB from the document
        $params = ['expand' => ['verified_outputs']];
        $response = $this->stripeRequest('GET', "/identity/verification_sessions/{$providerSessionId}", $params, $apiKey);

        $statusMap = [
            'requires_input' => 'started',
            'processing' => 'processing',
            'verified' => 'passed',
            'canceled' => 'cancelled',
        ];

        $status = $statusMap[$response['status']] ?? 'processing';
        $failureReason = null;

        if ($response['status'] === 'requires_input' && !empty($response['last_error'])) {
            $status = 'failed';
            $failureReason = $response['last_error']['reason'] ?? 'Verification requires additional input';
        }

        // Extract verified outputs (name, DOB from the document)
        $verifiedOutputs = $response['verified_outputs'] ?? null;

        return [
            'status' => $status,
            'decision' => $response['status'] === 'verified' ? 'approved' : null,
            'risk_score' => null,
            'failure_reason' => $failureReason,
            'verified_first_name' => $verifiedOutputs['first_name'] ?? null,
            'verified_last_name' => $verifiedOutputs['last_name'] ?? null,
            'verified_dob' => $verifiedOutputs['dob'] ?? null,
        ];
    }

    public function handleWebhook(array $payload, array $headers): array
    {
        $event = $payload;
        $session = $event['data']['object'] ?? [];
        $eventType = $event['type'] ?? '';

        $statusMap = [
            'identity.verification_session.verified' => 'passed',
            'identity.verification_session.requires_input' => 'failed',
            'identity.verification_session.canceled' => 'cancelled',
            'identity.verification_session.processing' => 'processing',
            'identity.verification_session.created' => 'created',
        ];

        $status = $statusMap[$eventType] ?? 'processing';
        $failureReason = null;

        if ($status === 'failed' && !empty($session['last_error'])) {
            $failureReason = $session['last_error']['reason']
                ?? $session['last_error']['code']
                ?? 'Verification failed';
        }

        return [
            'provider_session_id' => $session['id'] ?? '',
            'status' => $status,
            'decision' => $status === 'passed' ? 'approved' : ($status === 'failed' ? 'declined' : null),
            'risk_score' => null,
            'failure_reason' => $failureReason,
            'raw_event_type' => $eventType,
        ];
    }

    public function verifyWebhookSignature(string $rawBody, array $headers): bool
    {
        $sigHeader = $headers['Stripe-Signature'] ?? $headers['stripe-signature'] ?? '';
        if (empty($sigHeader)) {
            return false;
        }

        // A community that runs checks through its own Stripe account receives
        // webhooks from THAT account, signed with the secret of the endpoint it
        // registered there. The body is decoded only to find which session (and
        // so which community) the event is about; nothing in it is trusted
        // until the HMAC below has passed.
        $decoded = json_decode($rawBody, true);
        $providerSessionId = is_array($decoded) ? (string) ($decoded['data']['object']['id'] ?? '') : '';
        $webhookSecret = $this->credentialsForSession($providerSessionId)['webhook_secret'];
        if (!$webhookSecret) {
            \Illuminate\Support\Facades\Log::warning('[StripeIdentityProvider] No webhook secret configured');
            return false;
        }

        // Parse Stripe signature header: t=timestamp,v1=signature
        $parts = [];
        foreach (explode(',', $sigHeader) as $item) {
            [$key, $value] = explode('=', $item, 2);
            $parts[$key] = $value;
        }

        $timestamp = $parts['t'] ?? '';
        $signature = $parts['v1'] ?? '';

        if (!$timestamp || !$signature) {
            return false;
        }

        // Tolerance: reject webhooks older than 5 minutes
        if (abs(time() - (int) $timestamp) > 300) {
            return false;
        }

        $signedPayload = $timestamp . '.' . $rawBody;
        $expectedSignature = hash_hmac('sha256', $signedPayload, $webhookSecret);

        return hash_equals($expectedSignature, $signature);
    }

    public function cancelSession(string $providerSessionId): bool
    {
        try {
            $apiKey = $this->credentialsForSession($providerSessionId)['api_key'];
            $this->stripeRequest('POST', "/identity/verification_sessions/{$providerSessionId}/cancel", [], $apiKey);
            return true;
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::warning("[StripeIdentityProvider] Failed to cancel session {$providerSessionId}: " . $e->getMessage());
            return false;
        }
    }

    public function isAvailable(int $tenantId): bool
    {
        // Check global key first, then tenant-specific credentials
        if (!empty($this->getGlobalApiKey())) {
            return true;
        }
        return TenantProviderCredentialService::hasCredentials($tenantId, $this->getSlug());
    }

    /**
     * The Stripe key and webhook secret that apply to an existing verification
     * session: the owning community's own credentials when it stored them,
     * otherwise the platform's. A session id that is unknown (or empty) means
     * the platform's credentials.
     *
     * @return array{api_key:string,webhook_secret:string,tenant_id:?int,uses_tenant_key:bool,uses_tenant_webhook_secret:bool}
     */
    public function credentialsForSession(string $providerSessionId): array
    {
        $tenantId = null;
        if ($providerSessionId !== '') {
            try {
                $session = IdentityVerificationSessionService::findByProviderSession($this->getSlug(), $providerSessionId);
                $tenantId = $session && !empty($session['tenant_id']) ? (int) $session['tenant_id'] : null;
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning('[StripeIdentityProvider] Could not look up the session owner; using platform credentials: ' . $e->getMessage());
            }
        }

        return $this->credentialsForTenant($tenantId);
    }

    /**
     * @return array{api_key:string,webhook_secret:string,tenant_id:?int,uses_tenant_key:bool,uses_tenant_webhook_secret:bool}
     */
    public function credentialsForTenant(?int $tenantId): array
    {
        $stored = $tenantId ? (TenantProviderCredentialService::get($tenantId, $this->getSlug()) ?? []) : [];
        $tenantKey = trim((string) ($stored['api_key'] ?? ''));
        $tenantSecret = trim((string) ($stored['webhook_secret'] ?? ''));

        return [
            'api_key' => $tenantKey !== '' ? $tenantKey : $this->getGlobalApiKey(),
            'webhook_secret' => $tenantSecret !== '' ? $tenantSecret : $this->getGlobalWebhookSecret(),
            'tenant_id' => $tenantId,
            'uses_tenant_key' => $tenantKey !== '',
            'uses_tenant_webhook_secret' => $tenantSecret !== '',
        ];
    }

    // ─── Private helpers ─────────────────────────────────────────────────

    private function getApiKey(array $metadata): string
    {
        // Prefer tenant-specific key, fall back to global
        $tenantKey = trim((string) ($metadata['api_key'] ?? ''));

        return $tenantKey !== '' ? $tenantKey : $this->getGlobalApiKey();
    }

    private function getGlobalApiKey(): string
    {
        return \App\Core\Env::get('STRIPE_IDENTITY_SECRET_KEY') ?: '';
    }

    private function getGlobalWebhookSecret(): string
    {
        return \App\Core\Env::get('STRIPE_IDENTITY_WEBHOOK_SECRET') ?: '';
    }

    /**
     * Make an HTTP request to the Stripe API.
     *
     * @param string $method HTTP method
     * @param string $path   API path (e.g. /identity/verification_sessions)
     * @param array  $params Request parameters
     * @param string $apiKey Stripe API key
     * @return array Decoded response
     * @throws \RuntimeException On API error
     */
    private function stripeRequest(string $method, string $path, array $params, string $apiKey): array
    {
        $url = self::API_BASE . $path;

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, 30);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/x-www-form-urlencoded',
            'Stripe-Version: 2024-12-18.acacia',
        ]);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($this->flattenParams($params)));
        } elseif ($method === 'GET' && !empty($params)) {
            $url .= '?' . http_build_query($this->flattenParams($params));
        }

        curl_setopt($ch, CURLOPT_URL, $url);

        $responseBody = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        if ($error) {
            throw new \RuntimeException("Stripe API request failed: {$error}");
        }

        $response = json_decode($responseBody, true);

        if ($httpCode >= 400) {
            $errorMessage = $response['error']['message'] ?? "Stripe API error (HTTP {$httpCode})";
            throw new \RuntimeException($errorMessage);
        }

        return $response ?? [];
    }

    /**
     * Flatten nested params for Stripe's form-encoded API.
     * e.g. ['options' => ['document' => ['require_matching_selfie' => 'true']]]
     * becomes ['options[document][require_matching_selfie]' => 'true']
     */
    private function flattenParams(array $params, string $prefix = ''): array
    {
        $result = [];
        foreach ($params as $key => $value) {
            $fullKey = $prefix ? "{$prefix}[{$key}]" : $key;
            if (is_array($value)) {
                $result = array_merge($result, $this->flattenParams($value, $fullKey));
            } else {
                $result[$fullKey] = (string) $value;
            }
        }
        return $result;
    }
}
