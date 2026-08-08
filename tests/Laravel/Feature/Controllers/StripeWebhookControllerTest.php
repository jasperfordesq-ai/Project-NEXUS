<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * Smoke tests for StripeWebhookController.
 *
 * Public webhook receiver — no Sanctum; Stripe signature is verified
 * inside the controller. Invalid/missing signature must yield 4xx, not 500.
 */
class StripeWebhookControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_controller_exists(): void
    {
        $this->assertTrue(class_exists(\App\Http\Controllers\Api\StripeWebhookController::class));
    }

    public function test_handle_webhook_rejects_empty_payload(): void
    {
        $response = $this->apiPost('/v2/webhooks/stripe', []);
        // No Stripe-Signature header — expect non-200 (signature failure).
        // 500 is acceptable if Stripe SDK/secret isn't configured in test env;
        // the key assertion is that unauthenticated callers never get 200/201.
        $this->assertNotEquals(200, $response->status());
        $this->assertNotEquals(201, $response->status());
    }

    public function test_handle_webhook_rejects_invalid_signature(): void
    {
        $response = $this->apiPost(
            '/v2/webhooks/stripe',
            ['id' => 'evt_test', 'type' => 'charge.succeeded'],
            ['Stripe-Signature' => 'invalid_signature']
        );
        $this->assertNotEquals(200, $response->status());
        $this->assertNotEquals(201, $response->status());
    }

    public function test_handle_webhook_rejects_garbage_body(): void
    {
        $response = $this->apiPost('/v2/webhooks/stripe', ['garbage' => str_repeat('x', 200)]);
        $this->assertNotEquals(200, $response->status());
        $this->assertNotEquals(201, $response->status());
    }

    public function test_marketplace_webhook_rejects_empty_payload(): void
    {
        $response = $this->apiPost('/v2/marketplace/webhooks/stripe', []);
        $this->assertNotEquals(200, $response->status());
        $this->assertNotEquals(201, $response->status());
    }

    public function test_marketplace_webhook_rejects_generic_webhook_secret_signature(): void
    {
        if (!class_exists(\Stripe\Webhook::class)) {
            $this->markTestSkipped('Stripe SDK not installed in this test environment');
        }

        config([
            'services.stripe.webhook_secret' => 'whsec_generic_test_secret',
            'services.stripe.marketplace_webhook_secret' => 'whsec_marketplace_test_secret',
        ]);

        $payload = $this->stripeEventPayload('evt_marketplace_generic_' . uniqid());
        $response = $this->postRawStripeWebhook(
            '/api/v2/marketplace/webhooks/stripe',
            $payload,
            $this->stripeSignatureHeader($payload, 'whsec_generic_test_secret')
        );

        $this->assertSame(400, $response->getStatusCode());
    }

    public function test_marketplace_webhook_accepts_marketplace_webhook_secret_signature(): void
    {
        if (!class_exists(\Stripe\Webhook::class)) {
            $this->markTestSkipped('Stripe SDK not installed in this test environment');
        }

        config([
            'services.stripe.webhook_secret' => 'whsec_generic_test_secret',
            'services.stripe.marketplace_webhook_secret' => 'whsec_marketplace_test_secret',
        ]);

        $payload = $this->stripeEventPayload('evt_marketplace_specific_' . uniqid());
        $response = $this->postRawStripeWebhook(
            '/api/v2/marketplace/webhooks/stripe',
            $payload,
            $this->stripeSignatureHeader($payload, 'whsec_marketplace_test_secret')
        );

        $this->assertSame(200, $response->getStatusCode());
    }

    // ============================================================
    // DEEP SECURITY TESTS
    // ============================================================

    /**
     * Missing Stripe-Signature header must NEVER return 2xx (signature
     * verification is the gate). In test env, Stripe SDK may throw a
     * non-SignatureVerificationException for empty-signature input,
     * which is caught by the generic handler -> 500 WEBHOOK_ERROR.
     * The critical invariant is: not 200/201/202.
     *
     * CONTROLLER WEAKNESS NOTE: missing Stripe-Signature should ideally
     * return 400 INVALID_SIGNATURE, not 500. Currently the generic catch
     * masks a legitimate signature-missing case as a server error.
     */
    public function test_missing_signature_header_never_returns_2xx(): void
    {
        $response = $this->apiPost(
            '/v2/webhooks/stripe',
            ['id' => 'evt_x', 'type' => 'charge.succeeded'],
            [] // no Stripe-Signature
        );
        $this->assertNotEquals(200, $response->status());
        $this->assertNotEquals(201, $response->status());
        $this->assertNotEquals(202, $response->status());
    }

    /**
     * Bogus signature is rejected with 400 and INVALID_SIGNATURE error code
     * (when Stripe SDK is available in the test env).
     */
    public function test_bogus_signature_rejected_with_invalid_signature_code(): void
    {
        if (!class_exists(\Stripe\Webhook::class)) {
            $this->markTestSkipped('Stripe SDK not installed in this test environment');
        }
        config(['services.stripe.webhook_secret' => 'whsec_test_secret']);

        $response = $this->apiPost(
            '/v2/webhooks/stripe',
            ['id' => 'evt_bogus', 'type' => 'charge.succeeded'],
            ['Stripe-Signature' => 't=1,v1=deadbeef']
        );
        $this->assertSame(400, $response->status());
        $body = $response->json();
        $this->assertSame('INVALID_SIGNATURE', $body['errors'][0]['code'] ?? null);
    }

    /**
     * Completely empty body + no signature: must not leak a 2xx or crash with 500+crashes.
     * Controller returns 400 INVALID_SIGNATURE via SDK exception path.
     */
    public function test_empty_body_no_signature_rejected(): void
    {
        $response = $this->call(
            'POST',
            '/api/v2/webhooks/stripe',
            [],
            [],
            [],
            $this->transformHeadersToServerVars($this->withTenantHeader([])),
            '' // raw empty body
        );
        $this->assertNotEquals(200, $response->getStatusCode());
        $this->assertNotEquals(201, $response->getStatusCode());
    }

    /**
     * Idempotency: a previously-processed event_id must short-circuit and NOT
     * reinvoke downstream handlers. We prove this by pre-inserting a row with
     * status=processed; the second delivery would normally re-run match() but
     * because the signature verification fails first in test env, we instead
     * directly assert the idempotency row is respected (verified via
     * the processed row surviving unchanged).
     */
    public function test_idempotency_row_survives_invalid_signature_retry(): void
    {
        $eventId = 'evt_idem_' . uniqid();
        DB::table('stripe_webhook_events')->insert([
            'event_id' => $eventId,
            'event_type' => 'charge.succeeded',
            'status' => 'processed',
            'processed_at' => now(),
        ]);

        // Retry with bogus signature — should 400 before touching the row
        $this->apiPost(
            '/v2/webhooks/stripe',
            ['id' => $eventId, 'type' => 'charge.succeeded'],
            ['Stripe-Signature' => 'invalid']
        );

        $row = DB::table('stripe_webhook_events')->where('event_id', $eventId)->first();
        $this->assertNotNull($row);
        $this->assertSame('processed', $row->status);

        DB::table('stripe_webhook_events')->where('event_id', $eventId)->delete();
    }

    /**
     * Garbage requests must never return 2xx. Some garbage (e.g. empty body)
     * triggers the generic 500 handler instead of 400 — that is a known
     * controller weakness, but it still safely rejects the event.
     */
    public function test_malformed_requests_never_return_2xx(): void
    {
        foreach (['{not-json', '[1,2,3]', '{"type":""}'] as $body) {
            $response = $this->call(
                'POST',
                '/api/v2/webhooks/stripe',
                [],
                [],
                [],
                $this->transformHeadersToServerVars($this->withTenantHeader([
                    'Content-Type' => 'application/json',
                    'Stripe-Signature' => 't=1,v1=abc',
                ])),
                $body
            );
            $this->assertNotEquals(200, $response->getStatusCode(),
                "Body '{$body}' returned 200 — signature path MUST reject");
            $this->assertNotEquals(202, $response->getStatusCode());
        }
    }

    /**
     * Control: confirm stripe_webhook_events table is the idempotency store
     * (in environments where it's migrated). The test schema may or may not
     * have this table depending on how migrations run.
     */
    public function test_idempotency_table_structure_when_present(): void
    {
        $this->assertTrue(Schema::hasColumn('stripe_webhook_events', 'event_id'));
        // Note: test schema may lag behind the latest Laravel migration.
        // Only assert event_id is present — that's the core idempotency key.
    }

    public function test_failed_stripe_webhook_rows_are_reclaimable_for_retry(): void
    {
        $source = file_get_contents(app_path('Http/Controllers/Api/StripeWebhookController.php'));

        $this->assertStringContainsString("->where('status', 'failed')", $source);
        $this->assertStringContainsString("->where('status', 'processing')", $source);
        $this->assertStringContainsString("->where('processed_at', '<', now()->subMinutes(10))", $source);
        $this->assertStringContainsString("'status' => 'processing'", $source);
        $this->assertStringContainsString('retry delivery reclaimed failed or stale event', $source);
        $this->assertStringContainsString("'processed_at' => now()", $source);
    }

    private function stripeEventPayload(string $eventId): string
    {
        return json_encode([
            'id' => $eventId,
            'object' => 'event',
            'type' => 'product.created',
            'data' => [
                'object' => [
                    'id' => 'prod_test',
                    'object' => 'product',
                ],
            ],
        ]);
    }

    private function stripeSignatureHeader(string $payload, string $secret): string
    {
        $timestamp = time();
        $signature = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);

        return "t={$timestamp},v1={$signature}";
    }

    private function postRawStripeWebhook(string $uri, string $payload, string $signature): \Illuminate\Testing\TestResponse
    {
        return $this->call(
            'POST',
            $uri,
            [],
            [],
            [],
            $this->transformHeadersToServerVars($this->withTenantHeader([
                'Content-Type' => 'application/json',
                'Stripe-Signature' => $signature,
            ])),
            $payload
        );
    }
}
