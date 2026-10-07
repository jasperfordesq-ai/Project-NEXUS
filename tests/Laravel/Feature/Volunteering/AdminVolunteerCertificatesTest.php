<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Volunteering;

use App\Core\TenantContext;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Gap D8 (7 Oct 2026): community admins see the volunteer certificates issued in
 * their community and can revoke one issued in error. Until now nothing could
 * withdraw a certificate, though it is shown to employers.
 */
class AdminVolunteerCertificatesTest extends TestCase
{
    use DatabaseTransactions;

    private User $holder;
    private int $certificateId;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['volunteering' => true, 'organisations' => true]),
        ]);
        TenantContext::setById($this->testTenantId);

        $this->holder = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Ada',
            'last_name' => 'Lovelace',
            'name' => 'Ada Lovelace',
            'email' => 'ada-' . uniqid('', true) . '@example.test',
            'status' => 'active',
            'is_approved' => true,
            'preferred_language' => 'en',
        ]);
        $this->certificateId = (int) DB::table('vol_certificates')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->holder->id,
            'verification_code' => 'ADMIND8CODE00001',
            'total_hours' => 24.5,
            'date_range_start' => '2026-03-01',
            'date_range_end' => '2026-06-30',
            'organizations' => json_encode([['name' => 'Food Bank', 'hours' => 24.5]]),
            'generated_at' => now(),
        ]);
    }

    private function actAsAdmin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    public function test_admin_lists_and_searches_the_community_certificates(): void
    {
        $this->actAsAdmin();

        $response = $this->apiGet('/v2/admin/volunteering/certificates?q=lovelace')->assertOk();
        $item = collect($response->json('data.items'))->firstWhere('id', $this->certificateId);
        $this->assertNotNull($item);
        $this->assertSame('ADMIND8CODE00001', $item['verification_code']);
        $this->assertSame('Ada Lovelace', $item['volunteer']['name']);
        $this->assertNull($item['revoked_at']);
        $this->assertGreaterThanOrEqual(1, $response->json('data.counts.active'));

        $this->assertNull(collect($this->apiGet('/v2/admin/volunteering/certificates?q=nobody-by-this-name')->json('data.items'))
            ->firstWhere('id', $this->certificateId));
    }

    public function test_admin_view_does_not_mark_the_holders_copy_downloaded(): void
    {
        $this->actAsAdmin();

        $response = $this->apiGet("/v2/admin/volunteering/certificates/{$this->certificateId}/html")->assertOk();
        $this->assertStringContainsString('Ada Lovelace', $response->getContent());
        $this->assertNull(DB::table('vol_certificates')->where('id', $this->certificateId)->value('downloaded_at'));
    }

    public function test_revoking_withdraws_the_certificate_everywhere_and_tells_the_holder(): void
    {
        $admin = $this->actAsAdmin();

        $this->apiPost("/v2/admin/volunteering/certificates/{$this->certificateId}/revoke", ['reason' => ''])->assertStatus(422);
        $this->apiPost("/v2/admin/volunteering/certificates/{$this->certificateId}/revoke", ['reason' => 'Hours were logged in error'])->assertOk();

        $row = DB::table('vol_certificates')->where('id', $this->certificateId)->first();
        $this->assertNotNull($row->revoked_at);
        $this->assertSame((int) $admin->id, (int) $row->revoked_by);
        $this->assertSame('Hours were logged in error', $row->revoke_reason);
        $this->assertDatabaseHas('notifications', ['user_id' => $this->holder->id, 'type' => 'volunteer_certificate']);

        // Revoked: the public check fails exactly as for an unknown code, and the
        // holder can no longer print it; a second revoke is refused.
        $this->apiPost('/v2/volunteering/certificates/check', ['code' => 'ADMIND8CODE00001', 'name' => 'Ada Lovelace'])
            ->assertOk()->assertJsonPath('data.valid', false);
        $this->apiPost("/v2/admin/volunteering/certificates/{$this->certificateId}/revoke", ['reason' => 'again'])->assertStatus(404);
        $revokedList = $this->apiGet('/v2/admin/volunteering/certificates?status=revoked')->json('data');
        $this->assertGreaterThanOrEqual(1, $revokedList['counts']['revoked']);
        $this->assertNotNull(collect($revokedList['items'])->firstWhere('id', $this->certificateId));

        Sanctum::actingAs($this->holder);
        $this->apiGet('/v2/volunteering/certificates/ADMIND8CODE00001/html')->assertStatus(404);
        $mine = collect($this->apiGet('/v2/volunteering/certificates')->json('data.items'))->firstWhere('id', $this->certificateId);
        $this->assertNotNull($mine['revoked_at'] ?? null);

        // The holder's own data export says the certificate was revoked and why
        // (a reason recorded about them is their personal data).
        $export = new \App\Services\Enterprise\GdprService($this->testTenantId);
        $method = (new \ReflectionClass($export))->getMethod('exportVolunteerData');
        $method->setAccessible(true);
        $exported = collect($method->invoke($export, $this->holder->id)['certificates'])
            ->map(fn ($row) => (array) $row)->firstWhere('id', $this->certificateId);
        $this->assertNotNull($exported['revoked_at']);
        $this->assertSame('Hours were logged in error', $exported['revoke_reason']);
    }

    public function test_members_cannot_use_the_admin_certificate_endpoints(): void
    {
        Sanctum::actingAs($this->holder);

        $this->apiGet('/v2/admin/volunteering/certificates')->assertStatus(403);
        $this->apiPost("/v2/admin/volunteering/certificates/{$this->certificateId}/revoke", ['reason' => 'x'])->assertStatus(403);
        $this->assertNull(DB::table('vol_certificates')->where('id', $this->certificateId)->value('revoked_at'));
    }
}
