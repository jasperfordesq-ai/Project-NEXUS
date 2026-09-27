<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\TokenService;
use App\Services\Enterprise\GdprService;
use App\Events\GdprActionOccurred;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Laravel\Sanctum\Sanctum;
use Illuminate\Support\Facades\Hash;
use Tests\Laravel\TestCase;

/** F-216: member GDPR writes must use the tenant resolved for this request. */
class GdprTenantBindingTest extends TestCase
{
    use DatabaseTransactions;

    private function enterRequestBoundary(): void
    {
        TenantContext::reset();
        unset($_SERVER['HTTP_X_TENANT_ID'], $_SERVER['HTTP_X_TENANT_SLUG']);
    }

    public function test_data_request_uses_authenticated_community(): void
    {
        Event::fake([GdprActionOccurred::class]);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        // Mimic an HTTP entry point before the tenant middleware resolves it.
        $this->enterRequestBoundary();

        $response = $this->apiPost('/gdpr/request', ['type' => 'data_export']);
        $response->assertCreated();
        $row = DB::table('gdpr_requests')->where('user_id', $user->id)
            ->where('request_type', 'portability')->orderByDesc('id')->first();
        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
    }

    public function test_consent_write_uses_authenticated_community(): void
    {
        Event::fake([GdprActionOccurred::class]);
        DB::table('consent_types')->updateOrInsert(
            ['slug' => 'marketing'],
            [
                'name' => 'Marketing', 'description' => 'Test consent',
                'category' => 'marketing', 'is_required' => 0,
                'current_version' => '1.0', 'current_text' => 'I agree.',
                'legal_basis' => 'consent', 'is_active' => 1,
                'display_order' => 1, 'created_at' => now(), 'updated_at' => now(),
            ],
        );
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        $this->enterRequestBoundary();

        $this->apiPost('/gdpr/consent', ['consent_type' => 'marketing', 'granted' => true])->assertOk();
        $row = DB::table('user_consents')->where('user_id', $user->id)
            ->where('consent_type', 'marketing')->orderByDesc('id')->first();
        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
    }

    public function test_erasure_request_uses_authenticated_community(): void
    {
        Event::fake([GdprActionOccurred::class]);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'password_hash' => Hash::make('CorrectPassword123!'),
            'status' => 'active', 'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        app(TokenService::class)->generateRefreshToken((int) $user->id, $this->testTenantId);
        $this->enterRequestBoundary();

        $this->apiPost('/gdpr/delete-account', ['password' => 'CorrectPassword123!'])->assertOk();
        $row = DB::table('gdpr_requests')->where('user_id', $user->id)
            ->where('request_type', 'erasure')->orderByDesc('id')->first();
        $this->assertNotNull($row);
        $this->assertSame($this->testTenantId, (int) $row->tenant_id);
    }

    public function test_admin_reads_the_members_actual_community_consents(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $member = User::factory()->forTenant($this->testTenantId)->create();
        (new GdprService($this->testTenantId))->recordConsent(
            (int) $member->id, 'marketing', true, 'I agree.', '1.0',
        );
        Sanctum::actingAs($admin, ['*']);
        $this->enterRequestBoundary();

        $response = $this->apiGet("/v2/admin/users/{$member->id}/consents");
        $response->assertOk();
        $types = array_column($response->json('data') ?? [], 'consent_type');
        $this->assertContains('marketing', $types);
    }

    public function test_admin_created_member_consents_use_the_admin_community(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin, ['*']);
        $this->enterRequestBoundary();
        $email = 'e040-created-' . uniqid() . '@example.test';

        $response = $this->apiPost('/v2/admin/users', [
            'first_name' => 'Synthetic',
            'last_name' => 'Member',
            'email' => $email,
            'password' => 'CorrectPassword123!',
            'role' => 'member',
        ]);
        $this->assertContains($response->getStatusCode(), [200, 201]);
        $userId = (int) DB::table('users')->where('email', $email)->value('id');
        $this->assertGreaterThan(0, $userId);
        $consents = DB::table('user_consents')->where('user_id', $userId)
            ->whereIn('consent_type', ['terms_of_service', 'privacy_policy'])
            ->get(['consent_type', 'tenant_id']);
        $this->assertCount(2, $consents);
        foreach ($consents as $consent) {
            $this->assertSame($this->testTenantId, (int) $consent->tenant_id);
        }
    }

    public function test_admin_cannot_read_another_community_members_consents(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $other = User::factory()->forTenant(999)->create();
        (new GdprService(999))->recordConsent(
            (int) $other->id, 'marketing', true, 'I agree.', '1.0',
        );
        Sanctum::actingAs($admin, ['*']);
        $this->enterRequestBoundary();

        $this->apiGet("/v2/admin/users/{$other->id}/consents")->assertNotFound();
    }
}
