<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-378 — the consent record's "how it was accepted" field is decided by the
 * community's id, not by how the member accepted.
 *
 * `LegalController::acceptAll()` calls
 *
 *     $this->legalService->acceptAll($userId, $tenantId);
 *
 * against
 *
 *     LegalDocumentService::acceptAll(int $userId, string $method = 'registration')
 *
 * so the tenant id is passed where the acceptance *method* is declared.
 * LegalController does not declare strict_types, so PHP coerces the int to the
 * string "2" rather than throwing, and the value is then written to
 *
 *     `acceptance_method` enum('registration','login_prompt','settings','api','forced_update')
 *
 * 🔴 **MariaDB reads a numeric value written to an ENUM as a POSITION, not as a
 * label.** So the community id selects an enum member by ordinal:
 *
 *     tenant 1 -> 'registration'      tenant 4 -> 'api'
 *     tenant 2 -> 'login_prompt'      tenant 5 -> 'forced_update'
 *     tenant 3 -> 'settings'          tenant 6+ -> out of range
 *
 * That is why this survived: it does not write rubbish, it writes a **plausible,
 * valid, and wrong** value. Every acceptance recorded through this endpoint in
 * community 2 claims the member accepted at a login prompt. With
 * `'strict' => false` in config/database.php a community id past the end of the
 * enum truncates to the empty string instead of being refused — the F-272 shape.
 *
 * `user_legal_acceptances` is consent evidence. A public-sector customer asking
 * how a member accepted a policy is told something untrue. The service scopes
 * correctly by TenantContext internally, so nothing crosses communities; the
 * defect is the corrupted evidence, not the scoping.
 *
 * Found by `scripts/check-argument-types.mjs` during E-066 — the targeted check
 * the owner approved on 30 September 2026 for F-372's prevention half. Given its
 * own permanent identifier rather than folded into F-372, because F-372 names
 * four specific HTTP 500s and this is not one of them.
 */
class LegalAcceptAllRecordsMethodTest extends TestCase
{
    use DatabaseTransactions;

    /** The full set the column will accept. */
    private const ENUM_MEMBERS = [
        'registration',
        'login_prompt',
        'settings',
        'api',
        'forced_update',
    ];

    private function activeRegistrationDocument(int $tenantId, int $createdBy): int
    {
        $documentId = DB::table('legal_documents')->insertGetId([
            'tenant_id' => $tenantId,
            'document_type' => 'terms',
            'title' => 'Terms',
            'slug' => 'terms-' . uniqid(),
            'requires_acceptance' => 1,
            'acceptance_required_for' => 'registration',
            'notify_on_update' => 0,
            'is_active' => 1,
            'created_by' => $createdBy,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $versionId = DB::table('legal_document_versions')->insertGetId([
            'document_id' => $documentId,
            'version_number' => '1.0',
            'content' => 'Terms body.',
            'effective_date' => now()->toDateString(),
            'published_at' => now(),
            'is_draft' => 0,
            'is_current' => 1,
            'created_by' => $createdBy,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('legal_documents')
            ->where('id', $documentId)
            ->update(['current_version_id' => $versionId]);

        return $versionId;
    }

    /** Runs the whole journey and returns the acceptance method that was recorded. */
    private function acceptAllAndReadMethod(int $tenantId): string
    {
        $member = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $versionId = $this->activeRegistrationDocument($tenantId, $member->id);

        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/legal/accept-all')->assertStatus(200);

        $method = DB::table('user_legal_acceptances')
            ->where('user_id', $member->id)
            ->where('version_id', $versionId)
            ->value('acceptance_method');

        $this->assertNotNull(
            $method,
            'accept-all recorded no acceptance, so the assertions about the record prove nothing.',
        );

        return (string) $method;
    }

    public function test_the_recorded_acceptance_method_does_not_depend_on_the_community_id(): void
    {
        $inCommunityTwo = $this->acceptAllAndReadMethod(2);

        $this->withTenant(1);
        $inCommunityOne = $this->acceptAllAndReadMethod(1);

        $this->assertSame(
            $inCommunityOne,
            $inCommunityTwo,
            'F-378: the same journey recorded two different acceptance methods — "'
            . $inCommunityOne . '" in community 1 and "' . $inCommunityTwo
            . '" in community 2. How a member accepted is a property of the journey,'
            . ' not of which community they are in. The controller is passing the'
            . ' tenant id where the service declares the method, and MariaDB reads a'
            . ' numeric value written to an ENUM as a position.',
        );
    }

    public function test_accept_all_records_the_method_this_endpoint_actually_represents(): void
    {
        $method = $this->acceptAllAndReadMethod($this->testTenantId);

        $this->assertContains(
            $method,
            self::ENUM_MEMBERS,
            'F-378: the acceptance method is not one of the values the column defines.',
        );

        $this->assertSame(
            'api',
            $method,
            'F-378: a bulk acceptance taken over the API should be recorded as "api".'
            . ' It was recorded as "' . $method . '", which is the enum member sitting at'
            . ' position ' . $this->testTenantId . ' — the community id.',
        );
    }

    /**
     * Legitimate-access control, in the same file: the endpoint still works, still
     * records the acceptance for the calling member, and a second call is a no-op
     * rather than a duplicate.
     */
    public function test_accept_all_still_records_the_acceptance_for_the_calling_member(): void
    {
        $tenantId = $this->testTenantId;

        $member = User::factory()->forTenant($tenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        $versionId = $this->activeRegistrationDocument($tenantId, $member->id);

        Sanctum::actingAs($member, ['*']);

        $this->apiPost('/legal/accept-all')->assertStatus(200);

        $this->assertSame(
            1,
            DB::table('user_legal_acceptances')
                ->where('user_id', $member->id)
                ->where('version_id', $versionId)
                ->count(),
            'The acceptance was not recorded for the calling member.',
        );

        $this->apiPost('/legal/accept-all')->assertStatus(200);

        $this->assertSame(
            1,
            DB::table('user_legal_acceptances')
                ->where('user_id', $member->id)
                ->where('version_id', $versionId)
                ->count(),
            'accept-all duplicated an acceptance the member had already given.',
        );
    }
}
