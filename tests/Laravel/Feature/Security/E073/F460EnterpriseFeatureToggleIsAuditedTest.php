<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E073;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PrerenderContentInvalidator;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-460 (E-073 I-3) — every feature toggle is audited on BOTH routes that write
 * `tenants.features`, not just the one E-072's F-408 fix reached.
 *
 * Two live routes change the same JSON:
 *
 *   PUT   /v2/admin/config/features              AdminConfigController::updateFeature
 *   PATCH /v2/admin/enterprise/config/features   AdminEnterpriseController::updateFeatureFlag
 *
 * F-408 (`3c8e1d0f6`) made the first one write an `org_audit_log` row for every
 * toggle, with a comment explaining why the write must not be conditional on
 * `biometric_login`. The second route kept the conditional form, so switching
 * `caring_community` off from the System Config page left no record of who did
 * it. F-432 — one administrator click hides every open safeguarding concern
 * from the staff responsible for it — states "the toggle is now audited" as its
 * mitigation; through this route it was not.
 *
 * This test asserts the CORRECT behaviour: the enterprise route writes exactly
 * the same audit row, with the same action name and the same shape, so the two
 * routes are indistinguishable in the log.
 *
 * Control: the maintained route still writes exactly one row and no more — a
 * fix that double-audited, or that broke the route F-408 fixed, would fail here.
 */
final class F460EnterpriseFeatureToggleIsAuditedTest extends TestCase
{
    use DatabaseTransactions;

    private int $adminId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(9401);
            $mock->shouldReceive('refreshAllOrFail')->andReturn(9402);
        });

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->adminId = (int) $admin->id;
        $this->withHeaders([
            'Authorization' => 'Bearer ' . app(TokenService::class)->generateToken(
                $admin->id,
                $admin->tenant_id,
                TwoFactorPolicy::claims('totp'),
            ),
        ]);

        // Start from the safeguarding module ON, so both arms make the same change.
        $this->setFeature('caring_community', true);
        DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('action', ['tenant_feature_disabled', 'tenant_feature_enabled'])
            ->delete();
    }

    // ------------------------------------------------------------------
    //  THE FIX — the enterprise route records who switched the module off.
    // ------------------------------------------------------------------

    public function test_the_enterprise_route_audits_switching_the_safeguarding_module_off(): void
    {
        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'caring_community',
            'value' => false,
            'type' => 'feature',
        ])->assertStatus(200);

        $this->assertFalse(
            $this->featureValue('caring_community'),
            'the module really was switched off by this route',
        );

        $this->assertSame(
            1,
            $this->auditRowCount(),
            'the safeguarding module was switched off and exactly one audit row records it',
        );

        $row = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'tenant_feature_disabled')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($row, 'the row uses the same action name as the other route');
        $this->assertSame(
            $this->adminId,
            (int) $row->user_id,
            'and it names the acting administrator',
        );

        $details = json_decode((string) $row->details, true);
        $this->assertSame('caring_community', $details['feature'] ?? null);
        $this->assertFalse($details['enabled'] ?? null);
        $this->assertSame($this->testTenantId, (int) ($details['tenant_id'] ?? 0));
    }

    public function test_the_enterprise_route_audits_switching_a_feature_back_on(): void
    {
        $this->setFeature('caring_community', false);

        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'caring_community',
            'value' => true,
            'type' => 'feature',
        ])->assertStatus(200);

        $this->assertTrue($this->featureValue('caring_community'));

        $row = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'tenant_feature_enabled')
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($row, 'switching a module back on is recorded too');
        $this->assertSame($this->adminId, (int) $row->user_id);
        $details = json_decode((string) $row->details, true);
        $this->assertSame('caring_community', $details['feature'] ?? null);
        $this->assertTrue($details['enabled'] ?? null);
    }

    // ------------------------------------------------------------------
    //  THE CONTROL — the maintained route is unchanged: still exactly one row.
    // ------------------------------------------------------------------

    public function test_control_the_maintained_route_still_writes_exactly_one_row(): void
    {
        $this->apiPut('/v2/admin/config/features', [
            'feature' => 'caring_community',
            'enabled' => false,
        ])->assertStatus(200);

        $this->assertFalse(
            $this->featureValue('caring_community'),
            'the module really was switched off by this route too',
        );

        $this->assertSame(
            1,
            $this->auditRowCount(),
            'CONTROL: F-408\'s audit row, exactly one, not duplicated',
        );

        $row = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'tenant_feature_disabled')
            ->orderByDesc('id')
            ->first();
        $this->assertSame($this->adminId, (int) $row->user_id, 'CONTROL: and it names the acting administrator');
        $details = json_decode((string) $row->details, true);
        $this->assertSame('caring_community', $details['feature'] ?? null);
    }

    // ------------------------------------------------------------------

    private function apiPatch(string $uri, array $data): \Illuminate\Testing\TestResponse
    {
        return $this->json('PATCH', '/api' . $uri, $data, [
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);
    }

    private function setFeature(string $key, bool $value): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $raw ? (json_decode((string) $raw, true) ?: []) : [];
        $features[$key] = $value;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
    }

    private function featureValue(string $key): bool
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $raw ? (json_decode((string) $raw, true) ?: []) : [];

        return (bool) ($features[$key] ?? false);
    }

    private function auditRowCount(): int
    {
        return DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('action', ['tenant_feature_disabled', 'tenant_feature_enabled'])
            ->count();
    }
}
