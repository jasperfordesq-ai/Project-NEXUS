<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Feature tests for AiChatController — AI chat, conversations, content generation.
 */
class AiChatControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(array $overrides = []): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    // ------------------------------------------------------------------
    //  POST /ai/chat
    // ------------------------------------------------------------------

    public static function feedbackOwners(): array
    {
        return [
            'own trace' => ['trace_id', 'own', 200],
            'own message' => ['message_id', 'own', 200],
            'another member trace' => ['trace_id', 'other', 404],
            'another member message' => ['message_id', 'other', 404],
            'foreign tenant trace' => ['trace_id', 'foreign', 404],
            'foreign tenant message' => ['message_id', 'foreign', 404],
        ];
    }

    #[DataProvider('feedbackOwners')]
    public function test_feedback_is_owned_by_the_authenticated_member(string $key, string $owner, int $status): void
    {
        $actor = $this->authenticatedUser();
        $other = User::factory()->forTenant($this->testTenantId)->create();
        $traceId = DB::table('ai_turn_traces')->insertGetId([
            'tenant_id' => $owner === 'foreign' ? 1 : $this->testTenantId,
            'user_id' => $owner === 'other' ? $other->id : $actor->id,
            'message_id' => 987654321,
            'user_text' => 'Synthetic feedback ownership check',
            'assistant_text' => 'Synthetic answer',
            'feedback' => 'up',
            'feedback_note' => 'Original note',
        ]);

        $response = $this->apiPost('/ai/chat/feedback', [
            $key => $key === 'trace_id' ? $traceId : 987654321,
            'feedback' => 'down',
            'note' => 'Updated note',
        ]);

        $response->assertStatus($status);
        $row = DB::table('ai_turn_traces')->where('id', $traceId)->first();
        $this->assertSame($status === 200 ? 'down' : 'up', $row->feedback);
        $this->assertSame($status === 200 ? 'Updated note' : 'Original note', $row->feedback_note);
        if ($status === 200) {
            $response->assertJsonPath('data.recorded', true);
        }
    }

    public function test_chat_requires_authentication(): void
    {
        $response = $this->apiPost('/ai/chat', ['message' => 'Hello']);

        $response->assertStatus(401);
    }

    public function test_chat_requires_message_field(): void
    {
        $this->authenticatedUser();
        foreach (['ai_enabled', 'ai_chat_enabled'] as $key) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => '1', 'updated_at' => now()]
            );
        }

        $response = $this->apiPost('/ai/chat', []);

        $this->assertContains($response->getStatusCode(), [400, 422]);
    }

    // ------------------------------------------------------------------
    //  GET /ai/conversations
    // ------------------------------------------------------------------

    public function test_list_conversations_requires_auth(): void
    {
        $response = $this->apiGet('/ai/conversations');

        $response->assertStatus(401);
    }

    public function test_list_conversations_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/ai/conversations');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /ai/conversations
    // ------------------------------------------------------------------

    public function test_create_conversation_requires_auth(): void
    {
        $response = $this->apiPost('/ai/conversations', []);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  GET /ai/providers
    // ------------------------------------------------------------------

    public function test_get_providers_requires_auth(): void
    {
        $response = $this->apiGet('/ai/providers');

        $response->assertStatus(401);
    }

    public function test_get_providers_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/ai/providers');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /ai/limits
    // ------------------------------------------------------------------

    public function test_get_limits_requires_auth(): void
    {
        $response = $this->apiGet('/ai/limits');

        $response->assertStatus(401);
    }

    public function test_get_limits_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/ai/limits');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /ai/generate/listing
    // ------------------------------------------------------------------

    public function test_generate_listing_requires_auth(): void
    {
        $response = $this->apiPost('/ai/generate/listing', ['prompt' => 'dog walking']);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /ai/generate/bio
    // ------------------------------------------------------------------

    public function test_generate_bio_requires_auth(): void
    {
        $response = $this->apiPost('/ai/generate/bio', ['prompt' => 'community helper']);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /ai/test-provider
    // ------------------------------------------------------------------
    // Audit 2026-07-09 P2: this endpoint was member-reachable and unthrottled,
    // letting any member enumerate configured providers and burn the tenant's
    // AI API budget. It must be admin-only.

    public function test_test_provider_requires_auth(): void
    {
        $response = $this->apiPost('/ai/test-provider', ['provider' => 'gemini']);

        $response->assertStatus(401);
    }

    public function test_test_provider_rejects_regular_members(): void
    {
        $this->authenticatedUser(['role' => 'member']);

        $response = $this->apiPost('/ai/test-provider', ['provider' => 'gemini']);

        $response->assertStatus(403);
    }

    public function test_test_provider_allows_admins(): void
    {
        $this->authenticatedUser(['role' => 'admin']);

        // Exercise the role gate without contacting a real provider.
        $response = $this->apiPost('/ai/test-provider', ['provider' => '__unconfigured_test_provider__']);

        // Provider connectivity may legitimately fail in the test environment;
        // the point is the admin is not rejected by auth/role middleware.
        $response->assertStatus(200);
        $response->assertJsonPath('data.success', false);
    }
}
