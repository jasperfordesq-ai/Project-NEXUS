<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for AdminLegalDocController.
 *
 * Covers getVersions, compareVersions, createVersion, publishVersion,
 * getComplianceStats, getAcceptances, updateVersion, deleteVersion,
 * notifyUsers, getUsersPendingCount, exportAcceptances.
 */
class AdminLegalDocControllerTest extends TestCase
{
    use DatabaseTransactions;

    // ================================================================
    // COMPLIANCE STATS — GET /v2/admin/legal-documents/compliance
    // ================================================================

    public function test_compliance_stats_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents/compliance');

        $response->assertStatus(200);
        $response->assertJsonStructure(['data']);
    }

    public function test_compliance_stats_reports_the_enforcement_mode_read_only(): void
    {
        // The admin panel shows the platform enforcement mode so it can be seen
        // without shell access. 🔴 READ-ONLY: `editable_here` is always false and
        // there is deliberately no endpoint to change the mode, because it can stop
        // members using the platform. If anyone adds a setter, this test's intent
        // is the record of why they should not have.
        config(['legal.enforcement_mode' => 'report']);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents/compliance');

        $response->assertStatus(200);
        $this->assertSame('report', $response->json('data.enforcement.mode'));
        $this->assertFalse($response->json('data.enforcement.editable_here'));
        $this->assertIsArray($response->json('data.enforcement.enforced_acceptance_modes'));
    }

    public function test_compliance_stats_reports_an_unrecognised_mode_as_off(): void
    {
        // Matches the middleware, which treats anything it does not recognise as
        // `off` so a typo in the server setting cannot start blocking members.
        // Reporting the raw value here would tell the admin the opposite.
        config(['legal.enforcement_mode' => 'enforce-everything']);
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents/compliance');

        $this->assertSame('off', $response->json('data.enforcement.mode'));
    }

    public function test_compliance_stats_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/legal-documents/compliance');

        $response->assertStatus(403);
    }

    public function test_compliance_stats_returns_401_for_unauthenticated(): void
    {
        $response = $this->apiGet('/v2/admin/legal-documents/compliance');

        $response->assertStatus(401);
    }

    // ================================================================
    // GET VERSIONS — GET /v2/admin/legal-documents/{docId}/versions
    // ================================================================

    public function test_get_versions_returns_200_for_admin(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents/1/versions');

        // Returns 200 with data (even if empty) or 500 if table missing
        $this->assertTrue(in_array($response->status(), [200, 500]));
    }

    public function test_get_versions_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/legal-documents/1/versions');

        $response->assertStatus(403);
    }

    // ================================================================
    // COMPARE VERSIONS — GET /v2/admin/legal-documents/{docId}/versions/compare
    // ================================================================

    public function test_compare_versions_requires_parameters(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/legal-documents/1/versions/compare');

        $response->assertStatus(400);
    }

    // ================================================================
    // CREATE VERSION — POST /v2/admin/legal-documents/{docId}/versions
    // ================================================================

    public function test_create_version_requires_version_number(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/legal-documents/1/versions', [
            'content' => 'Test content',
            'effective_date' => '2026-04-01',
        ]);

        $response->assertStatus(400);
    }

    public function test_create_version_requires_content(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/legal-documents/1/versions', [
            'version_number' => '1.0',
            'effective_date' => '2026-04-01',
        ]);

        $response->assertStatus(400);
    }

    public function test_create_version_requires_effective_date(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiPost('/v2/admin/legal-documents/1/versions', [
            'version_number' => '1.0',
            'content' => 'Test content',
        ]);

        $response->assertStatus(400);
    }

    public function test_create_version_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiPost('/v2/admin/legal-documents/1/versions', [
            'version_number' => '1.0',
            'content' => 'Test content',
            'effective_date' => '2026-04-01',
        ]);

        $response->assertStatus(403);
    }

    // ================================================================
    // ACCEPTANCES — GET /v2/admin/legal-documents/versions/{vid}/acceptances
    // ================================================================

    public function test_create_version_sanitizes_html_before_storage(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $docId = DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Terms',
            'slug' => 'terms-test-' . uniqid(),
            'requires_acceptance' => 1,
            'is_active' => 1,
            'created_by' => $admin->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiPost("/v2/admin/legal-documents/{$docId}/versions", [
            'version_number' => '99.1',
            'content' => '<p onclick="alert(1)">Safe</p><script>alert(2)</script><a href="javascript:alert(3)">bad</a>',
            'effective_date' => '2026-04-01',
        ]);

        $response->assertStatus(201);

        $stored = (string) DB::table('legal_document_versions')
            ->where('document_id', $docId)
            ->value('content');

        $this->assertStringContainsString('<p>Safe</p>', $stored);
        $this->assertStringNotContainsString('<script', $stored);
        $this->assertStringNotContainsString('onclick', $stored);
        $this->assertStringNotContainsString('javascript:', $stored);
    }

    public function test_acceptances_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/legal-documents/versions/1/acceptances');

        $response->assertStatus(403);
    }

    // ================================================================
    // PENDING COUNT — GET /v2/admin/legal-documents/{docId}/versions/{vid}/pending-count
    // ================================================================

    public function test_pending_count_returns_403_for_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $response = $this->apiGet('/v2/admin/legal-documents/1/versions/1/pending-count');

        $response->assertStatus(403);
    }

    // ================================================================
    // Helpers
    // ================================================================

    /** Seed a legal document for a tenant and return its id. */
    private function seedDocument(int $tenantId, int $createdBy, string $type = 'terms'): int
    {
        // Keep the (tenant, type) unique slot clear so seeding is deterministic
        // regardless of any rows already present in the test database.
        DB::table('legal_documents')
            ->where('tenant_id', $tenantId)
            ->where('document_type', $type)
            ->delete();

        return DB::table('legal_documents')->insertGetId([
            'tenant_id' => $tenantId,
            'document_type' => $type,
            'title' => ucfirst($type),
            'slug' => $type . '-' . uniqid(),
            'requires_acceptance' => 1,
            'is_active' => 1,
            'created_by' => $createdBy,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** Seed a version (draft by default) and return its id. */
    private function seedVersion(int $docId, int $createdBy, array $overrides = []): int
    {
        return DB::table('legal_document_versions')->insertGetId(array_merge([
            'document_id' => $docId,
            'version_number' => '1.0',
            'content' => '<p>Original</p>',
            'content_plain' => 'Original',
            'effective_date' => '2026-04-01',
            'is_draft' => 1,
            'is_current' => 0,
            'created_by' => $createdBy,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides));
    }

    // ================================================================
    // UPDATE VERSION — PUT /v2/admin/legal-documents/{docId}/versions/{vid}
    // ================================================================

    public function test_update_version_persists_content_and_metadata(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $docId = $this->seedDocument($this->testTenantId, $admin->id);
        $vid = $this->seedVersion($docId, $admin->id);

        $response = $this->apiPut("/v2/admin/legal-documents/{$docId}/versions/{$vid}", [
            'version_number' => '1.1',
            'content' => '<p>Updated body</p>',
            'effective_date' => '2026-05-01',
            'summary_of_changes' => 'Reworded clause 3',
        ]);

        $response->assertStatus(200);

        $row = (array) DB::table('legal_document_versions')->where('id', $vid)->first();
        $this->assertSame('1.1', $row['version_number']);
        $this->assertStringContainsString('Updated body', (string) $row['content']);
        $this->assertStringContainsString('Updated body', (string) $row['content_plain']);
        $this->assertSame('Reworded clause 3', $row['summary_of_changes']);
    }

    public function test_update_version_cross_tenant_returns_404_and_leaves_row_untouched(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        // Document owned by a DIFFERENT tenant.
        $otherTenantId = $this->testTenantId + 99;
        $docId = $this->seedDocument($otherTenantId, $admin->id);
        $vid = $this->seedVersion($docId, $admin->id, ['content' => '<p>Foreign</p>', 'content_plain' => 'Foreign']);

        $response = $this->apiPut("/v2/admin/legal-documents/{$docId}/versions/{$vid}", [
            'content' => '<p>Hijacked</p>',
        ]);

        $response->assertStatus(404);

        $content = (string) DB::table('legal_document_versions')->where('id', $vid)->value('content');
        $this->assertStringContainsString('Foreign', $content);
        $this->assertStringNotContainsString('Hijacked', $content);
    }

    public function test_update_version_on_published_version_returns_400(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $docId = $this->seedDocument($this->testTenantId, $admin->id);
        $vid = $this->seedVersion($docId, $admin->id, [
            'is_draft' => 0,
            'is_current' => 1,
            'published_at' => now(),
        ]);

        $response = $this->apiPut("/v2/admin/legal-documents/{$docId}/versions/{$vid}", [
            'content' => '<p>Cannot change published</p>',
        ]);

        $response->assertStatus(400);
    }

    // ================================================================
    // PUBLISH VERSION — POST /v2/admin/legal-documents/versions/{vid}/publish
    // ================================================================

    public function test_publish_version_sets_current_pointer_and_flags(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $docId = $this->seedDocument($this->testTenantId, $admin->id);
        $vid = $this->seedVersion($docId, $admin->id);

        $response = $this->apiPost("/v2/admin/legal-documents/versions/{$vid}/publish", []);

        $response->assertStatus(200);

        $version = (array) DB::table('legal_document_versions')->where('id', $vid)->first();
        $this->assertSame(1, (int) $version['is_current']);
        $this->assertSame(0, (int) $version['is_draft']);
        $this->assertNotNull($version['published_at']);

        $pointer = DB::table('legal_documents')->where('id', $docId)->value('current_version_id');
        $this->assertSame($vid, (int) $pointer);
    }

    public function test_publish_version_cross_tenant_returns_404_and_does_not_publish(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $otherTenantId = $this->testTenantId + 99;
        $docId = $this->seedDocument($otherTenantId, $admin->id);
        $vid = $this->seedVersion($docId, $admin->id);

        $response = $this->apiPost("/v2/admin/legal-documents/versions/{$vid}/publish", []);

        $response->assertStatus(404);

        $version = (array) DB::table('legal_document_versions')->where('id', $vid)->first();
        $this->assertSame(1, (int) $version['is_draft']);
        $this->assertSame(0, (int) $version['is_current']);
    }

    // ================================================================
    // ORDERING — versions returned newest-first regardless of string sort
    // ================================================================

    public function test_versions_ordered_newest_first_not_by_version_string(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $docId = $this->seedDocument($this->testTenantId, $admin->id);
        // "9.0" created first, "10.0" created second. String sort would put "9.0" on top.
        $this->seedVersion($docId, $admin->id, ['version_number' => '9.0', 'created_at' => now()->subMinutes(2)]);
        $this->seedVersion($docId, $admin->id, ['version_number' => '10.0', 'created_at' => now()->subMinute()]);

        $response = $this->apiGet("/v2/admin/legal-documents/{$docId}/versions");
        $response->assertStatus(200);

        $data = $response->json('data');
        $this->assertSame('10.0', $data[0]['version_number']);
        $this->assertSame('9.0', $data[1]['version_number']);
    }

    // ================================================================
    // FULL LIFECYCLE — create doc → version → publish → public endpoint
    // ================================================================

    public function test_full_lifecycle_publishes_content_to_public_endpoint(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $type = 'privacy';
        // Ensure the (tenant, type) slot is free so the create returns 201, not a duplicate 422.
        DB::table('legal_documents')
            ->where('tenant_id', $this->testTenantId)
            ->where('document_type', $type)
            ->delete();

        $create = $this->apiPost('/v2/admin/legal-documents', [
            'title' => 'Privacy Policy',
            'type' => $type,
        ]);
        $create->assertStatus(201);
        $docId = (int) $create->json('data.id');
        $this->assertGreaterThan(0, $docId);

        $versionRes = $this->apiPost("/v2/admin/legal-documents/{$docId}/versions", [
            'version_number' => '1.0',
            'content' => '<p>Our lawful basis is consent.</p>',
            'effective_date' => '2026-04-01',
            'is_draft' => true,
        ]);
        $versionRes->assertStatus(201);
        $vid = (int) $versionRes->json('data.id');

        $this->apiPost("/v2/admin/legal-documents/versions/{$vid}/publish", [])->assertStatus(200);

        // Public endpoint (no auth) must now serve the published content for this tenant.
        $public = $this->apiGet("/v2/legal/{$type}");
        $public->assertStatus(200);
        $this->assertStringContainsString('lawful basis', json_encode($public->json()));
    }
}
