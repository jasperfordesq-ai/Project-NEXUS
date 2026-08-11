<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Legal;

use App\Services\TenantDefaultsSeeder;
use App\Support\Legal\StandardTermsContent;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Seeding the standard shipped Terms of Service as an acceptable document.
 *
 * 🔴 The reason this exists: acceptance enforcement only ever blocks on a row in
 * `legal_documents`. Before this seeder, the shipped terms were display copy only,
 * so a community had nothing for a member to accept and the legal obligation was
 * silently unmet however the gate was configured. Measured 2026-08-11 before the
 * fix: 5 tenants, 0 legal documents.
 *
 * The two tests that matter most are the ones that protect a legal record: it must
 * never overwrite a community's own terms, and it must never overwrite its own
 * previous seed — because members have accepted a specific version id, and
 * replacing the content under them would invalidate every acceptance on file while
 * leaving the acceptance rows looking perfectly valid.
 */
class SeedStandardLegalDocumentsTest extends TestCase
{
    use DatabaseTransactions;

    private function seedFor(int $tenantId): void
    {
        TenantDefaultsSeeder::seedStandardLegalDocuments($tenantId);
    }

    private function termsFor(int $tenantId): ?object
    {
        return DB::table('legal_documents')
            ->where('tenant_id', $tenantId)
            ->where('document_type', 'terms')
            ->first();
    }

    private function clearTermsFor(int $tenantId): void
    {
        $ids = DB::table('legal_documents')
            ->where('tenant_id', $tenantId)
            ->where('document_type', 'terms')
            ->pluck('id');

        if ($ids->isNotEmpty()) {
            DB::table('legal_documents')->whereIn('id', $ids)->update(['current_version_id' => null]);
            DB::table('legal_document_versions')->whereIn('document_id', $ids)->delete();
            DB::table('legal_documents')->whereIn('id', $ids)->delete();
        }
    }

    protected function setUp(): void
    {
        parent::setUp();
        // Start from a community with no terms, whatever the local database holds.
        $this->clearTermsFor($this->testTenantId);
    }

    public function test_it_creates_a_published_terms_document(): void
    {
        $this->seedFor($this->testTenantId);

        $document = $this->termsFor($this->testTenantId);
        $this->assertNotNull($document);
        $this->assertSame('Terms of Service', $document->title);
        $this->assertSame('terms', $document->slug);
        $this->assertSame(1, (int) $document->is_active);
        $this->assertNotNull($document->current_version_id);

        $version = DB::table('legal_document_versions')->where('id', $document->current_version_id)->first();
        $this->assertSame(StandardTermsContent::VERSION, $version->version_number);
        // 🔴 Published, not a draft. A draft satisfies nothing — nobody is asked to
        // accept it, so the obligation would still be unmet.
        $this->assertSame(0, (int) $version->is_draft);
        $this->assertSame(1, (int) $version->is_current);
        $this->assertNotNull($version->published_at);
    }

    public function test_the_document_actually_gates_members(): void
    {
        // 🔴 The whole purpose. A document that does not require acceptance, or is
        // scoped to registration only, blocks nobody — and would make the seed
        // look done while changing nothing.
        $this->seedFor($this->testTenantId);

        $document = $this->termsFor($this->testTenantId);

        $this->assertSame(1, (int) $document->requires_acceptance);
        // `login`, not `registration`: registration-time acceptance would leave every
        // EXISTING member of an established community permanently un-gated, which is
        // exactly the hole being closed.
        $this->assertSame('login', $document->acceptance_required_for);
        $this->assertContains(
            $document->acceptance_required_for,
            (array) config('legal.enforced_acceptance_modes'),
            'The seeded document uses an acceptance mode the gate does not enforce.'
        );
    }

    public function test_it_stores_the_shipped_terms_content(): void
    {
        $this->seedFor($this->testTenantId);

        $document = $this->termsFor($this->testTenantId);
        $version = DB::table('legal_document_versions')->where('id', $document->current_version_id)->first();

        $tenantName = (string) DB::table('tenants')->where('id', $this->testTenantId)->value('name');

        $this->assertSame(StandardTermsContent::html($tenantName), $version->content);
        $this->assertSame(StandardTermsContent::plainText($tenantName), $version->content_plain);
        $this->assertStringContainsString('Time Credit System', (string) $version->content);
    }

