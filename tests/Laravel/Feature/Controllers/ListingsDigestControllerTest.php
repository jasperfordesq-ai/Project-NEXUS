<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Jobs\SendListingsDigestNow;
use App\Models\User;
use App\Services\ListingsDigestService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * The offers & requests round-up endpoints (ListingsDigestController).
 */
class ListingsDigestControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenant_settings')->where('tenant_id', $this->testTenantId)
            ->where('setting_key', ListingsDigestService::SETTING_KEY)->delete();
        app(\App\Services\TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function signIn(bool $admin = false): User
    {
        $factory = User::factory()->forTenant($this->testTenantId);
        if ($admin) {
            $factory = $factory->admin();
        }
        $user = $factory->create(['status' => 'active', 'is_approved' => true]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_member_settings_require_sign_in(): void
    {
        $this->apiGet('/v2/users/me/listings-digest')->assertStatus(401);
        $this->apiPut('/v2/users/me/listings-digest', ['frequency' => 'weekly'])->assertStatus(401);
    }

    public function test_member_reads_and_changes_their_own_frequency(): void
    {
        $user = $this->signIn();

        $this->apiGet('/v2/users/me/listings-digest')
            ->assertOk()
            ->assertJsonPath('data.frequency', 'default')
            ->assertJsonPath('data.community_default', 'monthly')
            ->assertJsonPath('data.effective', 'monthly');

        $this->apiPut('/v2/users/me/listings-digest', ['frequency' => 'weekly'])
            ->assertOk()
            ->assertJsonPath('data.effective', 'weekly');

        $prefs = json_decode((string) DB::table('users')->where('id', $user->id)->value('notification_preferences'), true);
        $this->assertSame('weekly', $prefs[ListingsDigestService::PREF_FREQUENCY]);
    }

    public function test_member_cannot_save_an_unknown_frequency(): void
    {
        $this->signIn();
        $this->apiPut('/v2/users/me/listings-digest', ['frequency' => 'hourly'])->assertStatus(422);
    }

    public function test_admin_endpoints_refuse_ordinary_members(): void
    {
        $this->signIn();
        $this->apiGet('/v2/admin/listings-digest')->assertStatus(403);
        $this->apiPut('/v2/admin/listings-digest', ['default_frequency' => 'weekly'])->assertStatus(403);
        $this->apiGet('/v2/admin/listings-digest/preview')->assertStatus(403);
        $this->apiPost('/v2/admin/listings-digest/send', ['confirm' => true])->assertStatus(403);
    }

    public function test_admin_changes_the_community_default(): void
    {
        $this->signIn(admin: true);

        $this->apiPut('/v2/admin/listings-digest', ['default_frequency' => 'weekly'])
            ->assertOk()
            ->assertJsonPath('data.default_frequency', 'weekly');
        $this->apiGet('/v2/admin/listings-digest')->assertOk()->assertJsonPath('data.default_frequency', 'weekly');

        $this->apiPut('/v2/admin/listings-digest', ['default_frequency' => 'daily'])->assertStatus(422);
    }

    public function test_admin_preview_returns_the_email(): void
    {
        $this->signIn(admin: true);

        $response = $this->apiGet('/v2/admin/listings-digest/preview?mode=all')->assertOk();
        $this->assertStringContainsString('<!DOCTYPE html>', (string) $response->json('data.html'));
    }

    public function test_admin_send_must_be_confirmed_and_then_runs_in_the_background(): void
    {
        Bus::fake([SendListingsDigestNow::class]);
        $admin = $this->signIn(admin: true);

        $this->apiPost('/v2/admin/listings-digest/send', [])->assertStatus(422);
        Bus::assertNotDispatched(SendListingsDigestNow::class);

        $this->apiPost('/v2/admin/listings-digest/send', ['confirm' => true])
            ->assertOk()
            ->assertJsonPath('data.queued', true);
        Bus::assertDispatched(SendListingsDigestNow::class, fn (SendListingsDigestNow $job): bool =>
            $job->tenantId === $this->testTenantId && $job->adminUserId === (int) $admin->id && $job->afterUserId === 0);
    }
}
