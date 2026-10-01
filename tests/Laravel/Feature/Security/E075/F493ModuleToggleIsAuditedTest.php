<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E075;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\PrerenderContentInvalidator;
use App\Services\TokenService;
use App\Services\TwoFactorPolicy;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * E-075 F-493 — switching a MODULE off is recorded, on both routes that can do
 * it, exactly as switching a FEATURE off already is.
 *
 * Two live routes write `tenants.configuration['modules']`:
 *
 *   PUT   /v2/admin/config/modules               AdminConfigController::updateModule
 *   PATCH /v2/admin/enterprise/config/features   AdminEnterpriseController::updateFeatureFlag
 *                                                (with `type: 'module'`)
 *
 * F-408 (`3c8e1d0f6`) and F-460 (`c056dfb6a`) made every FEATURE toggle write an
 * `org_audit_log` row on both of their routes. Neither touched the modules half:
 * `updateModule()` had no audit call at all, and the enterprise handler guarded
 * its F-460 write with `if ($type === 'feature')`, so the `type=module` arm of
 * the very same request handler was silent.
 *
 * The eight modules include `messages`, `wallet` and `listings`. Switching one
 * off removes that capability from every member of a community, and the platform
 * held no record of who did it or when. It also bears on F-432, whose stated
 * mitigation is that the toggle is audited.
 *
 * These tests assert the CORRECT behaviour and therefore fail before the fix.
 * Controls on BOTH arms: the already-audited FEATURE toggle on each of the same
 * two routes still writes exactly one row naming the acting administrator — so a
 * fix that double-audited, or that disturbed the feature half, would fail here.
 */
final class F493ModuleToggleIsAuditedTest extends TestCase
{
    use DatabaseTransactions;

    private const MODULE_ACTIONS = ['tenant_module_enabled', 'tenant_module_disabled'];
    private const FEATURE_ACTIONS = ['tenant_feature_enabled', 'tenant_feature_disabled'];

