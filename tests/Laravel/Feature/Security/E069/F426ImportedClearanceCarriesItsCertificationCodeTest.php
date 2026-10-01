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
 * F-426 (E-069 L-2) — a legacy-imported safeguarding clearance was stored with
 * NO certification code at all.
 *
 * The ordinary broker route refuses a decision with an empty certification set
 * (`INVALID_VETTING_CERTIFICATION_CODE` in
 * `MemberVettingAttestationService::normalizeCertificationDetails()`), and when
 * the community's jurisdiction offers exactly one option it fills that option in
 * for the broker. `MigrateLegacyVettingAttestations` wrote the attestation row
 * directly and supplied no `certification_codes` at all, so every imported
 * clearance was stored NULL — a confirmed clearance that does not say which
 * check it is a clearance for. Brokers read that column on the vetting roster.
 *
 * 🔴 Deliberately NOT asserted here: `review_due_at` and `authority_expires_at`
 * are also NULL on an imported row, which is why the renewal sweep never selects
 * it. For the `england_wales` policy the ordinary broker route can leave both
 * NULL too, so that half is a policy weakness the import SHARES rather than one
 * it introduces, and choosing a default expiry period would be inventing policy.
 * It is recorded for the owner instead of being guessed at here.
 *
 * Every string here is synthetic. No member data is used.
 */
final class F426ImportedClearanceCarriesItsCertificationCodeTest extends TestCase
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
            'name' => 'F426 Legacy Vetting Community',
            'slug' => 'f426-lv-' . bin2hex(random_bytes(4)),
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
    }

    /**
     * THE FIX — an imported clearance carries the jurisdiction's own
     * certification code, and a broker reading the roster sees it.
     */
    public function test_an_imported_clearance_records_which_check_it_is_a_clearance_for(): void
    {
        $memberId = $this->createUser('imported', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        $expected = $this->singleCertificationCodeFromPolicy();

        $this->runApply();

        $row = $this->attestationFor($memberId);
        self::assertNotNull($row, 'precondition: the clean legacy decision is imported');

        // THE FIX — the column is populated, with the code the community's own
        // configured jurisdiction offers, not a literal written into the import.
        self::assertNotNull(
            $row->certification_codes,
            'an imported clearance must record which check it is a clearance for'
        );
        self::assertSame(
            [$expected],
            json_decode((string) $row->certification_codes, true),
            'and the code must be the one the community\'s own jurisdiction defines'
        );

        // The broker's roster — the surface that actually reads this column —
        // now shows it.
        $listed = $this->rosterRowFor($memberId);
        self::assertSame(
            [$expected],
            $listed['certification_codes'],
            'the broker roster shows the certification behind the imported clearance'
        );

        // CONTROL (the import still does its job) — the clearance is confirmed,
        // the legacy verifier is still recorded as the decider, and the
        // safeguarded-contact gate still opens. Without this, refusing every
        // import would also make the assertions above pass.
        self::assertSame('confirmed', (string) $row->decision, 'control: the clearance is still minted');
        self::assertSame($this->verifierId, (int) $row->confirmed_by, 'control: the legacy verifier is still the decider');
        self::assertTrue($this->gateAllows($memberId), 'control: the safeguarded-contact gate still opens');
        self::assertSame(0, $this->pendingReviewCount($memberId), 'control: no broker review task was needed');
    }

    /**
     * CONTROL (the guard is real, not decorative) — if the community's policy
     * does not define exactly one certification option, the import refuses to
     * mint rather than storing a clearance with no code. The member is left
     * untouched, exactly as for any other row the command declines.
     */
    public function test_the_import_refuses_to_mint_a_clearance_it_cannot_name(): void
    {
        $memberId = $this->createUser('nooption', 'member');
        $this->seedTrustedLegacyRow($memberId, '2016-05-04 10:00:00');

        // Same member, same trusted legacy row — the ONLY difference is that the
        // configured jurisdiction offers no certification option to name.
        $this->app->bind(SafeguardingJurisdictionService::class, fn (): SafeguardingJurisdictionService =>
            new class ($this->policy) extends SafeguardingJurisdictionService {
                /** @param array<string, mixed> $policy */
                public function __construct(private readonly array $policy) {}

                /** @return array<string, mixed> */
                public function getPolicy(int $tenantId): array
                {
                    return array_merge($this->policy, ['certification_options' => []]);
                }
            });

        $this->runApply();

        self::assertNull(
            $this->attestationFor($memberId),
            'no clearance is minted when the policy cannot say which check it is for'
        );
        self::assertFalse($this->gateAllows($memberId), 'and the safeguarded-contact gate stays shut');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function singleCertificationCodeFromPolicy(): string
    {
        $options = $this->policy['certification_options'] ?? [];
        self::assertIsArray($options, 'fixture: the policy exposes certification options');
        self::assertCount(1, $options, 'fixture: england_wales offers exactly one certification option');

        return (string) $options[0]['code'];
    }

    private function createUser(string $label, string $role): int
    {
        return (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId,
            'email' => 'f426-' . $label . '-' . bin2hex(random_bytes(5)) . '@example.invalid',
            'password' => password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
            'first_name' => 'F426',
            'last_name' => ucfirst($label),
            'name' => 'F426 ' . ucfirst($label),
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

    /** @return array<string, mixed> */
    private function rosterRowFor(int $memberId): array
    {
        $listed = app(MemberVettingAttestationService::class)->listMembers($this->tenantId, ['per_page' => 100]);
        foreach (($listed['data'] ?? []) as $row) {
            if (is_array($row) && (int) ($row['user_id'] ?? 0) === $memberId) {
                return $row;
            }
        }

        self::fail('precondition: the member appears on the vetting roster');
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
}
