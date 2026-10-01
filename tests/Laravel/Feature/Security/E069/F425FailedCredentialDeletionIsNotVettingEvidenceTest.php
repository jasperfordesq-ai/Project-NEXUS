<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Models\User;
use App\Services\LegacyVettingEvidenceManager;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-425 (E-069 K-4) — a FAILED credential file deletion was filed as prohibited
 * criminal-record evidence.
 *
 * When a member deletes a volunteering credential and the stored file cannot be
 * removed, the row is deliberately kept as a redacted cleanup tombstone rather
 * than orphaning the file: `notes` is stamped with
 * `LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER`. That marker alone
 * then put the row in the `legacy_vetting_evidence` bucket, which exists for the
 * prohibited criminal-record aliases in
 * `VolunteerCredentialPolicy::PROHIBITED_VETTING_TYPES`.
 *
 * So a member's first-aid or food-hygiene certificate, whose file deletion
 * merely failed, was shown back to them as retired vetting evidence. The
 * classification must follow the credential TYPE, not the cleanup marker.
 *
 * Every string here is synthetic. No member data is used.
 */
final class F425FailedCredentialDeletionIsNotVettingEvidenceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutMiddleware([
            \Illuminate\Routing\Middleware\ThrottleRequests::class,
            \Illuminate\Routing\Middleware\ThrottleRequestsWithRedis::class,
        ]);
        Cache::flush();
        Storage::fake('local');
    }

    /**
     * THE FIX — after an induced storage failure the member's ordinary
     * credential is NOT reported as retired vetting evidence, while a genuinely
     * prohibited credential still is.
     */
    public function test_a_failed_deletion_is_not_reported_as_retired_vetting_evidence(): void
    {
        $member = $this->member();

        $firstAidId = $this->credential((int) $member->id, 'first_aid', 'f425-first-aid.pdf');
        // CONTROL (the bucket is not emptied) — a genuinely prohibited
        // criminal-record alias, which must still be classified as retired
        // vetting evidence after the fix.
        $prohibitedId = $this->credential((int) $member->id, 'dbs_enhanced', 'f425-dbs.pdf');
        // CONTROL (ordinary credentials are untouched) — nothing was deleted.
        $foodHygieneId = $this->credential((int) $member->id, 'food_hygiene', 'f425-food.pdf');

        $this->failEveryPrivateCredentialDeletion();

        // The member deletes their first-aid certificate through the real route
        // and the storage deletion fails.
        $this->deleteJson('/api/v2/volunteering/credentials/' . $firstAidId, [], $this->withTenantHeader())
            ->assertStatus(503)
            ->assertJsonPath('errors.0.code', 'CREDENTIAL_DELETE_FAILED');

        $tombstone = DB::table('vol_credentials')->where('id', $firstAidId)->first();
        self::assertNotNull($tombstone, 'precondition: the row is retained as a cleanup tombstone');
        self::assertSame(
            LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER,
            (string) $tombstone->notes,
            'precondition: the cleanup marker was stamped by the real delete path'
        );
        self::assertSame('first_aid', (string) $tombstone->credential_type, 'precondition: the type is unchanged');

        $rows = $this->listCredentials();

        // THE FIX — the first-aid tombstone is not prohibited vetting evidence.
        $firstAid = $this->row($rows, $firstAidId);
        self::assertFalse(
            (bool) $firstAid['legacy_vetting_evidence'],
            'a first-aid certificate whose file deletion failed must not be filed as retired vetting evidence'
        );
        self::assertSame(
            'first_aid',
            (string) $firstAid['credential_type'],
            'and its own credential type must still be reported'
        );
        self::assertTrue(
            (bool) $firstAid['manual_review_required'],
            'it belongs in the manual-review bucket instead, so the outstanding cleanup is visible'
        );
        self::assertNull($firstAid['file_url'], 'the file is still withheld — the member asked for it to be deleted');

        // CONTROL (the classification still works) — the prohibited alias is
        // still reported as retired vetting evidence, with no download link.
        $prohibited = $this->row($rows, $prohibitedId);
        self::assertTrue(
            (bool) $prohibited['legacy_vetting_evidence'],
            'control: a genuine criminal-record alias is still classified as retired vetting evidence'
        );
        self::assertNull($prohibited['file_url'], 'control: and is still never offered for download');

        // CONTROL (ordinary credentials unaffected) — the untouched food-hygiene
        // certificate is still an ordinary credential with its download link.
        $foodHygiene = $this->row($rows, $foodHygieneId);
        self::assertFalse((bool) $foodHygiene['legacy_vetting_evidence'], 'control: an untouched credential is ordinary');
        self::assertFalse((bool) $foodHygiene['manual_review_required'], 'control: and needs no review');
        self::assertSame(
            '/api/v2/volunteering/credentials/' . $foodHygieneId . '/download',
            (string) $foodHygiene['file_url'],
            'control: and is still downloadable by its owner'
        );
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /**
     * Induce the storage failure: the production path returns 'failed' when the
     * disk refuses to remove the file, which is the branch that writes the
     * cleanup tombstone.
     */
    private function failEveryPrivateCredentialDeletion(): void
    {
        $this->app->bind(LegacyVettingEvidenceManager::class, static fn (): LegacyVettingEvidenceManager =>
            new class extends LegacyVettingEvidenceManager {
                public function deletePrivateCredentialPointer(string $url, int $tenantId): string
                {
                    return 'failed';
                }
            });
    }

    /** @return list<array<string,mixed>> */
    private function listCredentials(): array
    {
        $response = $this->apiGet('/v2/volunteering/credentials');
        $response->assertOk();

        $credentials = $response->json('data.credentials');
        self::assertIsArray($credentials, 'precondition: the credential list reads back');

        return $credentials;
    }

    /**
     * @param  list<array<string,mixed>>  $rows
     * @return array<string,mixed>
     */
    private function row(array $rows, int $id): array
    {
        foreach ($rows as $row) {
            if (is_array($row) && (int) ($row['id'] ?? 0) === $id) {
                return $row;
            }
        }

        self::fail('precondition: credential ' . $id . ' is in the member\'s own list');
    }

    private function credential(int $userId, string $type, string $filename): int
    {
        $relative = 'volunteer-credentials/' . $this->testTenantId . '/' . $filename;
        Storage::disk('local')->put($relative, 'F425 synthetic credential file');

        return (int) DB::table('vol_credentials')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'credential_type' => $type,
            'file_url' => 'private:' . $relative,
            'file_name' => $filename,
            'status' => 'pending',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function member(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }
}
