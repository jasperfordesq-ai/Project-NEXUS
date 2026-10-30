<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\AI\AIServiceFactory;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Regression (AWID pilot, Oct 2026): "This tenant is not connected to AI.
 * Please contact the administrator." was shown both when the community had
 * switched AI off AND when the platform itself has no AI key. In the second
 * case the community administrator can do nothing, so members were sent to
 * the wrong person.
 */
class UgcTranslationUnavailableWordingTest extends TestCase
{
    use DatabaseTransactions;

    private function translate()
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        return $this->apiPost('/v2/ugc-translate', [
            'content_type' => 'post',
            'content_id' => 1,
            'source_text' => 'Hola, ¿cómo estás?',
            'target_locale' => 'en',
        ]);
    }

    private function setAiEnabled(bool $enabled): void
    {
        DB::table('ai_settings')->updateOrInsert(
            ['tenant_id' => $this->testTenantId, 'setting_key' => 'ai_enabled'],
            ['setting_value' => $enabled ? '1' : '0'],
        );
        AIServiceFactory::clearCache();
    }

    public function test_platform_without_an_ai_key_does_not_send_members_to_their_community_admin(): void
    {
        config(['services.openai.api_key' => '']);
        $this->setAiEnabled(true);

        $response = $this->translate();

        $response->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'AI_UNAVAILABLE')
            ->assertJsonPath('errors.0.message', __('api.ai_translation_unavailable'));
        $this->assertStringNotContainsString('administrator', (string) $response->json('errors.0.message'));
    }

    public function test_community_that_switched_ai_off_keeps_the_ask_your_administrator_wording(): void
    {
        config(['services.openai.api_key' => 'synthetic-test-key']);
        $this->setAiEnabled(false);

        $this->translate()
            ->assertStatus(422)
            ->assertJsonPath('errors.0.code', 'AI_NOT_CONFIGURED')
            ->assertJsonPath('errors.0.message', __('api.ai_not_configured'));
    }
}
