<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Jobs\SendPasswordResetEmail;
use App\Models\User;
use App\Services\TenantSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-126 — Verein (club) member import must not be more powerful than a club
 * administrator: it honours the community's admin-approval rule, never returns
 * passwords or user ids, only ever grants the plain `member` club role, and
 * never silently enrols (or re-activates) existing community members.
 */
class CaringVereinImportTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        $tenant = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($tenant && ! empty($tenant->features)) {
            $decoded = is_string($tenant->features) ? json_decode($tenant->features, true) : $tenant->features;
            $features = is_array($decoded) ? $decoded : [];
        }
        $features['caring_community'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function setAdminApproval(bool $required): void
    {
        foreach (['admin_approval', 'general.admin_approval'] as $key) {
            DB::table('tenant_settings')->updateOrInsert(
                ['tenant_id' => $this->testTenantId, 'setting_key' => $key],
                ['setting_value' => $required ? '1' : '0', 'updated_at' => now()]
            );
        }
        app(TenantSettingsService::class)->clearCacheForTenant($this->testTenantId);
    }

    private function verein(int $ownerId): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'name' => 'Security Verein ' . uniqid(),
            'slug' => 'security-verein-' . uniqid(),
            'description' => 'Club used by the F-126 regression test.',
            'contact_email' => 'verein-' . uniqid() . '@example.test',
            'status' => 'approved',
            'org_type' => 'club',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public function test_import_honours_admin_approval_forces_member_role_and_returns_no_passwords(): void
    {
        $this->setAdminApproval(true);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $vereinId = $this->verein($admin->id);
        Sanctum::actingAs($admin);

        $email = 'imported-' . uniqid() . '@example.test';
        $csv = "email,first_name,last_name,role\n{$email},Ida,Import,owner\n";

        $response = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import", ['csv' => $csv]);
        $response->assertStatus(201);
        $response->assertJsonPath('data.created', 1);

        // No temporary password and no user ids in the response.
        $body = (string) $response->getContent();
        $this->assertStringNotContainsString('temporary_password', $body);
        foreach ((array) $response->json('data.members') as $member) {
            $this->assertArrayNotHasKey('user_id', $member);
            $this->assertArrayNotHasKey('temporary_password', $member);
        }

        $user = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($user, 'Control: the new account is still created.');
        // Admin approval is required in this community: not auto-approved.
        $this->assertSame(0, (int) $user->is_approved);
        $this->assertNotSame('active', $user->status);

        // CSV "owner" is ignored: the club role is always member.
        $this->assertDatabaseHas('org_members', [
            'organization_id' => $vereinId,
            'user_id' => $user->id,
            'role' => 'member',
        ]);

        // The member sets their own password through the queued reset email.
        Queue::assertPushed(SendPasswordResetEmail::class, fn (SendPasswordResetEmail $job): bool => $job->email === $email);
    }

    public function test_import_without_approval_rule_creates_active_account_control(): void
    {
        $this->setAdminApproval(false);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $vereinId = $this->verein($admin->id);
        Sanctum::actingAs($admin);

        $email = 'open-' . uniqid() . '@example.test';
        $response = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import", [
            'csv' => "email,first_name,last_name\n{$email},Otto,Open\n",
        ]);
        $response->assertStatus(201);

        $user = DB::table('users')->where('tenant_id', $this->testTenantId)->where('email', $email)->first();
        $this->assertNotNull($user);
        $this->assertSame(1, (int) $user->is_approved);
        $this->assertSame('active', $user->status);
        $this->assertDatabaseHas('org_members', ['organization_id' => $vereinId, 'user_id' => $user->id, 'status' => 'active']);
        Queue::assertPushed(SendPasswordResetEmail::class);
    }

    public function test_existing_members_are_not_silently_enrolled_or_reactivated(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $vereinId = $this->verein($admin->id);
        $existing = User::factory()->forTenant($this->testTenantId)->create(['email' => 'existing-' . uniqid() . '@example.test']);
        $leaver = User::factory()->forTenant($this->testTenantId)->create(['email' => 'leaver-' . uniqid() . '@example.test']);
        DB::table('org_members')->insert([
            'tenant_id' => $this->testTenantId,
            'organization_id' => $vereinId,
            'org_type' => 'volunteer',
            'user_id' => $leaver->id,
            'role' => 'member',
            'status' => 'removed',
            'created_at' => now(),
        ]);
        Sanctum::actingAs($admin);

        $csv = "email,first_name,last_name,role\n{$existing->email},Ex,Isting,admin\n{$leaver->email},Lea,Ver,member\n";

        // Preview: existing accounts are flagged, but no user id is disclosed.
        $preview = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import/preview", ['csv' => $csv]);
        $preview->assertStatus(200);
        foreach ((array) $preview->json('data.items') as $item) {
            $this->assertArrayNotHasKey('existing_user_id', $item);
            $this->assertSame('existing_account', $item['action']);
        }

        $import = $this->apiPost("/v2/admin/caring-community/vereine/{$vereinId}/members/import", ['csv' => $csv]);
        $import->assertStatus(201);
        $import->assertJsonPath('data.created', 0);
        $import->assertJsonPath('data.linked', 0);
        $import->assertJsonPath('data.existing_accounts', 2);

        $this->assertDatabaseMissing('org_members', ['organization_id' => $vereinId, 'user_id' => $existing->id]);
        $this->assertDatabaseHas('org_members', ['organization_id' => $vereinId, 'user_id' => $leaver->id, 'status' => 'removed']);
        Queue::assertNotPushed(SendPasswordResetEmail::class);
    }
}
