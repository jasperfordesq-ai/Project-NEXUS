<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E035;

use App\Models\User;
use App\Services\FederationPartnershipService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-154 — a tenant super-admin must not be able to force an ACTIVE federation
 * partnership the partner community never approved. Two guards, both tested:
 *   (a) the data import may only ever create a partnership as 'pending';
 *   (b) reactivatePartnership() refuses to activate a suspended row that has
 *       never been mutually active (NULL suspended_by_tenant_id + NULL approved_at).
 */
class FederationPartnershipConsentTest extends TestCase
{
    use DatabaseTransactions;

    private function seedPartnerTenant(): int
    {
        return (int) DB::table('tenants')->insertGetId([
            'name' => 'E035 Partner ' . substr(uniqid(), -6),
            'slug' => 'e035-partner-' . substr(uniqid(), -6),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function actAsSuperAdmin(): User
    {
        $actor = User::factory()->forTenant($this->testTenantId)->admin()->create(['is_tenant_super_admin' => 1]);
        Sanctum::actingAs($actor, ['*']);

        return $actor;
    }

    private function clearPair(int $partnerTenant): void
    {
        DB::table('federation_partnerships')->where(function ($q) use ($partnerTenant) {
            $q->where(['tenant_id' => $this->testTenantId, 'partner_tenant_id' => $partnerTenant])
              ->orWhere(fn ($q2) => $q2->where(['tenant_id' => $partnerTenant, 'partner_tenant_id' => $this->testTenantId]));
        })->delete();
    }

    public function test_import_forces_pending_status_even_when_file_says_suspended(): void
    {
        $partnerTenant = $this->seedPartnerTenant();
        $this->clearPair($partnerTenant);
        $this->actAsSuperAdmin();

        $json = json_encode(['partnerships' => [[
            'tenant_id' => $this->testTenantId, 'partner_tenant_id' => $partnerTenant, 'status' => 'suspended',
            'federation_level' => 4, 'profiles_enabled' => 1, 'messaging_enabled' => 1,
            'transactions_enabled' => 1, 'listings_enabled' => 1,
        ]]]);
        $file = UploadedFile::fake()->createWithContent('fed.json', $json);

        $resp = $this->post('/api/v2/admin/federation/data/import', ['file' => $file, 'dry_run' => 'false'], $this->withTenantHeader());
        $resp->assertStatus(200);

        $row = DB::table('federation_partnerships')
            ->where('tenant_id', $this->testTenantId)
            ->where('partner_tenant_id', $partnerTenant)
            ->first();

        $this->assertNotNull($row, 'import should have created the partnership row');
        $this->assertSame('pending', $row->status, 'imported partnership must start as pending, never suspended/active');
    }

    public function test_import_then_reactivate_cannot_force_active(): void
    {
        $partnerTenant = $this->seedPartnerTenant();
        $this->clearPair($partnerTenant);
        $this->actAsSuperAdmin();

        $json = json_encode(['partnerships' => [[
            'tenant_id' => $this->testTenantId, 'partner_tenant_id' => $partnerTenant, 'status' => 'suspended',
            'federation_level' => 4, 'profiles_enabled' => 1, 'messaging_enabled' => 1,
            'transactions_enabled' => 1, 'listings_enabled' => 1,
        ]]]);
        $file = UploadedFile::fake()->createWithContent('fed.json', $json);
        $this->post('/api/v2/admin/federation/data/import', ['file' => $file, 'dry_run' => 'false'], $this->withTenantHeader())
            ->assertStatus(200);

        $row = DB::table('federation_partnerships')
            ->where('tenant_id', $this->testTenantId)
            ->where('partner_tenant_id', $partnerTenant)
            ->first();
        $this->assertNotNull($row);

        $this->apiPost('/v2/admin/federation/partnerships/' . $row->id . '/reactivate');

        $after = DB::table('federation_partnerships')->where('id', $row->id)->value('status');
        $this->assertNotSame('active', $after, 'partnership must not become active without the partner community approving');
    }

    public function test_reactivate_refuses_never_active_suspended_row(): void
    {
        $partnerTenant = $this->seedPartnerTenant();
        $this->clearPair($partnerTenant);
        $this->actAsSuperAdmin();

        // A directly-seeded 'suspended' row with NO suspended_by_tenant_id and NO
        // approved_at — i.e. it was never mutually active. The legacy NULL-column
        // fallback must NOT apply here.
        $data = [
            'tenant_id' => $this->testTenantId,
            'partner_tenant_id' => $partnerTenant,
            'status' => 'suspended',
            'federation_level' => 4,
            'profiles_enabled' => 1,
            'messaging_enabled' => 1,
            'transactions_enabled' => 1,
            'listings_enabled' => 1,
            'suspended_by_tenant_id' => null,
            'approved_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ];
        if (\Illuminate\Support\Facades\Schema::hasColumn('federation_partnerships', 'canonical_pair')) {
            $data['canonical_pair'] = min($this->testTenantId, $partnerTenant) . '-' . max($this->testTenantId, $partnerTenant);
        }
        $id = (int) DB::table('federation_partnerships')->insertGetId($data);

        $result = FederationPartnershipService::reactivatePartnership($id, 1);

        $this->assertFalse($result['success'] ?? true, 'reactivating a never-active suspended row must be refused');
        $this->assertSame('suspended', DB::table('federation_partnerships')->where('id', $id)->value('status'));
    }
}
