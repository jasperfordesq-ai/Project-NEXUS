<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E064;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-276 (E-062): DELETE /v2/admin/legal-documents/{id} was a bare delete.
 * user_legal_acceptances has two ON DELETE CASCADE keys (fk_acceptance_document,
 * fk_acceptance_version) and legal_document_versions cascades from the
 * document, so one request destroyed every published version and every
 * member's acceptance record, with no audit entry.
 *
 * The sibling version delete only ever removes drafts (AdminLegalDocController
 * ::deleteVersion → "only draft versions can be deleted"). The document delete
 * must hold the same line: a document that has ever been published, or that
 * any member has accepted, is refused with 409 (deactivate it instead), and a
 * draft-only document can still be deleted — with an audit entry.
 */
class F276LegalDocumentDeletionKeepsConsentEvidenceTest extends TestCase
{
    use DatabaseTransactions;

    private function admin(): User
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        return $admin;
    }

    private function document(int $tenantId, int $createdBy, string $type = 'acceptable_use'): int
    {
        DB::table('legal_documents')->where('tenant_id', $tenantId)->where('document_type', $type)->delete();

        return (int) DB::table('legal_documents')->insertGetId([
            'tenant_id' => $tenantId,
            'document_type' => $type,
            'title' => 'F-276 fixture',
            'slug' => 'f276-' . uniqid(),
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'registration',
            'notify_on_update' => 0,
            'is_active' => 1,
            'created_by' => $createdBy,
        ]);
    }

    private function version(int $documentId, int $createdBy, bool $draft): int
    {
        return (int) DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => $draft ? '2.0' : '1.0',
            'content' => '<p>fixture</p>',
            'effective_date' => now()->toDateString(),
            'is_draft' => $draft ? 1 : 0,
            'is_current' => $draft ? 0 : 1,
            'published_at' => $draft ? null : now(),
            'created_by' => $createdBy,
        ]);
    }

    private function accept(int $userId, int $documentId, int $versionId): void
    {
        DB::table('user_legal_acceptances')->insert([
            'user_id' => $userId,
            'document_id' => $documentId,
            'version_id' => $versionId,
            'version_number' => '1.0',
            'acceptance_method' => 'registration',
            'ip_address' => '203.0.113.9',
        ]);
    }

    public function test_a_document_members_have_accepted_cannot_be_deleted(): void
    {
        $admin = $this->admin();
        $docId = $this->document($this->testTenantId, (int) $admin->id);
        $versionId = $this->version($docId, (int) $admin->id, false);
        $members = User::factory()->count(2)->forTenant($this->testTenantId)->create();
        foreach ($members as $member) {
            $this->accept((int) $member->id, $docId, $versionId);
        }

        $this->apiDelete("/v2/admin/legal-documents/{$docId}")->assertStatus(409);

        $this->assertSame(1, DB::table('legal_documents')->where('id', $docId)->count());
        $this->assertSame(1, DB::table('legal_document_versions')->where('id', $versionId)->count());
        $this->assertSame(2, DB::table('user_legal_acceptances')->where('document_id', $docId)->count(),
            'every member acceptance record must survive');
    }

    public function test_a_published_document_without_acceptances_cannot_be_deleted_either(): void
    {
        // A published version is the record of what members were shown. The
        // version endpoint refuses to delete it; the document endpoint must not
        // be a way round that.
        $admin = $this->admin();
        $docId = $this->document($this->testTenantId, (int) $admin->id);
        $versionId = $this->version($docId, (int) $admin->id, false);

        $this->apiDelete("/v2/admin/legal-documents/{$docId}")->assertStatus(409);

        $this->assertSame(1, DB::table('legal_document_versions')->where('id', $versionId)->count());
    }

    public function test_control_a_refused_document_can_still_be_retired_by_deactivating_it(): void
    {
        $admin = $this->admin();
        $docId = $this->document($this->testTenantId, (int) $admin->id);
        $versionId = $this->version($docId, (int) $admin->id, false);
        $member = User::factory()->forTenant($this->testTenantId)->create();
        $this->accept((int) $member->id, $docId, $versionId);

        $this->apiPut("/v2/admin/legal-documents/{$docId}", ['is_active' => false])->assertStatus(200);

        $this->assertSame(0, (int) DB::table('legal_documents')->where('id', $docId)->value('is_active'));
        $this->assertSame(1, DB::table('user_legal_acceptances')->where('document_id', $docId)->count());
    }

    public function test_control_a_draft_only_document_is_deleted_and_audited(): void
    {
        $admin = $this->admin();
        $docId = $this->document($this->testTenantId, (int) $admin->id);
        $draftId = $this->version($docId, (int) $admin->id, true);

        $this->apiDelete("/v2/admin/legal-documents/{$docId}")->assertStatus(200);

        $this->assertSame(0, DB::table('legal_documents')->where('id', $docId)->count());
        $this->assertSame(0, DB::table('legal_document_versions')->where('id', $draftId)->count());

        $audit = DB::table('org_audit_log')
            ->where('tenant_id', $this->testTenantId)
            ->where('action', 'legal_document_deleted')
            ->where('user_id', $admin->id)
            ->orderByDesc('id')
            ->first();
        $this->assertNotNull($audit, 'the deletion must leave an audit entry naming the administrator');
        $details = json_decode((string) $audit->details, true);
        $this->assertSame($docId, (int) ($details['document_id'] ?? 0));
        $this->assertSame('acceptable_use', $details['document_type'] ?? null);
    }

    public function test_another_communitys_document_is_not_found_and_not_deleted(): void
    {
        $admin = $this->admin();
        $otherTenantId = (int) DB::table('tenants')->where('id', '!=', $this->testTenantId)->value('id');
        $this->assertGreaterThan(0, $otherTenantId);
        $foreignDocId = $this->document($otherTenantId, (int) $admin->id);

        $this->apiDelete("/v2/admin/legal-documents/{$foreignDocId}")->assertStatus(404);

        $this->assertSame(1, DB::table('legal_documents')->where('id', $foreignDocId)->count());
    }
}
