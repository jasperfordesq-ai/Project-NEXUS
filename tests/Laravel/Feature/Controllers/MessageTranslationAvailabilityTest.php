<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Message translation must distinguish "not available here" from "it failed".
 *
 * 🔴 Found by walking the messaging journey in a browser on 2026-08-24.
 * `TranscriptionService::translate()` returns null when the OpenAI key is not
 * configured — the same null it returns when the provider is called and fails —
 * and the controller turned both into `TRANSLATION_FAILED` with HTTP 500 and the
 * message "Translation failed. Please try again."
 *
 * Three consequences, all real:
 *  - the member is told to retry something that can never work on an
 *    installation with no key;
 *  - every press records a server error, so error monitoring fills with a
 *    permanent, un-actionable 500; and
 *  - React's auto-translate loop removes each message from its dedup set when a
 *    translation fails, so it retries every message on every render cycle. One
 *    unconfigured tenant therefore produces an endless stream of 500s.
 *
 * The accessible frontend already had an "unavailable" state and no way to reach
 * it: it mapped only codes containing FEATURE_DISABLED, which is the per-tenant
 * feature switch, not the platform provider.
 */
class MessageTranslationAvailabilityTest extends TestCase
{
    use DatabaseTransactions;

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function messageBetween(User $sender, User $receiver): int
    {
        return (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $sender->getKey(),
            'receiver_id' => $receiver->getKey(),
            'body' => 'Can you help with the repair cafe on Saturday?',
            'is_read' => 0,
            'is_deleted' => 0,
            'created_at' => now(),
        ]);
    }

    public function test_reports_unavailable_rather_than_failed_when_no_provider_is_configured(): void
    {
        config(['services.openai.api_key' => null]);

        $me = $this->member();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->messageBetween($other, $me);

        $response = $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'de']);

        // 503, not 500: a missing integration is not a server fault, and a 500
        // here is a permanent entry in error monitoring.
        $response->assertStatus(503);
        $body = $response->json();
        $this->assertSame('TRANSLATION_UNAVAILABLE', $body['errors'][0]['code'] ?? null);
        // The old message said "Please try again", which was false advice.
        $this->assertStringNotContainsStringIgnoringCase(
            'try again',
            (string) ($body['errors'][0]['message'] ?? ''),
        );
    }

    public function test_the_unavailable_answer_is_given_before_any_provider_call(): void
    {
        config(['services.openai.api_key' => null]);

        $me = $this->member();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->messageBetween($other, $me);

        // No HTTP fake is installed. If the controller reached the provider, the
        // real client would attempt a network call and this test would be slow
        // and flaky rather than instant — which is the point of checking first.
        $started = microtime(true);
        $response = $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'de']);
        $elapsed = microtime(true) - $started;

        $response->assertStatus(503);
        $this->assertLessThan(5.0, $elapsed, 'The refusal must not wait on a provider call.');
    }

    public function test_availability_is_reported_from_configuration(): void
    {
        config(['services.openai.api_key' => null]);
        $this->assertFalse(\App\Services\TranscriptionService::isConfigured());

        config(['services.openai.api_key' => 'sk-test-not-a-real-key']);
        $this->assertTrue(\App\Services\TranscriptionService::isConfigured());
    }

    public function test_still_refuses_a_message_with_nothing_to_translate(): void
    {
        // The empty-content answer must not be swallowed by the availability
        // check: it is reported before it, so the member gets the specific reason.
        config(['services.openai.api_key' => null]);

        $me = $this->member();
        $other = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = (int) DB::table('messages')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'sender_id' => $other->getKey(),
            'receiver_id' => $me->getKey(),
            'body' => '',
            'is_read' => 0,
            'is_deleted' => 0,
            'created_at' => now(),
        ]);

        $response = $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'de']);

        $response->assertStatus(422);
        $this->assertSame('NO_CONTENT', $response->json('errors.0.code'));
    }

    public function test_a_message_the_member_is_not_part_of_is_still_not_found(): void
    {
        config(['services.openai.api_key' => null]);

        $this->member();
        $strangerA = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $strangerB = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $id = $this->messageBetween($strangerA, $strangerB);

        $response = $this->apiPost("/v2/messages/{$id}/translate", ['target_language' => 'de']);

        // Availability must not leak ahead of authorisation.
        $response->assertStatus(404);
    }
}
