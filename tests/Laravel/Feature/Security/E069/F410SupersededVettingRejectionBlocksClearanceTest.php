<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Console\Commands\MigrateLegacyVettingAttestations;
use App\Services\MemberVettingAttestationService;
use App\Services\SafeguardingJurisdictionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-410 — the legacy vetting migration must not mint a CONFIRMED safeguarding
 * clearance for a member whose record is contradicted by a later one.
 *
 * `MigrateLegacyVettingAttestations::trustedLegacyRows()` vetted the candidate
 * row carefully (no self-verification, an active admin verifier, matching
 * `activity_log` provenance within fifteen minutes) but never asked whether a
 * LATER record for the same member said something different. The words
 * `rejected` and `revoked` appeared nowhere in the command, so an old
 * `verified` row produced `decision = confirmed` even when the member's most
 * recent criminal-record check had been rejected or revoked.
 *
 * What that row unlocks: `SafeguardingInteractionPolicy::evaluate()` reads it
 * through `MemberVettingAttestationService::hasConfirmedAttestation()` with the
 * tenant-scope contact triple (`purpose_code = safeguarded_member_contact`,
 * `scope_type = tenant`) and ALLOWs direct contact with members who declared a
 * safeguarding need. It does NOT open a DBS-gated listing — that gate asks for
 * `listing_role` / `listing` scope, which this import never writes.
 *
 * Correct behaviour, asserted here: a contradicted member is refused and routed
 * to the EXISTING broker-review branch, which confers no access; an
 * uncontradicted member is still imported, so the command has not simply been
 * turned off.
 */
final class F410SupersededVettingRejectionBlocksClearanceTest extends TestCase
{
    use DatabaseTransactions;

    private int $tenantId = 0;
    private int $verifierId = 0;

    /** @var array<string, mixed> */
    private array $policy = [];

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F410 Legacy Vetting Community',
            'slug' => 'f410-lv-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->verifierId = $this->createUser('verifier', 'admin');

        /** @var SafeguardingJurisdictionService $jurisdictions */
        $jurisdictions = app(SafeguardingJurisdictionService::class);
        $jurisdictions->configure($this->tenantId, 'england_wales', $this->verifierId);
        $jurisdictions->forget($this->tenantId);
        $this->policy = $jurisdictions->getPolicyUncached($this->tenantId);

