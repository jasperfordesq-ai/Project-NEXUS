<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Security tests: safeguarding data must NEVER leak through public APIs.
 */
class SafeguardingSecurityTest extends TestCase
{
    use DatabaseTransactions;

    private function createUserWithSafeguardingPrefs(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'works_with_vulnerable_adults' => true,
            'safeguarding_notes' => 'SENSITIVE: This should never appear in public API',
        ]);

        // Create a safeguarding option and preference
        $optionId = DB::table('tenant_safeguarding_options')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'option_key' => 'test_vulnerable',
            'label' => 'Test vulnerable flag',
            'is_active' => 1,
            'triggers' => json_encode(['notify_admin_on_selection' => true]),
            'created_at' => now(),
        ]);

        DB::table('user_safeguarding_preferences')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => $user->id,
            'option_id' => $optionId,
            'selected_value' => '1',
            'consent_given_at' => now(),
            'created_at' => now(),
        ]);

        return $user;
    }

    public function test_public_profile_never_includes_safeguarding_notes(): void
    {
        $target = $this->createUserWithSafeguardingPrefs();
        $viewer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet("/v2/users/{$target->id}");

        // Whether 200 or other, the response body must never contain safeguarding data
        $body = $response->getContent();
        $this->assertStringNotContainsString('safeguarding_notes', $body);
        $this->assertStringNotContainsString('SENSITIVE', $body);
        $this->assertStringNotContainsString('works_with_vulnerable_adults', $body);
        $this->assertStringNotContainsString('works_with_children', $body);
        $this->assertStringNotContainsString('vetting_status', $body);
        $this->assertStringNotContainsString('safeguarding_reviewed_by', $body);
        $this->assertStringNotContainsString('user_safeguarding_preferences', $body);
        $this->assertStringNotContainsString('test_vulnerable', $body);
    }

    public function test_member_cannot_read_another_members_safeguarding_data(): void
    {
        $target = $this->createUserWithSafeguardingPrefs();
        $viewer = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        // Member trying to access admin safeguarding endpoints should be blocked
        $response = $this->apiGet("/v2/admin/safeguarding/member-preferences");
        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    /**
     * Administrators must hold a verified second factor (mandatory since the
     * E-004 baseline); a stateful session carries no MFA claims and is refused
     * with AUTH_MFA_REQUIRED. Mint the bearer a real administrator holds instead.
     *
     * @return array<string,string>
     */
    private function verifiedAdminBearer(User $admin): array
    {
        return ['Authorization' => 'Bearer ' . app(\App\Services\TokenService::class)->generateToken(
            $admin->id,
            $admin->tenant_id,
            \App\Services\TwoFactorPolicy::claims('totp')
        )];
    }

    public function test_admin_can_read_member_safeguarding_data(): void
    {
        $target = $this->createUserWithSafeguardingPrefs();
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $headers = $this->verifiedAdminBearer($admin);

        $response = $this->apiGet("/v2/admin/safeguarding/member-preferences", $headers);
        $this->assertEquals(200, $response->getStatusCode());
    }

    public function test_safeguarding_access_creates_audit_log(): void
    {
        $target = $this->createUserWithSafeguardingPrefs();
        $admin = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $headers = $this->verifiedAdminBearer($admin);

        // Clear existing logs
        DB::table('activity_log')
            ->where('action', 'safeguarding_preferences_list_viewed')
            ->delete();

        $this->apiGet("/v2/admin/safeguarding/member-preferences", $headers);

        // Verify audit log was created
        $log = DB::table('activity_log')
            ->where('action', 'safeguarding_preferences_list_viewed')
            ->where('user_id', $admin->id)
            ->first();
        $this->assertNotNull($log, 'Safeguarding access should be audit-logged');
    }

    public function test_member_cannot_manage_safeguarding_options(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($member, ['*']);

        $response = $this->apiPost('/v2/admin/safeguarding/options', [
            'option_key' => 'test',
            'label' => 'Test option',
        ]);
        $this->assertContains($response->getStatusCode(), [401, 403]);
    }

    public function test_safeguarding_data_excluded_from_member_search(): void
    {
        $target = $this->createUserWithSafeguardingPrefs();
        $viewer = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($viewer, ['*']);

        $response = $this->apiGet('/v2/members?search=' . urlencode($target->first_name ?? $target->name));

        // Whether 200 or other, search results must never contain safeguarding data
        $body = $response->getContent();
        $this->assertStringNotContainsString('safeguarding_notes', $body);
        $this->assertStringNotContainsString('works_with_vulnerable_adults', $body);
        $this->assertStringNotContainsString('user_safeguarding_preferences', $body);
    }
}
