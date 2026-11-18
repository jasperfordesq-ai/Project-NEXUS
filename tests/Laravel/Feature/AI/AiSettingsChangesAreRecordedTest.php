<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\AI;

use App\Models\User;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-635 (security register E-131): PUT /v2/admin/config/ai wrote nothing to
 * any log, so a change of AI provider, a switch or an API key left no record
 * of who made it or when. The community Google Translate key, set from a
 * neighbouring page, is recorded with ActivityLog::log().
 */
final class AiSettingsChangesAreRecordedTest extends TestCase
{
    use DatabaseTransactions;

    private int $adminId;

    protected function setUp(): void
    {
        parent::setUp();
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->adminId = (int) $admin->id;
        $this->withHeaders(['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
            $admin->id,
            $admin->tenant_id,
            TwoFactorPolicy::claims('totp')
        )]);
    }

    public function test_changes_are_recorded_without_any_key(): void
    {
        $this->apiPut('/v2/admin/config/ai', [
            'ai_provider' => 'anthropic',
            'anthropic_api_key' => 'sk-ant-secret-fake-not-real',
            'ai_chat_enabled' => true,
        ])->assertOk();

        $details = $this->lastRecord();

        $this->assertNotNull($details, 'no record of the change');
        $this->assertStringContainsString('ai_provider', $details);
        $this->assertStringContainsString('anthropic_api_key (replaced)', $details);
        $this->assertStringNotContainsString('sk-ant-secret', $details);
    }

    public function test_a_removed_key_is_recorded_as_removed(): void
    {
        $this->apiPut('/v2/admin/config/ai', ['openai_api_key' => ''])->assertOk();

        $this->assertStringContainsString('openai_api_key (removed)', (string) $this->lastRecord());
    }

    private function lastRecord(): ?string
    {
        $details = DB::table('activity_log')
            ->where('user_id', $this->adminId)
            ->where('action', 'admin_ai_settings_updated')
            ->orderByDesc('id')
            ->value('details');

        return $details === null ? null : (string) $details;
    }
}
