<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E067;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringSupportRelationshipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-384 (E-067) — the third route by which a SUSPENDED volunteering organisation
 * minted time credits, beside F-343 (member verification race) and F-379 (the
 * admin approval page).
 *
 * POST /v2/admin/caring-community/support-relationships/{id}/hours approved the
 * log (the caller is a coordinator) and paid it through applyOrganizationPayment(),
 * which locked the organisation row without ever reading its status. So a
 * suspended organisation's wallet was debited and the supporter credited.
 *
 * Now hours cannot be logged against an organisation that is not approved: the
 * status is checked before the log and again under the organisation row lock
 * inside the transaction, and the refusal writes nothing.
 *
 * Adapted from `.local-docs-archive/security-log/E-067/repro/e/CaringSupportHoursMintTest.php`
 * (sequential case), which asserted the mint; the attack assertions are inverted.
 */
final class F384CaringSupportHoursSuspendedOrgTest extends TestCase
{
    use DatabaseTransactions;

    public function test_suspended_organisation_cannot_be_paid_through_caring_support_hours(): void
    {
        [$admin, $supporter, $org, $rel] = $this->scenario('suspended');

        $r = $this->logHours($rel, $admin);

        self::assertFalse($r['success'] ?? true, json_encode($r));
        self::assertSame('ORG_NOT_ACTIVE', $r['code'] ?? null);
        self::assertSame(0.0, $this->balance($supporter), 'no credits minted');
        self::assertSame(0.0, (float) DB::table('vol_organizations')->where('id', $org)->value('balance'), 'the organisation wallet is untouched');
        self::assertSame(0, DB::table('vol_logs')->where('caring_support_relationship_id', $rel)->count(), 'no hours are recorded');
    }

    public function test_the_admin_route_answers_with_the_organisation_not_active_message(): void
    {
        [$admin, , , $rel] = $this->scenario('suspended');
        $this->enableCaringCommunity();

        Sanctum::actingAs(User::find($admin), ['*']);
        $res = $this->postJson(
            "/api/v2/admin/caring-community/support-relationships/{$rel}/hours",
            ['date' => now()->subDay()->toDateString(), 'hours' => 3, 'description' => 'F384 visit'],
            ['X-Tenant-ID' => (string) $this->testTenantId]
        );

        $res->assertStatus(422);
        self::assertSame('ORG_NOT_ACTIVE', $res->json('errors.0.code') ?? $res->json('code') ?? $res->json('error.code'), $res->getContent());
        self::assertSame(0, DB::table('vol_logs')->where('caring_support_relationship_id', $rel)->count());
    }

    public function test_control_approved_organisation_mints_once(): void
    {
        [$admin, $supporter, , $rel] = $this->scenario('approved');

        $r = $this->logHours($rel, $admin);

        self::assertTrue($r['success'] ?? false, json_encode($r));
        self::assertSame('paid', $r['log']['payment_result']);
        self::assertSame(3.0, $this->balance($supporter));
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @return array{0:int,1:int,2:int,3:int} [admin, supporter, org, relationship] */
    private function scenario(string $orgStatus): array
    {
        $admin = $this->makeUser('admin');
        $owner = $this->makeUser();
        $supporter = $this->makeUser();
        $recipient = $this->makeUser();
        $org = (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $owner,
            'name' => 'F384 org ' . bin2hex(random_bytes(4)),
            'status' => $orgStatus,
            'balance' => 0.00,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $rel = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'supporter_id' => $supporter,
            'recipient_id' => $recipient,
            'organization_id' => $org,
            'title' => 'F384 weekly visit',
            'frequency' => 'weekly',
            'expected_hours' => 2.00,
            'start_date' => now()->subDays(30)->toDateString(),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$admin, $supporter, $org, $rel];
    }

    private function makeUser(string $role = 'member'): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'name' => 'F384 fixture',
            'first_name' => 'F384',
            'last_name' => 'Fixture',
            'email' => 'f384-' . bin2hex(random_bytes(10)) . '@example.test',
            'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
            'balance' => 0,
            'role' => $role,
            'status' => 'active',
            'is_active' => true,
            'is_approved' => true,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return array<string,mixed> */
    private function logHours(int $relId, int $adminId): array
    {
        TenantContext::setById($this->testTenantId);

        return app(CaringSupportRelationshipService::class)->logHours(
            $this->testTenantId,
            $relId,
            ['date' => now()->subDay()->toDateString(), 'hours' => 3.0, 'description' => 'F384 visit'],
            $adminId,
        );
    }

    private function balance(int $userId): float
    {
        return (float) DB::table('users')->where('id', $userId)->value('balance');
    }

    private function enableCaringCommunity(): void
    {
        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }
}
