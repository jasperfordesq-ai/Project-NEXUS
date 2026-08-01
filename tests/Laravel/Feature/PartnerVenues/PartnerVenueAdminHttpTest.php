<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\PartnerVenues;

use App\Core\TenantContext;
use App\Models\PartnerVenue;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\PartnerVenueVisitService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * The admin HTTP surface of partner venues, exercised as real requests.
 *
 * The service-level suite (PartnerVenueVisitTest) proves the business rules;
 * this one proves the layer above it, which previously had almost no coverage:
 * the validation rules array, requireAdmin()'s 403 path, the CSV stream, and —
 * separately — the GDPR property that a member's pass, a standing BEARER
 * credential, does not survive account erasure.
 */
class PartnerVenueAdminHttpTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setPartnerVenuesFeature(true);
    }

    private function setPartnerVenuesFeature(bool $enabled): void
    {
        $row = DB::table('tenants')->where('id', $this->testTenantId)->first();
        $features = [];
        if ($row && ! empty($row->features)) {
            $decoded = is_string($row->features) ? json_decode($row->features, true) : $row->features;
            if (is_array($decoded)) {
                $features = $decoded;
            }
        }
        $features['partner_venues'] = $enabled;

        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
    }

    private function member(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function admin(): User
    {
        return $this->member(['role' => 'admin']);
    }

    private function venue(string $name = 'The Time Union Cafe', string $status = 'active'): PartnerVenue
    {
        $venue = new PartnerVenue([
            'name' => $name,
            'category' => 'cafe',
            'status' => $status,
        ]);
        $venue->tenant_id = $this->testTenantId;
        $venue->slug = str($name)->slug()->value() . '-' . uniqid();
        $venue->save();

        return $venue;
    }

    // ── Authorization ───────────────────────────────────────────────────

    public function test_every_admin_endpoint_rejects_a_plain_member(): void
    {
        $venue = $this->venue();
        $this->actingAs($this->member());

        $this->apiGet('/v2/admin/partner-venues')->assertStatus(403);
        $this->apiPost('/v2/admin/partner-venues', ['name' => 'X'])->assertStatus(403);
        $this->apiPut("/v2/admin/partner-venues/{$venue->id}", ['name' => 'Y'])->assertStatus(403);
        $this->apiPost("/v2/admin/partner-venues/{$venue->id}/archive")->assertStatus(403);
        $this->apiGet("/v2/admin/partner-venues/{$venue->id}/staff")->assertStatus(403);
        $this->apiGet('/v2/admin/partner-venues/reports/summary')->assertStatus(403);
        $this->apiGet('/v2/admin/partner-venues/visits/export.csv')->assertStatus(403);
    }

    // ── Venue CRUD over HTTP ────────────────────────────────────────────

    public function test_create_validates_and_persists_a_venue(): void
    {
        $this->actingAs($this->admin());

        // Category outside the whitelist fails the rules() array.
        $this->apiPost('/v2/admin/partner-venues', [
            'name' => 'Bad Category',
            'category' => 'nightclub',
        ])->assertStatus(422);

        // Bad website URL fails too.
        $this->apiPost('/v2/admin/partner-venues', [
            'name' => 'Bad URL',
            'website' => 'not-a-url',
        ])->assertStatus(422);

        $created = $this->apiPost('/v2/admin/partner-venues', [
            'name' => 'Food Union Cafe',
            'category' => 'cafe',
            'offer_summary' => '10% off for members',
            'city' => 'Coventry',
        ]);
        $created->assertStatus(201);

        $this->assertDatabaseHas('partner_venues', [
            'tenant_id' => $this->testTenantId,
            'name' => 'Food Union Cafe',
            'status' => 'active',
        ]);
    }

    public function test_update_and_archive_round_trip(): void
    {
        $this->actingAs($this->admin());
        $venue = $this->venue();

        $this->apiPut("/v2/admin/partner-venues/{$venue->id}", ['status' => 'paused'])
            ->assertStatus(200);
        $this->assertSame('paused', DB::table('partner_venues')->where('id', $venue->id)->value('status'));

        $this->apiPost("/v2/admin/partner-venues/{$venue->id}/archive")->assertStatus(200);
        $this->assertSame('archived', DB::table('partner_venues')->where('id', $venue->id)->value('status'));

        // Status filter on the list respects it.
        $archivedOnly = $this->apiGet('/v2/admin/partner-venues?status=archived');
        $archivedOnly->assertStatus(200);
        $ids = array_column($archivedOnly->json('data.venues'), 'id');
        $this->assertContains($venue->id, $ids);

        $activeOnly = $this->apiGet('/v2/admin/partner-venues?status=active');
        $this->assertNotContains($venue->id, array_column($activeOnly->json('data.venues'), 'id'));
    }

    public function test_cross_tenant_venues_are_invisible(): void
    {
        $this->actingAs($this->admin());

        // partner_venues has a real FK to tenants, so the foreign tenant must
        // actually exist (unlike older tables such as challenges).
        $otherTenantId = (int) DB::table('tenants')
            ->where('id', '!=', $this->testTenantId)
            ->orderBy('id')
            ->value('id');
        if ($otherTenantId <= 0) {
            $otherTenantId = (int) DB::table('tenants')->insertGetId([
                'name' => 'Venue isolation tenant',
                'slug' => 'venue-isolation-' . uniqid(),
                'is_active' => 1,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }

        $foreign = new PartnerVenue(['name' => 'Foreign', 'status' => 'active']);
        $foreign->tenant_id = $otherTenantId;
        $foreign->slug = 'foreign-' . uniqid();
        $foreign->save();

        $this->apiPut("/v2/admin/partner-venues/{$foreign->id}", ['name' => 'Hijacked'])
            ->assertStatus(404);
        $this->apiPost("/v2/admin/partner-venues/{$foreign->id}/archive")->assertStatus(404);
    }

    // ── Staff over HTTP ─────────────────────────────────────────────────

    public function test_staff_lifecycle_over_http(): void
    {
        $this->actingAs($this->admin());
        $venue = $this->venue();
        $staffUser = $this->member();

        // Unknown member 404s with a field pointer.
        $this->apiPost("/v2/admin/partner-venues/{$venue->id}/staff", [
            'user_id' => 999999999,
        ])->assertStatus(404);

        $added = $this->apiPost("/v2/admin/partner-venues/{$venue->id}/staff", [
            'user_id' => $staffUser->id,
            'role' => 'admin',
        ]);
        $added->assertStatus(200);
        $this->assertContains($staffUser->id, array_column($added->json('data.staff'), 'user_id'));

        $this->assertDatabaseHas('org_members', [
            'tenant_id' => $this->testTenantId,
            'org_type' => 'partner_venue',
            'organization_id' => $venue->id,
            'user_id' => $staffUser->id,
            'role' => 'admin',
        ]);

        $removed = $this->apiDelete("/v2/admin/partner-venues/{$venue->id}/staff/{$staffUser->id}");
        $removed->assertStatus(200);
        $this->assertNotContains($staffUser->id, array_column($removed->json('data.staff'), 'user_id'));
    }

    // ── Reporting over HTTP ─────────────────────────────────────────────

    public function test_summary_and_csv_reflect_recorded_visits(): void
    {
        $admin = $this->admin();
        $venue = $this->venue();
        $visitor = $this->member(['first_name' => 'Marie', 'last_name' => 'Curie']);

        $visits = $this->app->make(PartnerVenueVisitService::class);
        $pass = $visits->getOrCreatePass((int) $visitor->id);
        $result = $visits->recordVisit((string) $pass['token'], (int) $admin->id, (int) $venue->id);
        $this->assertSame('recorded', $result['status']);

        $this->actingAs($admin);

        $summary = $this->apiGet('/v2/admin/partner-venues/reports/summary');
        $summary->assertStatus(200);
        $this->assertSame(1, (int) $summary->json('data.total_visits'));
        $venueRow = collect($summary->json('data.venues'))->firstWhere('venue_id', $venue->id);
        $this->assertNotNull($venueRow);
        $this->assertSame(1, (int) $venueRow['total_visits']);
        $this->assertSame(1, (int) $venueRow['unique_members']);

        $csv = $this->apiGet('/v2/admin/partner-venues/visits/export.csv');
        $csv->assertStatus(200);
        $this->assertStringContainsString('text/csv', (string) $csv->headers->get('content-type'));
        $body = $csv->streamedContent();
        $this->assertStringContainsString('Marie Curie', $body);
        $this->assertStringContainsString($venue->name, $body);

        // Date-range filter excludes the visit when the window is elsewhere.
        $empty = $this->apiGet('/v2/admin/partner-venues/visits/export.csv?from=2020-01-01&to=2020-01-02');
        $this->assertStringNotContainsString('Marie Curie', $empty->streamedContent());
    }

    // ── GDPR: the pass must not survive erasure ─────────────────────────

    public function test_account_erasure_deletes_the_member_pass_but_keeps_visit_history(): void
    {
        $admin = $this->admin();
        $venue = $this->venue();
        $erased = $this->member();

        $visits = $this->app->make(PartnerVenueVisitService::class);
        $pass = $visits->getOrCreatePass((int) $erased->id);
        $visits->recordVisit((string) $pass['token'], (int) $admin->id, (int) $venue->id);

        $this->assertDatabaseHas('partner_member_passes', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $erased->id,
        ]);

        try {
            $service = new class($this->testTenantId) extends GdprService {
                public function generateDataExport(int $userId, int $requestId = null): string
                {
                    return '';
                }
            };
            $service->executeAccountDeletion($erased->id);

            // The standing bearer credential is gone — a screenshot of the QR
            // can no longer be scanned into a visit after erasure…
            $this->assertDatabaseMissing('partner_member_passes', [
                'tenant_id' => $this->testTenantId,
                'user_id' => $erased->id,
            ]);

            // …while the visit HISTORY row survives, PII resolving through the
            // anonymised users row (the messages posture).
            $this->assertDatabaseHas('partner_venue_visits', [
                'tenant_id' => $this->testTenantId,
                'user_id' => $erased->id,
                'venue_id' => $venue->id,
            ]);
        } finally {
            foreach (glob(storage_path("exports/nexus_data_export_{$erased->id}_*.zip")) ?: [] as $export) {
                @unlink($export);
            }
            TenantContext::reset();
        }
    }
}
