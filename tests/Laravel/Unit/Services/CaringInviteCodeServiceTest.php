<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringInviteCodeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class CaringInviteCodeServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::setById($this->testTenantId);
    }

    private function service(): CaringInviteCodeService
    {
        return app(CaringInviteCodeService::class);
    }

    public function test_generate_persists_code_and_returns_invite_url(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();

        $result = $this->service()->generate($this->testTenantId, $coordinator->id, 'Pilot batch', 14);

        $this->assertTrue($result['success']);
        $this->assertArrayHasKey('code', $result);
        $code = $result['code'];

        $this->assertSame(6, strlen($code['code']));
        $this->assertMatchesRegularExpression('/^[A-Z0-9]{6}$/', $code['code']);
        $this->assertSame('Pilot batch', $code['label']);
        $this->assertStringContainsString('/join/' . $code['code'], $code['invite_url']);

        $row = DB::table('caring_invite_codes')->where('id', $code['id'])->first();
        $this->assertNotNull($row);
        $this->assertEquals($this->testTenantId, $row->tenant_id);
        $this->assertEquals($coordinator->id, $row->created_by_user_id);
        $this->assertEquals('Pilot batch', $row->label);
        $this->assertNull($row->used_at);
    }

    public function test_generate_uses_only_unambiguous_charset(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();

        for ($i = 0; $i < 5; $i++) {
            $result = $this->service()->generate($this->testTenantId, $coordinator->id, null, 7);
            $code = $result['code']['code'];

            // Charset omits 0/O and 1/I to avoid ambiguity
            $this->assertDoesNotMatchRegularExpression('/[01OI]/', $code, "Code {$code} contains ambiguous chars");
        }
    }

    public function test_lookup_returns_invalid_envelope_for_unknown_code_without_404(): void
    {
        $result = $this->service()->lookup($this->testTenantId, 'NOPE12');

        $this->assertFalse($result['valid']);
        $this->assertFalse($result['expired']);
        $this->assertFalse($result['already_used']);
        $this->assertArrayHasKey('tenant_name', $result);
        $this->assertArrayHasKey('caring_community_enabled', $result);
    }

    public function test_lookup_returns_invalid_envelope_for_empty_code(): void
    {
        $result = $this->service()->lookup($this->testTenantId, '');
        $this->assertFalse($result['valid']);
    }

    public function test_lookup_marks_expired_codes(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'EXPIR1',
            'label' => null,
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->subDay(),
            'created_at' => now()->subDays(10),
            'updated_at' => now()->subDays(10),
        ]);

        $result = $this->service()->lookup($this->testTenantId, 'EXPIR1');

        $this->assertFalse($result['valid']);
        $this->assertTrue($result['expired']);
        $this->assertFalse($result['already_used']);
    }

    public function test_lookup_marks_already_used_codes(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();
        $consumer = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'USED12',
            'label' => null,
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->addDays(7),
            'used_at' => now(),
            'used_by_user_id' => $consumer->id,
            'created_at' => now()->subDay(),
            'updated_at' => now(),
        ]);

        $result = $this->service()->lookup($this->testTenantId, 'USED12');

        $this->assertFalse($result['valid']);
        $this->assertTrue($result['already_used']);
        // already_used takes precedence over expired in the envelope
        $this->assertFalse($result['expired']);
    }

    public function test_lookup_returns_valid_for_active_code(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'GOOD12',
            'label' => null,
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = $this->service()->lookup($this->testTenantId, 'GOOD12');

        $this->assertTrue($result['valid']);
        $this->assertFalse($result['expired']);
        $this->assertFalse($result['already_used']);
    }

    public function test_lookup_does_not_leak_codes_across_tenants(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'TENA01',
            'label' => null,
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->addDays(7),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $result = $this->service()->lookup(999, 'TENA01');

        $this->assertFalse($result['valid']);
        $this->assertFalse($result['already_used']);
    }

    public function test_list_returns_status_active_expired_used_in_recent_first_order(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'ACT001',
            'label' => 'active',
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->addDays(7),
            'used_at' => null,
            'used_by_user_id' => null,
            'created_at' => now()->subMinute(),
            'updated_at' => now()->subMinute(),
        ]);
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'EXP001',
            'label' => 'expired',
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->subDay(),
            'used_at' => null,
            'used_by_user_id' => null,
            'created_at' => now()->subMinutes(2),
            'updated_at' => now()->subMinutes(2),
        ]);
        DB::table('caring_invite_codes')->insert([
            'tenant_id' => $this->testTenantId,
            'code' => 'USE001',
            'label' => 'used',
            'created_by_user_id' => $coordinator->id,
            'expires_at' => now()->addDays(7),
            'used_at' => now(),
            'used_by_user_id' => $coordinator->id,
            'created_at' => now()->subMinutes(3),
            'updated_at' => now()->subMinutes(3),
        ]);

        $list = $this->service()->list($this->testTenantId);
        $byCode = [];
        foreach ($list as $item) {
            $byCode[$item['code']] = $item;
        }

        $this->assertSame('active', $byCode['ACT001']['status']);
        $this->assertSame('expired', $byCode['EXP001']['status']);
        $this->assertSame('used', $byCode['USE001']['status']);

        // Recent-first ordering — ACT001 was created last, so it should be first.
        $codes = array_column($list, 'code');
        $actIdx = array_search('ACT001', $codes, true);
        $expIdx = array_search('EXP001', $codes, true);
        $useIdx = array_search('USE001', $codes, true);
        $this->assertLessThan($expIdx, $actIdx);
        $this->assertLessThan($useIdx, $expIdx);
    }

    public function test_list_excludes_codes_from_other_tenants(): void
    {
        $coordinator = User::factory()->forTenant($this->testTenantId)->create();

        DB::table('caring_invite_codes')->insert([
            [
                'tenant_id' => $this->testTenantId,
                'code' => 'MINE01',
                'created_by_user_id' => $coordinator->id,
                'expires_at' => now()->addDays(7),
                'created_at' => now(),
                'updated_at' => now(),
            ],
            [
                'tenant_id' => 999,
                'code' => 'OTHE01',
                'created_by_user_id' => $coordinator->id,
                'expires_at' => now()->addDays(7),
                'created_at' => now(),
                'updated_at' => now(),
            ],
        ]);

        $codes = array_column($this->service()->list($this->testTenantId), 'code');

        $this->assertContains('MINE01', $codes);
        $this->assertNotContains('OTHE01', $codes);
    }
}
