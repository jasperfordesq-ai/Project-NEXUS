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

class RefreshTokenSessionErasureTest extends TestCase
{
    use DatabaseTransactions;

    public function test_erasure_deletes_only_the_users_tenant_bound_refresh_sessions(): void
    {
        $tenantId = $this->testTenantId;
        $otherTenantId = (int) DB::table('tenants')
            ->where('id', '!=', $tenantId)
            ->orderBy('id')
            ->value('id');
        if ($otherTenantId <= 0) {
            $otherTenantId = (int) DB::table('tenants')->insertGetId([
                'name' => 'Refresh erasure isolation tenant',
                'slug' => 'refresh-erasure-' . uniqid(),
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        TenantContext::setById($tenantId);
        $erasedUser = User::factory()->forTenant($tenantId)->create();
        $otherTenantUser = User::factory()->forTenant($otherTenantId)->create();
        TenantContext::setById($tenantId);

        $now = now();
        DB::table('refresh_token_sessions')->insert([
            [
                'tenant_id' => $tenantId,
                'user_id' => $erasedUser->id,
                'family_hash' => hash('sha256', 'erased-family-' . $erasedUser->id),
                'jti_hash' => hash('sha256', 'erased-jti-' . $erasedUser->id),
                'issued_at' => $now,
                'expires_at' => $now->copy()->addDay(),
                'family_expires_at' => $now->copy()->addDays(30),
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'tenant_id' => $otherTenantId,
                'user_id' => $otherTenantUser->id,
                'family_hash' => hash('sha256', 'other-family-' . $otherTenantUser->id),
                'jti_hash' => hash('sha256', 'other-jti-' . $otherTenantUser->id),
                'issued_at' => $now,
                'expires_at' => $now->copy()->addDay(),
                'family_expires_at' => $now->copy()->addDays(30),
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ]);

        try {
            $service = new class($tenantId) extends GdprService {
                public function generateDataExport(int $userId, int $requestId = null): string
                {
                    return '';
                }
            };
            $service->executeAccountDeletion($erasedUser->id);

            $this->assertDatabaseMissing('refresh_token_sessions', [
                'tenant_id' => $tenantId,
                'user_id' => $erasedUser->id,
            ]);
            $this->assertDatabaseHas('refresh_token_sessions', [
                'tenant_id' => $otherTenantId,
                'user_id' => $otherTenantUser->id,
            ]);
        } finally {
            foreach (glob(storage_path("exports/nexus_data_export_{$erasedUser->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }

    /**
     * F-622 (E-127, 13 Nov 2026). `refresh_session_activity` — one row per
     * sign-in: when it was made, when it was last used, and whether it came
     * from the phone app — was added on 30 Oct 2026 (E-119) and never named in
     * the erasure routine. Erasure keeps the account row in anonymised form, so
     * the table's ON DELETE CASCADE never fired and the erased member's sign-in
     * history stayed behind after their sessions were deleted.
     */
    public function test_erasure_deletes_only_the_users_tenant_bound_sign_in_activity(): void
    {
        $tenantId = $this->testTenantId;
        $otherTenantId = (int) DB::table('tenants')
            ->where('id', '!=', $tenantId)
            ->orderBy('id')
            ->value('id');
        $this->assertGreaterThan(0, $otherTenantId, 'A second tenant is needed to prove the delete stays in one community.');

        TenantContext::setById($tenantId);
        $erasedUser = User::factory()->forTenant($tenantId)->create();
        $otherMember = User::factory()->forTenant($tenantId)->create();
        $otherTenantUser = User::factory()->forTenant($otherTenantId)->create();
        TenantContext::setById($tenantId);

        $now = now();
        $activity = static fn (int $tenant, int $user, string $label, bool $phoneApp): array => [
            'family_hash' => hash('sha256', $label . '-' . $user),
            'tenant_id' => $tenant,
            'user_id' => $user,
            'last_activity_at' => $now,
            'from_phone_app' => $phoneApp,
            'created_at' => $now,
            'updated_at' => $now,
        ];
        DB::table('refresh_session_activity')->insert([
            $activity($tenantId, $erasedUser->id, 'erased-phone', true),
            $activity($tenantId, $erasedUser->id, 'erased-web', false),
            $activity($tenantId, $otherMember->id, 'same-community', true),
            $activity($otherTenantId, $otherTenantUser->id, 'other-community', true),
        ]);

        try {
            $service = new class($tenantId) extends GdprService {
                public function generateDataExport(int $userId, int $requestId = null): string
                {
                    return '';
                }
            };
            $service->executeAccountDeletion($erasedUser->id);

            $this->assertDatabaseMissing('refresh_session_activity', [
                'tenant_id' => $tenantId,
                'user_id' => $erasedUser->id,
            ]);
            $this->assertDatabaseHas('refresh_session_activity', [
                'tenant_id' => $tenantId,
                'user_id' => $otherMember->id,
            ]);
            $this->assertDatabaseHas('refresh_session_activity', [
                'tenant_id' => $otherTenantId,
                'user_id' => $otherTenantUser->id,
            ]);
        } finally {
            foreach (glob(storage_path("exports/nexus_data_export_{$erasedUser->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }
}
