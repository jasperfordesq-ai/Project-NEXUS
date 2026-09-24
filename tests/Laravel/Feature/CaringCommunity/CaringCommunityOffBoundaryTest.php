<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\CaringCommunity;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class CaringCommunityOffBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    private function setCaring(bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first(['features']);
        $features = json_decode($row->features ?? '{}', true, 512, JSON_THROW_ON_ERROR);
        $features['caring_community'] = $enabled;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features, JSON_THROW_ON_ERROR)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_valid_public_invite_stops_answering_when_module_is_switched_off(): void
    {
        $creator = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'OFFTEST123',
            'created_by_user_id' => $creator->id,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->setCaring(true);
        $this->apiGet('/v2/caring-community/invite/OFFTEST123')
            ->assertOk()->assertJsonPath('data.valid', true);

        $this->setCaring(false);
        $this->apiGet('/v2/caring-community/invite/OFFTEST123')
            ->assertForbidden()->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    public function test_disabled_module_blocks_member_and_admin_reads_and_writes_before_controller_work(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);
        $this->setCaring(false);

        foreach ([
            ['GET', '/api/v2/caring-community/my-relationships'],
            ['POST', '/api/v2/caring-community/request-help'],
            ['GET', '/api/v2/caring-community/surveys'],
        ] as [$method, $uri]) {
            $this->json($method, $uri, [], $this->withTenantHeader())->assertForbidden()
                ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
        }
    }

    public function test_disabled_module_blocks_an_admin_invite_write_without_creating_a_code(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true, 'role' => 'admin',
        ]);
        Sanctum::actingAs($admin, ['*']);
        $this->setCaring(false);
        $before = DB::table('caring_invite_codes')->where('tenant_id', $this->testTenantId)->count();

        $this->apiGet('/v2/admin/caring-community/invite-codes')
            ->assertForbidden()->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->apiPost('/v2/admin/caring-community/invite-codes', [
            'label' => 'Off switch test', 'expires_days' => 30,
        ])->assertForbidden()->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');

        $this->assertSame($before, DB::table('caring_invite_codes')
            ->where('tenant_id', $this->testTenantId)->count());
    }
}
