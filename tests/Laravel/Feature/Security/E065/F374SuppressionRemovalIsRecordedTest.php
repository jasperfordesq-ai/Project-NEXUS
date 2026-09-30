<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-374 — removing an email suppression must be recorded, and must be a
 * deliberate act when the suppression is the record of a member's objection.
 *
 * Before the fix, AdminEmailDeliverabilityController::removeSuppression
 * hard-deleted the row, returned the suppressed address to the caller, wrote no
 * audit row of any kind, and never looked at WHY the address was suppressed.
 * F-274's fix deliberately keeps email_suppression on account erasure —
 * GdprService.php:1526 says in terms that it is "deliberately NOT deleted
 * (F-274)" because it is what stops delivery — so this endpoint could undo a
 * known fix with nothing recording who allowed it.
 *
 * The endpoint's legitimate purpose IS removing suppressions ("the member tells
 * us they fixed their inbox"), so the fix does not make it impossible: it makes
 * it recorded, and deliberate for the objection reasons.
 */
class F374SuppressionRemovalIsRecordedTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $this->app['auth']->forgetGuards();
        foreach (['HTTP_X_TENANT_ID', 'HTTP_X_TENANT_SLUG', 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION'] as $serverKey) {
            unset($_SERVER[$serverKey]);
        }
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_removing_a_technical_suppression_still_works_and_is_recorded(): void
    {
        $admin = $this->platformSuperAdmin();
        $suppressionId = $this->suppression('bounce');

        Sanctum::actingAs($admin, ['*']);
        $this->deleteJson('/api/v2/admin/email-deliverability/suppressions/' . $suppressionId)
            ->assertStatus(200);

        $this->assertDatabaseMissing('email_suppression', ['id' => $suppressionId]);

        $row = DB::table('activity_log')
            ->where('action', 'email_suppression_removed')
            ->where('entity_type', 'email_suppression')
            ->where('entity_id', $suppressionId)
            ->first();

        $this->assertNotNull($row, 'F-374: removing a suppression must be recorded');
        $this->assertSame(
            (int) $admin->id,
            (int) $row->user_id,
            'F-374: the record must name the admin who removed it'
        );
    }

    public function test_removing_a_member_objection_suppression_is_refused_without_an_explicit_override(): void
    {
        $admin = $this->platformSuperAdmin();
        $unsubscribeId = $this->suppression('unsubscribe');
        $complaintId = $this->suppression('spam_report');

        Sanctum::actingAs($admin, ['*']);
        $this->deleteJson('/api/v2/admin/email-deliverability/suppressions/' . $unsubscribeId)
            ->assertStatus(409);
        $this->deleteJson('/api/v2/admin/email-deliverability/suppressions/' . $complaintId)
            ->assertStatus(409);

        $this->assertDatabaseHas('email_suppression', ['id' => $unsubscribeId]);
        $this->assertDatabaseHas('email_suppression', ['id' => $complaintId]);
    }

    public function test_the_explicit_override_is_accepted_and_recorded_as_an_override(): void
    {
        $admin = $this->platformSuperAdmin();
        $suppressionId = $this->suppression('unsubscribe');

        Sanctum::actingAs($admin, ['*']);
        $this->deleteJson('/api/v2/admin/email-deliverability/suppressions/' . $suppressionId, [
            'acknowledge_objection' => true,
            'reason' => 'Member asked us in writing to re-subscribe them.',
        ])->assertStatus(200);

        $this->assertDatabaseMissing('email_suppression', ['id' => $suppressionId]);

        $row = DB::table('activity_log')
            ->where('action', 'email_suppression_removed')
            ->where('entity_id', $suppressionId)
            ->first();

        $this->assertNotNull($row, 'F-374: the override must be recorded too');
        $details = json_decode((string) $row->details, true);
        $this->assertTrue(
            (bool) ($details['objection_override'] ?? false),
            'F-374: the record must say the objection was deliberately overridden'
        );
        $this->assertSame('unsubscribe', $details['reason_code'] ?? null);
    }

    public function test_control_an_ordinary_community_admin_cannot_remove_a_suppression(): void
    {
        $tenantAdmin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);
        $suppressionId = $this->suppression('bounce');

        Sanctum::actingAs($tenantAdmin, ['*']);
        $this->deleteJson('/api/v2/admin/email-deliverability/suppressions/' . $suppressionId)
            ->assertStatus(403);

        $this->assertDatabaseHas('email_suppression', ['id' => $suppressionId]);
        $this->assertSame(
            0,
            (int) DB::table('activity_log')
                ->where('action', 'email_suppression_removed')
                ->where('entity_id', $suppressionId)
                ->count(),
            'CONTROL: a refused removal writes no removal record'
        );
    }

    // ---------------------------------------------------------------- helpers

    private function suppression(string $reason): int
    {
        return (int) DB::table('email_suppression')->insertGetId([
            'email' => 'e066e-f374-' . bin2hex(random_bytes(5)) . '@example.test',
            'reason' => $reason,
            'detail' => 'E065 F-374 synthetic suppression',
            'suppressed_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function platformSuperAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'admin',
        ]);

        DB::table('users')->where('id', $admin->id)->update(['is_super_admin' => 1]);

        return User::find($admin->id);
    }
}