    public function test_running_it_twice_changes_nothing(): void
    {
        $this->seedFor($this->testTenantId);
        $first = $this->termsFor($this->testTenantId);
        $firstVersionCount = DB::table('legal_document_versions')->where('document_id', $first->id)->count();

        $this->seedFor($this->testTenantId);

        $second = $this->termsFor($this->testTenantId);
        $this->assertSame((int) $first->id, (int) $second->id, 'A second run created a different document.');
        $this->assertSame(
            $firstVersionCount,
            DB::table('legal_document_versions')->where('document_id', $second->id)->count(),
            'A second run added another version.'
        );
    }

    public function test_it_never_overwrites_a_community_that_wrote_its_own_terms(): void
    {
        // 🔴 THE test. A community's published terms are a legal record and members
        // have accepted a specific version id. Replacing that content would
        // invalidate every acceptance on file while leaving the acceptance rows
        // looking valid — the worst possible outcome for an audit trail.
        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Our own carefully written terms',
            'slug' => 'terms',
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'login',
            'notify_on_update' => 1,
            'is_active' => 1,
            'created_by' => 0,
        ]);
        $versionId = (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '7.3',
            'content' => '<p>Wording the community chose itself.</p>',
            'content_plain' => 'Wording the community chose itself.',
            'effective_date' => '2026-01-01',
            'is_draft' => 0,
            'is_current' => 1,
            'published_at' => now(),
            'created_by' => 0,
        ]);
        DB::table('legal_documents')->where('id', $documentId)->update(['current_version_id' => $versionId]);

        $this->seedFor($this->testTenantId);

        $document = $this->termsFor($this->testTenantId);
        $this->assertSame('Our own carefully written terms', $document->title);
        $this->assertSame($versionId, (int) $document->current_version_id);

        $version = DB::table('legal_document_versions')->where('id', $versionId)->first();
        $this->assertSame('<p>Wording the community chose itself.</p>', $version->content);
        $this->assertSame('7.3', $version->version_number);
    }

    public function test_it_leaves_a_deliberately_ungated_document_alone(): void
    {
        // A community that set its terms to not require acceptance has made a
        // choice. The seeder must not quietly reverse it — the backfill command
        // reports it instead, so a human can decide.
        $documentId = (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'document_type' => 'terms',
            'title' => 'Terms',
            'slug' => 'terms',
            'requires_acceptance' => 0,
            'acceptance_required_for' => 'none',
            'notify_on_update' => 0,
            'is_active' => 1,
            'created_by' => 0,
        ]);

        $this->seedFor($this->testTenantId);

        $document = $this->termsFor($this->testTenantId);
        $this->assertSame($documentId, (int) $document->id);
        $this->assertSame(0, (int) $document->requires_acceptance);
        $this->assertSame('none', $document->acceptance_required_for);
    }

    public function test_it_works_for_a_community_with_no_users_yet(): void
    {
        // A brand-new community is seeded before its admin exists, and
        // `created_by` is NOT NULL on both tables.
        $tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'Brand New Community',
            'slug' => 'brand-new-community-' . uniqid(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->seedFor($tenantId);

        $document = $this->termsFor($tenantId);
        $this->assertNotNull($document, 'A community with no users was not seeded.');
        $this->assertSame(0, (int) $document->created_by);
        $this->assertStringContainsString(
            'Welcome to Brand New Community',
            (string) DB::table('legal_document_versions')->where('id', $document->current_version_id)->value('content')
        );
    }

    public function test_the_gate_notices_the_new_document_immediately(): void
    {
        // The gate caches a per-user verdict keyed on the tenant's legal revision.
        // Without the revision bump inside the seeder, nobody would be asked to
        // accept the document that just appeared until their cached verdict expired.
        $before = \App\Services\LegalEnforcementService::revision($this->testTenantId);

        $this->seedFor($this->testTenantId);

        $this->assertGreaterThan(
            $before,
            \App\Services\LegalEnforcementService::revision($this->testTenantId),
            'Seeding did not invalidate cached acceptance verdicts.'
        );
    }
}
