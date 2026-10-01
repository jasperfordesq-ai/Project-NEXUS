<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E077;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\Enterprise\GdprService;
use App\Services\MemberVettingAttestationService;
use App\Services\SafeguardingJurisdictionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-509 (E-077 re-attack, reviewer B's C4) — the Article 15 export must not
 * hand the subject of a vetting record what the platform deliberately withholds
 * from them everywhere else.
 *
 * F-437 decided the subject must never receive the officer's private notes, the
 * scope summary, the revocation reason or the deciding officer, and
 * `getMemberStatus()` withholds all four. `GdprService::getVettingAttestationData()`
 * decrypted and returned them, plus the officers' ids on the event history and
 * review requests. Owner decision (1 Oct 2026, "fix the five medium ones"):
 * follow F-437's rule.
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Control in
 * the same file: the subject's own facts — the decision, its dates and which
 * clearance it is — are still in the export.
 */
final class F509ExportWithholdsVettingOfficerFieldsTest extends TestCase
{
    use DatabaseTransactions;

    private const NOTE = 'F509-OFFICER-PRIVATE-NOTE';

    private const SUMMARY = 'F509-SCOPE-SUMMARY';

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Cache::flush();
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_the_export_withholds_the_officer_fields_from_the_subject(): void
    {
        [$admin, $member] = $this->confirmedThenRevoked();

        $data = $this->export((int) $member->id);
        $json = json_encode($data);

        $this->assertStringNotContainsString(self::NOTE, (string) $json, 'F-509: the officer\'s private note is in the subject\'s export');
        $this->assertStringNotContainsString(self::SUMMARY, (string) $json, 'F-509: the scope summary is in the subject\'s export');

        $this->assertNotEmpty($data['attestations'], 'fixture: an attestation exists');
        foreach ($data['attestations'] as $row) {
            foreach (['private_notes', 'scope_summary', 'revocation_reason_code', 'confirmed_by', 'revoked_by'] as $field) {
                $this->assertArrayNotHasKey($field, $row, "F-509: attestation field {$field} reaches the subject");
            }
        }
        foreach ($data['events'] as $row) {
            foreach (['actor_user_id', 'reason_code'] as $field) {
                $this->assertArrayNotHasKey($field, $row, "F-509: event field {$field} reaches the subject");
            }
        }
        foreach ($data['review_requests'] as $row) {
            $this->assertArrayNotHasKey('handled_by', $row, 'F-509: the handling officer reaches the subject');
        }
    }

    public function test_control_the_subjects_own_facts_are_still_exported(): void
    {
        [, $member] = $this->confirmedThenRevoked();

        $row = $this->export((int) $member->id)['attestations'][0] ?? [];

        $this->assertSame('revoked', $row['decision'] ?? null, 'CONTROL: the decision itself is the subject\'s data');
        $this->assertNotEmpty($row['confirmed_at'] ?? null);
        $this->assertNotEmpty($row['revoked_at'] ?? null);
        $this->assertNotEmpty($row['scheme_code'] ?? null);
    }

    /** @return array{0:User,1:User} */
    private function confirmedThenRevoked(): array
    {
        $admin = $this->account('admin', 1);
        $member = $this->account('member', 0);
        app(SafeguardingJurisdictionService::class)->configure($this->testTenantId, 'ireland', (int) $admin->id);

        $svc = app(MemberVettingAttestationService::class);
        $details = ['private_notes' => self::NOTE, 'scope_summary' => self::SUMMARY];
        try {
            $svc->confirmForCurrentPolicy($this->testTenantId, (int) $member->id, (int) $admin->id, null, $details);
        } catch (\App\Exceptions\SafeguardingPolicyException) {
            $policy = app(SafeguardingJurisdictionService::class)->getPolicyUncached($this->testTenantId);
            $details['certification_codes'] = [(string) ($policy['certification_options'][0]['code'] ?? '')];
            $svc->confirmForCurrentPolicy($this->testTenantId, (int) $member->id, (int) $admin->id, null, $details);
        }
        $svc->revokeForCurrentPolicy($this->testTenantId, (int) $member->id, (int) $admin->id, 'community_decision_withdrawn');

        return [$admin, $member];
    }

    /** @return array{attestations: array<int, array<string, mixed>>, events: array<int, array<string, mixed>>, review_requests: array<int, array<string, mixed>>} */
    private function export(int $memberId): array
    {
        $gdpr = new GdprService($this->testTenantId);
        $m = new \ReflectionMethod(GdprService::class, 'getVettingAttestationData');
        $m->setAccessible(true);

        return $m->invoke($gdpr, $memberId);
    }

    private function account(string $role, int $isAdmin): User
    {
        $u = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        DB::table('users')->where('id', $u->id)->update(['role' => $role, 'is_admin' => $isAdmin]);

        return User::find($u->id);
    }
}