    private int $adminId = 0;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);

        $this->mock(PrerenderContentInvalidator::class, function ($mock): void {
            $mock->shouldReceive('refreshTenantOrFail')->andReturn(9621);
            $mock->shouldReceive('refreshAllOrFail')->andReturn(9622);
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

        $this->setModule('messages', true);
        $this->setFeature('caring_community', true);

        DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('action', array_merge(self::MODULE_ACTIONS, self::FEATURE_ACTIONS))
            ->delete();
    }

    // ------------------------------------------------------------------
    //  ARM 1 — PUT /v2/admin/config/modules
    // ------------------------------------------------------------------

    public function test_the_config_route_audits_switching_messaging_off(): void
    {
        $this->apiPut('/v2/admin/config/modules', [
            'module' => 'messages',
            'enabled' => false,
        ])->assertStatus(200);

        $this->assertFalse(
            $this->moduleValue('messages'),
            'messaging really was switched off by this route',
        );

        $this->assertSame(
            1,
            $this->auditRowCount(self::MODULE_ACTIONS),
            'messaging was removed from every member of the community and exactly one '
            . 'audit row must record it (F-493).',
        );

        $row = $this->latestRow('tenant_module_disabled');
        $this->assertNotNull($row, 'the row must name the action that happened');
        $this->assertSame($this->adminId, (int) $row->user_id, 'and it must name the acting administrator');

        $details = json_decode((string) $row->details, true);
        $this->assertSame('messages', $details['module'] ?? null);
        $this->assertFalse($details['enabled'] ?? null);
        $this->assertSame($this->testTenantId, (int) ($details['tenant_id'] ?? 0));
    }

    public function test_the_config_route_audits_switching_messaging_back_on(): void
    {
        $this->setModule('messages', false);

        $this->apiPut('/v2/admin/config/modules', [
            'module' => 'messages',
            'enabled' => true,
        ])->assertStatus(200);

        $this->assertTrue($this->moduleValue('messages'));

        $row = $this->latestRow('tenant_module_enabled');
        $this->assertNotNull($row, 'switching a module back on is recorded too');
        $this->assertSame($this->adminId, (int) $row->user_id);
        $details = json_decode((string) $row->details, true);
        $this->assertSame('messages', $details['module'] ?? null);
        $this->assertTrue($details['enabled'] ?? null);
    }

    // ------------------------------------------------------------------
    //  ARM 2 — PATCH /v2/admin/enterprise/config/features, type=module
    // ------------------------------------------------------------------

    public function test_the_enterprise_route_audits_switching_messaging_off(): void
    {
        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'messages',
            'value' => false,
            'type' => 'module',
        ])->assertStatus(200);

        $this->assertFalse(
            $this->moduleValue('messages'),
            'messaging really was switched off by this route too',
        );

        $this->assertSame(
            1,
            $this->auditRowCount(self::MODULE_ACTIONS),
            'the enterprise route must write the same single audit row (F-493).',
        );

        $row = $this->latestRow('tenant_module_disabled');
        $this->assertNotNull($row, 'the two routes must be indistinguishable in the log');
        $this->assertSame($this->adminId, (int) $row->user_id);
        $details = json_decode((string) $row->details, true);
        $this->assertSame('messages', $details['module'] ?? null);
        $this->assertFalse($details['enabled'] ?? null);
    }

    // ------------------------------------------------------------------
    //  CONTROLS — the FEATURE half of both routes is unchanged.
    // ------------------------------------------------------------------

    public function test_control_the_config_route_feature_toggle_still_writes_exactly_one_row(): void
    {
        $this->apiPut('/v2/admin/config/features', [
            'feature' => 'caring_community',
            'enabled' => false,
        ])->assertStatus(200);

        $this->assertSame(
            1,
            $this->auditRowCount(self::FEATURE_ACTIONS),
            'CONTROL: F-408\'s audit row, exactly one, not duplicated',
        );
        $this->assertSame(
            0,
            $this->auditRowCount(self::MODULE_ACTIONS),
            'CONTROL: a feature toggle must not be recorded as a module toggle',
        );

        $row = $this->latestRow('tenant_feature_disabled');
        $this->assertSame($this->adminId, (int) $row->user_id, 'CONTROL: and it names the acting administrator');
    }

    public function test_control_the_enterprise_route_feature_toggle_still_writes_exactly_one_row(): void
    {
        $this->apiPatch('/v2/admin/enterprise/config/features', [
            'key' => 'caring_community',
            'value' => false,
            'type' => 'feature',
        ])->assertStatus(200);

        $this->assertSame(
            1,
            $this->auditRowCount(self::FEATURE_ACTIONS),
            'CONTROL: F-460\'s audit row, exactly one, not duplicated',
        );
        $this->assertSame(
            0,
            $this->auditRowCount(self::MODULE_ACTIONS),
            'CONTROL: a feature toggle must not be recorded as a module toggle',
        );

        $row = $this->latestRow('tenant_feature_disabled');
        $this->assertSame($this->adminId, (int) $row->user_id, 'CONTROL: and it names the acting administrator');
    }

    // ------------------------------------------------------------------

    /** @param array<string,mixed> $data */
    private function apiPatch(string $uri, array $data): \Illuminate\Testing\TestResponse
    {
        return $this->json('PATCH', '/api' . $uri, $data, [
            'X-Tenant-ID' => (string) $this->testTenantId,
        ]);
    }

    private function setModule(string $key, bool $value): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = $raw ? (json_decode((string) $raw, true) ?: []) : [];
        $modules = $configuration['modules'] ?? [];
        $modules[$key] = $value;
        $configuration['modules'] = $modules;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['configuration' => json_encode($configuration)]);
    }

    private function moduleValue(string $key): bool
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = $raw ? (json_decode((string) $raw, true) ?: []) : [];

        return (bool) ($configuration['modules'][$key] ?? false);
    }

    private function setFeature(string $key, bool $value): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = $raw ? (json_decode((string) $raw, true) ?: []) : [];
        $features[$key] = $value;
        DB::table('tenants')->where('id', $this->testTenantId)
            ->update(['features' => json_encode($features)]);
    }

    /** @param list<string> $actions */
    private function auditRowCount(array $actions): int
    {
        return DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->whereIn('action', $actions)
            ->count();
    }

    private function latestRow(string $action): ?object
    {
        return DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', $action)
            ->orderByDesc('id')
            ->first();
    }
}
