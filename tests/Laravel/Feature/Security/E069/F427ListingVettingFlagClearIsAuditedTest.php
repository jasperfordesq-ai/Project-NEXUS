<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Console\Commands\AuditLegacyListingVettingRequirements;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-427 (E-069 L-3) — clearing a safeguarding requirement across listings must
 * leave a durable record.
 *
 * `safeguarding:audit-listing-vetting-flags --apply` sets
 * `listing_risk_tags.dbs_required = 0` for every matching row, and with
 * `--all-tenants` that is every community on the installation in one
 * transaction. The file referenced no audit service and no audit table, so
 * after a run there was no way to say who ran it, when, over which communities,
 * or how many listings lost their safeguarding requirement — only console
 * output nobody captures.
 *
 * This is the same class as F-409 and takes the same shape: a named operator,
 * an "authorised" row written BEFORE the first change (so a run that dies
 * part-way still leaves proof it happened), and a "cleared" row carrying the
 * counts, both in `gdpr_audit_log` alongside the platform's other
 * data-protection actions.
 *
 * Every string here is synthetic. No member data is used.
 */
final class F427ListingVettingFlagClearIsAuditedTest extends TestCase
{
    use DatabaseTransactions;

    private const ACTOR = 'F427 Operator (safeguarding-review-0001)';

    private int $tenantId = 0;
    private int $ownerId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F427 Listing Flag Community',
            'slug' => 'f427-lf-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->ownerId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId,
            'email' => 'f427-' . bin2hex(random_bytes(5)) . '@example.invalid',
            'password' => password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
            'first_name' => 'F427',
            'last_name' => 'Owner',
            'name' => 'F427 Owner',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * F-427 — an authorised clear writes a durable record naming the operator,
     * the community and the number of listings that lost the requirement, and
     * the flags really are cleared.
     */
    public function test_an_authorised_clear_is_recorded_with_operator_scope_and_counts(): void
    {
        $listingId = $this->listingWithVettingRequirement();

        $this->runApply()->assertExitCode(0);

        // The act really happened.
        self::assertSame(
            0,
            (int) DB::table('listing_risk_tags')
                ->where('tenant_id', $this->tenantId)
                ->where('listing_id', $listingId)
                ->value('dbs_required'),
            'precondition: the safeguarding requirement really was cleared'
        );

        $rows = $this->auditRows();
        $actions = $rows->pluck('action')->all();

        self::assertContains(
            'listing_vetting_requirement_clear_authorised',
            $actions,
            'the run is recorded BEFORE anything changes, so a run that dies part-way still leaves a record'
        );
        self::assertContains(
            'listing_vetting_requirement_clear_completed',
            $actions,
            'the outcome of the run is recorded'
        );

        foreach (['listing_vetting_requirement_clear_authorised', 'listing_vetting_requirement_clear_completed'] as $action) {
            $entry = $rows->firstWhere('action', $action);
            self::assertNotNull($entry, $action . ': the record exists');
            self::assertSame((int) $entry->tenant_id, $this->tenantId, $action . ': scoped to the community');

            $payload = json_decode((string) $entry->new_value, true);
            self::assertIsArray($payload, $action . ': the record is structured');
            self::assertSame(self::ACTOR, $payload['actor'] ?? null, $action . ': the operator is named');
            self::assertSame(
                (string) $this->tenantId,
                (string) ($payload['scope'] ?? ''),
                $action . ': the scope the run covered is stated'
            );
        }

        $completed = $rows->firstWhere('action', 'listing_vetting_requirement_clear_completed');
        $payload = json_decode((string) $completed->new_value, true);
        self::assertSame(
            1,
            (int) ($payload['counts']['listing_requirements_cleared'] ?? -1),
            'the number of listings that lost the requirement is recorded'
        );
    }

    /**
     * CONTROL (the existing guards still refuse, and a refused run is not an
     * event) — a wrong acknowledgement still changes nothing and records
     * nothing.
     */
    public function test_a_refused_run_changes_nothing_and_records_nothing(): void
    {
        $listingId = $this->listingWithVettingRequirement();
        $before = $this->auditRows()->count();

        $this->runApply(['--acknowledge' => 'WRONG-PHRASE'])->assertExitCode(1);

        self::assertSame(1, $this->requirementFlag($listingId), 'control: the requirement is untouched');
        self::assertSame($before, $this->auditRows()->count(), 'control: a refused run writes no record');
    }

    /**
     * F-427 — the clear is refused when no operator is named: nothing else on a
     * CLI run can answer "who did this", which is the first thing a community
     * asks when a safeguarding requirement disappears.
     */
    public function test_the_clear_is_refused_when_no_operator_is_named(): void
    {
        $listingId = $this->listingWithVettingRequirement();
        $before = $this->auditRows()->count();

        $this->runApply(['--actor' => ''])->assertExitCode(2);

        self::assertSame(1, $this->requirementFlag($listingId), 'nothing was cleared');
        self::assertSame($before, $this->auditRows()->count(), 'and nothing was recorded');
    }

    /**
     * CONTROL (the read-only mode is still read-only) — the report a community
     * runs to see what exists changes nothing and is not an auditable event.
     */
    public function test_the_report_only_mode_changes_nothing_and_records_nothing(): void
    {
        $listingId = $this->listingWithVettingRequirement();
        $before = $this->auditRows()->count();

        $this->artisan('safeguarding:audit-listing-vetting-flags', [
            '--tenant' => (string) $this->tenantId,
        ])->assertExitCode(0);

        self::assertSame(1, $this->requirementFlag($listingId), 'control: the report changes nothing');
        self::assertSame($before, $this->auditRows()->count(), 'control: and records nothing');
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    /** @param array<string, mixed> $extra */
    private function runApply(array $extra = []): \Illuminate\Testing\PendingCommand
    {
        /** @var \Illuminate\Testing\PendingCommand $pending */
        $pending = $this->artisan('safeguarding:audit-listing-vetting-flags', array_merge([
            '--tenant' => (string) $this->tenantId,
            '--apply' => true,
            '--actor' => self::ACTOR,
            '--acknowledge' => AuditLegacyListingVettingRequirements::ACKNOWLEDGEMENT,
        ], $extra));

        return $pending;
    }

    private function requirementFlag(int $listingId): int
    {
        return (int) DB::table('listing_risk_tags')
            ->where('tenant_id', $this->tenantId)
            ->where('listing_id', $listingId)
            ->value('dbs_required');
    }

    /** @return \Illuminate\Support\Collection<int, object> */
    private function auditRows(): \Illuminate\Support\Collection
    {
        return DB::table('gdpr_audit_log')
            ->where('tenant_id', $this->tenantId)
            ->orderBy('id')
            ->get();
    }

    private function listingWithVettingRequirement(): int
    {
        $listingId = (int) DB::table('listings')->insertGetId([
            'tenant_id' => $this->tenantId,
            'user_id' => $this->ownerId,
            'title' => 'F427 synthetic listing',
            'description' => 'F427 synthetic listing description.',
            'type' => 'offer',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        DB::table('listing_risk_tags')->insert([
            'tenant_id' => $this->tenantId,
            'listing_id' => $listingId,
            'dbs_required' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $listingId;
    }
}
