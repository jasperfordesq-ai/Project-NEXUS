<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * PUT /v2/admin/volunteering/organizations/{id}/dlp
 *
 * Assigning an organisation's Designated Liaison Person used to answer every
 * refusal with the same "Unable to assign the DLP" message, so an admin who
 * picked an ordinary member had no way to learn that the person simply needed a
 * broker role first. Each refusal now names its own reason; the control in every
 * case is that the stored DLP is left exactly as it was.
 */
class VolunteerOrganizationDlpAssignmentTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        $features = TenantFeatureConfig::FEATURE_DEFAULTS;
        $features['volunteering'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    public function test_a_broker_can_be_assigned_as_the_organisation_dlp(): void
    {
        $admin = $this->actingAdmin();
        $orgId = $this->organization($admin);
        $broker = $this->account(['role' => 'broker']);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => $broker->id]);

        $response->assertStatus(200);
        $this->assertSame($broker->id, (int) DB::table('vol_organizations')->where('id', $orgId)->value('dlp_user_id'));
    }

    public function test_an_ordinary_member_is_refused_with_the_reason_and_nothing_changes(): void
    {
        $admin = $this->actingAdmin();
        $orgId = $this->organization($admin);
        $member = $this->account([]);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => $member->id]);

        $response->assertStatus(422);
        $this->assertSame(__('api.vol_dlp_user_not_staff'), $response->json('errors.0.message'));
        $this->assertNotSame(__('api.vol_dlp_assign_failed'), $response->json('errors.0.message'));
        $this->assertSame('dlp_user_id', $response->json('errors.0.field'));
        $this->assertNull(DB::table('vol_organizations')->where('id', $orgId)->value('dlp_user_id'));
    }

    public function test_a_suspended_broker_is_refused_as_not_active(): void
    {
        $admin = $this->actingAdmin();
        $orgId = $this->organization($admin);
        $broker = $this->account(['role' => 'broker', 'status' => 'suspended']);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => $broker->id]);

        $response->assertStatus(422);
        $this->assertSame(__('api.vol_dlp_user_inactive'), $response->json('errors.0.message'));
        $this->assertNull(DB::table('vol_organizations')->where('id', $orgId)->value('dlp_user_id'));
    }

    public function test_a_person_who_does_not_exist_in_this_community_is_refused(): void
    {
        $admin = $this->actingAdmin();
        $orgId = $this->organization($admin);

        $response = $this->apiPut("/v2/admin/volunteering/organizations/{$orgId}/dlp", ['dlp_user_id' => 999999999]);

        $response->assertStatus(422);
        $this->assertSame(__('api.vol_dlp_user_not_found'), $response->json('errors.0.message'));
    }

    public function test_an_organisation_that_does_not_exist_is_a_404(): void
    {
        $this->actingAdmin();
        $broker = $this->account(['role' => 'broker']);

        $response = $this->apiPut('/v2/admin/volunteering/organizations/999999999/dlp', ['dlp_user_id' => $broker->id]);

        $response->assertStatus(404);
        $this->assertSame(__('api.vol_dlp_organization_not_found'), $response->json('errors.0.message'));
    }

    public function test_every_refusal_has_its_own_wording(): void
    {
        $messages = [
            __('api.vol_dlp_organization_not_found'),
            __('api.vol_dlp_user_not_found'),
            __('api.vol_dlp_user_inactive'),
            __('api.vol_dlp_user_not_staff'),
            __('api.vol_dlp_assign_failed'),
        ];

        $this->assertCount(5, array_unique($messages));
        foreach ($messages as $message) {
            $this->assertStringNotContainsString('api.vol_dlp_', $message, 'a missing translation key leaked through');
        }
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function actingAdmin(): User
    {
        $admin = $this->account(['role' => 'admin', 'is_admin' => 1]);
        Sanctum::actingAs($admin, ['*']);

        return $admin;
    }

    private function organization(User $owner): int
    {
        return (int) DB::table('vol_organizations')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'name' => 'DLP assignment synthetic organisation',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $overrides */
    private function account(array $overrides): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => 1, 'role' => 'member',
        ]);
        DB::table('users')->where('id', $u->id)->update(array_merge([
            'role' => 'member',
            'is_admin' => 0,
            'is_super_admin' => 0,
            'is_tenant_super_admin' => 0,
            'is_god' => 0,
            'status' => 'active',
        ], $overrides));

        return User::withoutGlobalScopes()->find($u->id);
    }
}
