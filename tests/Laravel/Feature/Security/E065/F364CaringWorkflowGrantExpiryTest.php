<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Services\CaringSupportRelationshipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-364 (E-065) — `CaringSupportRelationshipService` ignored role-grant expiry
 * where its twin `VolunteerService::hasCaringWorkflowPermission()` honours it
 * (`VolunteerService.php:3261`).
 *
 * With the community's "auto-approve trusted reviewers" setting on, an EXPIRED
 * `volunteering.hours.review` grant still auto-approved caring-support hour
 * logs, which leads to `applyOrganizationPayment()` and a credit movement.
 *
 * E-065 recorded this as suspected and did not reproduce it: the route carries
 * `EnsureIsAdmin`, so every HTTP caller already satisfies the admin branch
 * above the permission check. The service is therefore driven directly.
 */
final class F364CaringWorkflowGrantExpiryTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT = 2;

    private int $coordinatorId = 0;
    private int $supporterId = 0;
    private int $recipientId = 0;
    private int $relationshipId = 0;
    private int $roleId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        // No schema guard here on purpose. Every table and column this test
        // touches is in the committed schema dump, so a guard could never fire
        // in CI and would only hide a broken fixture locally — which is what the
        // pre-commit schema-skip budget exists to prevent.

        TenantContext::setById(self::TENANT);

        $this->coordinatorId = $this->makeMember('f364.coordinator');
        $this->supporterId = $this->makeMember('f364.supporter');
        $this->recipientId = $this->makeMember('f364.recipient');

        $this->setPolicy('approval_required', '1');
        $this->setPolicy('auto_approve_trusted_reviewers', '1');

        DB::table('permissions')->insertOrIgnore([
            'name' => 'volunteering.hours.review',
            'display_name' => 'Review Volunteer Hours',
            'category' => 'volunteering',
        ]);
        $permissionId = (int) DB::table('permissions')->where('name', 'volunteering.hours.review')->value('id');

        $this->roleId = (int) DB::table('roles')->insertGetId([
            'name' => 'f364_reviewer_' . bin2hex(random_bytes(4)),
            'display_name' => 'F364 trusted reviewer',
            'level' => 10,
            'is_system' => 0,
            'tenant_id' => self::TENANT,
        ]);
        DB::table('role_permissions')->insert([
            'role_id' => $this->roleId,
            'permission_id' => $permissionId,
            'tenant_id' => self::TENANT,
        ]);

        $this->relationshipId = (int) DB::table('caring_support_relationships')->insertGetId([
            'tenant_id' => self::TENANT,
            'supporter_id' => $this->supporterId,
            'recipient_id' => $this->recipientId,
            'coordinator_id' => $this->coordinatorId,
            'organization_id' => null,
            'category_id' => null,
            'title' => 'F364 relationship',
            'frequency' => 'weekly',
            'expected_hours' => 1,
            'start_date' => date('Y-m-d', strtotime('-30 days')),
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * An expired trusted-reviewer grant must not auto-approve a caring-support
     * hour log.
     */
    public function test_expired_grant_does_not_auto_approve_caring_hours(): void
    {
        $this->grant(expiresAt: now()->subDay());

        $status = $this->logHours();

        $this->assertSame(
            'pending',
            $status,
            'BAD OUTCOME: a grant that expired yesterday still auto-approved a caring-support '
            . 'hour log, which mints credits.'
        );
    }

    /**
     * CONTROL — an unexpired grant still auto-approves, so the case above does
     * not pass because the feature broke.
     */
    public function test_control_unexpired_grant_still_auto_approves(): void
    {
        $this->grant(expiresAt: now()->addYear());

        $this->assertSame('approved', $this->logHours());
    }

    /**
     * CONTROL — a coordinator with no grant at all never auto-approves.
     */
    public function test_control_no_grant_does_not_auto_approve(): void
    {
        $this->assertSame('pending', $this->logHours());
    }

    // ── fixtures ───────────────────────────────────────────────────────────

    private function logHours(): string
    {
        $result = app(CaringSupportRelationshipService::class)->logHours(
            self::TENANT,
            $this->relationshipId,
            ['date' => date('Y-m-d'), 'hours' => 1.0, 'description' => 'F364 hours'],
            $this->coordinatorId
        );

        $this->assertTrue((bool) ($result['success'] ?? false), json_encode($result));

        return (string) DB::table('vol_logs')
            ->where('id', (int) $result['log']['id'])
            ->value('status');
    }

    private function grant(?\DateTimeInterface $expiresAt): void
    {
        DB::table('user_roles')->insert([
            'user_id' => $this->coordinatorId,
            'role_id' => $this->roleId,
            'tenant_id' => self::TENANT,
            'assigned_by' => null,
            'expires_at' => $expiresAt,
        ]);
    }

    private function setPolicy(string $key, string $value): void
    {
        DB::table('tenant_settings')->updateOrInsert(
            ['tenant_id' => self::TENANT, 'setting_key' => 'caring_community.workflow.' . $key],
            [
                'setting_value' => $value,
                'setting_type' => 'boolean',
                'category' => 'caring_community',
                'updated_at' => now(),
            ]
        );
    }

    private function makeMember(string $prefix): int
    {
        $email = $prefix . '.' . bin2hex(random_bytes(5)) . '@example.test';

        return (int) DB::table('users')->insertGetId([
            'tenant_id' => self::TENANT,
            'name' => 'F364 Member',
            'first_name' => 'F364',
            'last_name' => 'Member',
            'email' => $email,
            'username' => 'f364_' . substr(md5($email), 0, 10),
            'password' => password_hash('password', PASSWORD_BCRYPT),
            'role' => 'member',
            'status' => 'active',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
