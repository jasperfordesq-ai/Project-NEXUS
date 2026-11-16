<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Gdpr;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * `platform_notice_dismissals` records which admin closed which platform-wide
 * notice (Nov 2026). The table cascades from `users`, but erasure keeps the
 * account row in anonymised form, so the cascade never fires: the rows must
 * be named in the erasure routine, as F-622 showed for sign-in activity.
 */
class PlatformNoticeDismissalErasureTest extends TestCase
{
    use DatabaseTransactions;

    public function test_erasure_deletes_the_erased_accounts_closed_notices_and_nobody_elses(): void
    {
        $tenantId = $this->testTenantId;
        TenantContext::setById($tenantId);
        $erased = User::factory()->forTenant($tenantId)->create(['role' => 'admin']);
        $other = User::factory()->forTenant($tenantId)->create(['role' => 'admin']);

        $noticeId = (int) DB::table('platform_notices')->insertGetId([
            'message' => 'Erasure test notice',
            'kind' => 'info',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('platform_notice_dismissals')->insert([
            ['notice_id' => $noticeId, 'user_id' => $erased->id, 'dismissed_at' => now()],
            ['notice_id' => $noticeId, 'user_id' => $other->id, 'dismissed_at' => now()],
        ]);

        try {
            $service = new class($tenantId) extends GdprService {
                public function generateDataExport(int $userId, int $requestId = null): string
                {
                    return '';
                }
            };
            $service->executeAccountDeletion($erased->id);

            $this->assertDatabaseMissing('platform_notice_dismissals', ['user_id' => $erased->id]);
            $this->assertDatabaseHas('platform_notice_dismissals', ['notice_id' => $noticeId, 'user_id' => $other->id]);
            // The notice itself is the platform team's, not the admin's.
            $this->assertDatabaseHas('platform_notices', ['id' => $noticeId]);
        } finally {
            foreach (glob(storage_path("exports/nexus_data_export_{$erased->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }

    /**
     * The table has no tenant_id, so the erasure step takes the community
     * from the account itself. An erasure run for one community must not
     * delete the rows of an account that belongs to another.
     */
    public function test_an_erasure_run_for_one_community_leaves_another_communitys_account_alone(): void
    {
        $tenantId = $this->testTenantId;
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Notice erasure isolation community',
            'slug' => 'notice-erasure-' . uniqid(),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $otherCommunitysAdmin = User::factory()->forTenant($otherTenantId)->create(['role' => 'admin']);
        TenantContext::setById($tenantId);

        $noticeId = (int) DB::table('platform_notices')->insertGetId([
            'message' => 'Erasure isolation notice',
            'kind' => 'info',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('platform_notice_dismissals')->insert([
            'notice_id' => $noticeId, 'user_id' => $otherCommunitysAdmin->id, 'dismissed_at' => now(),
        ]);

        try {
            $service = new class($tenantId) extends GdprService {
                public function generateDataExport(int $userId, int $requestId = null): string
                {
                    return '';
                }
            };
            // The wrong community's service is handed the other community's account id.
            try {
                $service->executeAccountDeletion($otherCommunitysAdmin->id);
            } catch (\Throwable) {
                // Refusing outright is fine too; what matters is the row below.
            }

            $this->assertDatabaseHas('platform_notice_dismissals', [
                'notice_id' => $noticeId,
                'user_id' => $otherCommunitysAdmin->id,
            ]);
        } finally {
            foreach (glob(storage_path("exports/nexus_data_export_{$otherCommunitysAdmin->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }
}