        $this->assertTrue((bool) $this->policy['configured'], 'fixture: the England and Wales policy is configured');
        $this->assertSame('dbs_england_wales', $this->policy['scheme_code'], 'fixture: expected scheme');
    }

    private function createUser(string $label, string $role): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId,
            'email' => 'f410-' . $label . '-' . bin2hex(random_bytes(5)) . '@example.invalid',
            'password' => password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
            'first_name' => 'F410',
            'last_name' => ucfirst($label),
            'name' => 'F410 ' . ucfirst($label),
            'role' => $role,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * The exact legacy shape the command calls "strongly proven": Enhanced DBS,
     * status verified, no certificate lifecycle, not redacted, verified by a
     * different currently-active admin, with the matching `activity_log`
     * provenance row inside the +/- 15 minute window.
     */
    private function seedTrustedLegacyRow(int $memberId, string $verifiedAt): int
    {
        $recordId = (int) DB::table('vetting_records')->insertGetId([
            'tenant_id' => $this->tenantId,
            'user_id' => $memberId,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'reference_number' => null,
            'issue_date' => null,
            'expiry_date' => null,
            'verified_by' => $this->verifierId,
            'verified_at' => $verifiedAt,
            'legacy_sensitive_metadata_redacted' => 0,
            'created_at' => $verifiedAt,
            'updated_at' => $verifiedAt,
        ]);

        DB::table('activity_log')->insert([
            'tenant_id' => $this->tenantId,
            'user_id' => $this->verifierId,
            'action' => 'vetting_record_verified',
            'action_type' => 'admin',
            'entity_type' => 'vetting_record',
            'entity_id' => $recordId,
            'created_at' => $verifiedAt,
        ]);

        return $recordId;
    }

    /** A later legacy record for the same member that did not pass. */
    private function seedSupersedingLegacyRow(int $memberId, string $status, string $at): int
    {
        return (int) DB::table('vetting_records')->insertGetId([
            'tenant_id' => $this->tenantId,
            'user_id' => $memberId,
            'vetting_type' => 'dbs_enhanced',
            'status' => $status,
            'reference_number' => null,
            'issue_date' => null,
            'expiry_date' => null,
            'verified_by' => null,
            'verified_at' => null,
            'rejected_by' => $status === 'rejected' ? $this->verifierId : null,
            'rejected_at' => $status === 'rejected' ? $at : null,
            'rejection_reason' => $status === 'rejected' ? 'F410 fixture: the later check did not pass.' : null,
            'legacy_sensitive_metadata_redacted' => 0,
            'created_at' => $at,
            'updated_at' => $at,
        ]);
    }

    private function runApply(): void
    {
        $this->artisan('safeguarding:migrate-legacy-vetting-attestations', [
            '--tenant' => (string) $this->tenantId,
            '--apply' => true,
            '--acknowledge' => MigrateLegacyVettingAttestations::APPLY_ACKNOWLEDGEMENT,
        ])->assertExitCode(0);
    }

    private function attestationFor(int $memberId): ?object
    {
        return DB::table('member_vetting_attestations')
            ->where('tenant_id', $this->tenantId)
            ->where('user_id', $memberId)
            ->first();
    }

    /** The live predicate the contact gate uses, with the tenant's real policy. */
    private function gateAllows(int $memberId): bool
    {
        return app(MemberVettingAttestationService::class)->hasConfirmedAttestation(
            tenantId: $this->tenantId,
            memberId: $memberId,
            schemeCode: (string) $this->policy['scheme_code'],
            attestationCode: (string) $this->policy['attestation_code'],
            purposeCode: (string) $this->policy['purpose_code'],
            scopeType: (string) $this->policy['scope_type'],
            scopeIdentifier: (string) $this->policy['scope_identifier'],
            policyVersion: (string) $this->policy['policy_version'],
        );
    }

    private function pendingReviewCount(int $memberId): int
    {
        return (int) DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $this->tenantId)
            ->where('user_id', $memberId)
            ->where('status', 'pending')
            ->count();
    }

    /**
     * BASELINE — a clean trusted legacy row with nothing contradicting it is
     * still imported. Without this, "refuse everything" would pass the tests
     * below while silently disabling the command.
     */
    public function test_an_uncontradicted_trusted_legacy_row_is_still_imported(): void
    {
        $memberId = $this->createUser('clean', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        $this->runApply();

        $row = $this->attestationFor($memberId);
        $this->assertNotNull($row, 'the clean legacy decision is imported');
        $this->assertSame('confirmed', (string) $row->decision);
        $this->assertSame($this->verifierId, (int) $row->confirmed_by, 'the legacy verifier is the decider');
        $this->assertTrue($this->gateAllows($memberId), 'the safeguarded-contact gate opens');
        $this->assertSame(0, $this->pendingReviewCount($memberId), 'no review task is needed');
    }

    /**
     * F-410 — a later REJECTED record for the same member must block the
     * import. The member is routed to the existing broker-review branch, which
     * confers no access.
     */
    public function test_a_later_rejected_record_blocks_the_clearance_and_routes_to_broker_review(): void
    {
        $memberId = $this->createUser('rejectedlater', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');
        $rejectedId = $this->seedSupersedingLegacyRow($memberId, 'rejected', '2023-11-20 09:00:00');

        $rejected = DB::table('vetting_records')->where('id', $rejectedId)->first();
        $this->assertNotNull($rejected);
        $this->assertSame('rejected', (string) $rejected->status, 'fixture: the rejection is genuinely on record');

        $this->runApply();

        $this->assertNull(
            $this->attestationFor($memberId),
            'no clearance is minted for a member whose later criminal-record check was rejected',
        );
        $this->assertFalse($this->gateAllows($memberId), 'the safeguarded-member contact gate stays shut');
        $this->assertSame(1, $this->pendingReviewCount($memberId), 'a broker review task is raised instead');
    }

    /**
     * F-410 — the same with a later REVOKED record. `revoked` is the status the
     * platform's own GDPR erasure path writes, so it is not a hypothetical
     * value.
     */
    public function test_a_later_revoked_record_blocks_the_clearance_and_routes_to_broker_review(): void
    {
        $memberId = $this->createUser('revokedlater', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');
        $this->seedSupersedingLegacyRow($memberId, 'revoked', '2024-02-02 09:00:00');

        $this->runApply();

        $this->assertNull($this->attestationFor($memberId), 'no clearance is minted after a revocation');
        $this->assertFalse($this->gateAllows($memberId), 'the contact gate stays shut');
        $this->assertSame(1, $this->pendingReviewCount($memberId), 'a broker review task is raised instead');
    }

    /**
     * F-410 — a rejection recorded BEFORE the trusted verification is still a
     * contradiction worth a human look. Legacy imported data carries unreliable
     * ordering, and the command's own contract is that ambiguous rows go to
     * review.
     */
    public function test_an_earlier_rejected_record_also_routes_to_broker_review(): void
    {
        $memberId = $this->createUser('rejectedearlier', 'member');
        $this->seedSupersedingLegacyRow($memberId, 'rejected', '2014-01-09 09:00:00');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        $this->runApply();

        $this->assertNull($this->attestationFor($memberId), 'a rejection anywhere in the history blocks the import');
        $this->assertFalse($this->gateAllows($memberId), 'the contact gate stays shut');
        $this->assertSame(1, $this->pendingReviewCount($memberId), 'a broker review task is raised instead');
    }

    /**
     * F-410 — a later check that is still PENDING is ambiguous too: the
     * community has started a fresh check and has no answer yet, so the old
     * decision must not be promoted behind their back.
     */
    public function test_a_later_pending_check_routes_to_broker_review(): void
    {
        $memberId = $this->createUser('pendinglater', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');
        $this->seedSupersedingLegacyRow($memberId, 'pending', '2025-03-01 09:00:00');

        $this->runApply();

        $this->assertNull($this->attestationFor($memberId), 'a later in-flight check blocks the import');
        $this->assertFalse($this->gateAllows($memberId), 'the contact gate stays shut');
        $this->assertSame(1, $this->pendingReviewCount($memberId), 'a broker review task is raised instead');
    }

    /**
     * The exclusion is scoped to the same check type — a rejected record of a
     * DIFFERENT vetting type says nothing about the Enhanced DBS decision this
     * command imports, and must not block it.
     */
    public function test_a_rejected_record_of_a_different_vetting_type_does_not_block_the_import(): void
    {
        $memberId = $this->createUser('othertype', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        DB::table('vetting_records')->insert([
            'tenant_id' => $this->tenantId,
            'user_id' => $memberId,
            'vetting_type' => 'garda_vetting',
            'status' => 'rejected',
            'legacy_sensitive_metadata_redacted' => 0,
            'created_at' => '2023-11-20 09:00:00',
            'updated_at' => '2023-11-20 09:00:00',
        ]);

        $this->runApply();

        $row = $this->attestationFor($memberId);
        $this->assertNotNull($row, 'an unrelated check type does not block the Enhanced DBS import');
        $this->assertSame('confirmed', (string) $row->decision);
    }

    /**
     * The exclusion never reaches across communities: another tenant's rejected
     * record for a different member id must not affect this one.
     */
    public function test_another_communitys_rejected_record_does_not_block_the_import(): void
    {
        $otherTenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F410 Other Community',
            'slug' => 'f410-other-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $memberId = $this->createUser('crosstenant', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        DB::table('vetting_records')->insert([
            'tenant_id' => $otherTenantId,
            'user_id' => $memberId,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'rejected',
            'legacy_sensitive_metadata_redacted' => 0,
            'created_at' => '2023-11-20 09:00:00',
            'updated_at' => '2023-11-20 09:00:00',
        ]);

        $this->runApply();

        $row = $this->attestationFor($memberId);
        $this->assertNotNull($row, 'another community\'s record has no bearing on this one');
        $this->assertSame('confirmed', (string) $row->decision);
    }
}
