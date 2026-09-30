<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E069;

use App\Console\Commands\ManageLegacyVettingEvidence;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-409 — `safeguarding:legacy-vetting-evidence --delete` must leave a durable
 * record of every destructive run.
 *
 * The command unlinked evidence files, nulled `vetting_records` metadata and
 * hard-deleted `vol_credentials` rows while writing nothing to any audit table,
 * and the `--dpo-authorisation` reference it demands was read, checked for
 * non-emptiness, and then discarded. After a run there was no way to say who
 * ran it, when, over which community, under which approval, or how much was
 * destroyed.
 *
 * Correct behaviour, asserted here: the destruction is bracketed by two
 * `gdpr_audit_log` rows — an "authorised" row written BEFORE anything is
 * touched (so a crash mid-destruction still leaves a record) and a "completed"
 * row carrying the counts — both naming the operator and the DPO reference;
 * the run is refused outright when no operator is named; and the existing
 * confirmation-phrase guard still refuses and still writes nothing.
 */
final class F409LegacyVettingEvidenceDestructionIsAuditedTest extends TestCase
{
    use DatabaseTransactions;

    private const DPO_REFERENCE = 'F409-DPO-REFERENCE-0001';
    private const ACTOR = 'F409 Operator (dpo-case-0001)';

    private int $tenantId = 0;
    private int $memberId = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenantId = (int) DB::table('tenants')->insertGetId([
            'name' => 'F409 Evidence Community',
            // A fresh random slug guarantees no vetting/documents directory
            // exists on disk, so this test never unlinks a real file.
            'slug' => 'f409-ev-' . bin2hex(random_bytes(4)),
            'is_active' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->memberId = (int) DB::table('users')->insertGetId([
            'tenant_id' => $this->tenantId,
            'email' => 'f409-ev-' . bin2hex(random_bytes(5)) . '@example.invalid',
            'password' => password_hash('not-a-real-password-' . bin2hex(random_bytes(8)), PASSWORD_BCRYPT),
            'first_name' => 'F409',
            'last_name' => 'Evidence',
            'name' => 'F409 Evidence',
            'role' => 'member',
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function seedLegacyVettingRecord(): int
    {
        return (int) DB::table('vetting_records')->insertGetId([
            'tenant_id' => $this->tenantId,
            'user_id' => $this->memberId,
            'vetting_type' => 'dbs_enhanced',
            'status' => 'verified',
            'reference_number' => 'F409-SYNTHETIC-REF',
            'issue_date' => '2024-01-01',
            'expiry_date' => '2027-01-01',
            'notes' => 'F409 synthetic broker note.',
            'rejection_reason' => null,
            'works_with_children' => 1,
            'works_with_vulnerable_adults' => 1,
            'requires_enhanced_check' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return \Illuminate\Support\Collection<int, object> */
    private function auditRows(): \Illuminate\Support\Collection
    {
        return DB::table('gdpr_audit_log')
            ->where('tenant_id', $this->tenantId)
            ->orderBy('id')
            ->get();
    }

    /** @param array<string, mixed> $extra */
    private function runDelete(array $extra = []): \Illuminate\Testing\PendingCommand
    {
        /** @var \Illuminate\Testing\PendingCommand $pending */
        $pending = $this->artisan('safeguarding:legacy-vetting-evidence', array_merge([
            '--tenant' => (string) $this->tenantId,
            '--delete' => true,
            '--dpo-authorisation' => self::DPO_REFERENCE,
            '--actor' => self::ACTOR,
            '--confirm' => ManageLegacyVettingEvidence::CONFIRMATION_PHRASE,
        ], $extra));

        return $pending;
    }

    /**
     * The existing guard still works: without the confirmation phrase nothing
     * is destroyed and nothing is written to the audit log either — a refused
     * run is not an event.
     */
    public function test_the_destructive_guard_still_refuses_without_the_confirmation_phrase(): void
    {
        $id = $this->seedLegacyVettingRecord();
        $before = $this->auditRows()->count();

        $this->runDelete(['--confirm' => 'WRONG-PHRASE'])->assertExitCode(2);

        $row = DB::table('vetting_records')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('F409-SYNTHETIC-REF', (string) $row->reference_number, 'nothing was redacted');
        $this->assertSame(1, (int) $row->works_with_children, 'nothing was zeroed');
        $this->assertSame($before, $this->auditRows()->count(), 'a refused run writes no audit row');
    }

    /**
     * F-409 — an authorised destructive run writes a durable audit record
     * naming the operator, the DPO reference, the community and the counts.
     */
    public function test_an_authorised_destructive_run_is_recorded_with_operator_dpo_reference_and_counts(): void
    {
        $id = $this->seedLegacyVettingRecord();

        $this->runDelete()->assertExitCode(0);

        // The destruction really happened (the row is minimised, not deleted).
        $row = DB::table('vetting_records')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertNull($row->reference_number, 'the certificate reference was destroyed');
        $this->assertSame(1, (int) $row->legacy_sensitive_metadata_redacted, 'the redaction marker was stamped');

        $rows = $this->auditRows();
        $actions = $rows->pluck('action')->all();

        $this->assertContains(
            'legacy_vetting_evidence_destruction_authorised',
            $actions,
            'the run is recorded BEFORE anything is destroyed, so a crash mid-run still leaves a record',
        );
        $this->assertContains(
            'legacy_vetting_evidence_destruction_completed',
            $actions,
            'the outcome of the run is recorded',
        );

        foreach (['legacy_vetting_evidence_destruction_authorised', 'legacy_vetting_evidence_destruction_completed'] as $action) {
            $entry = $rows->firstWhere('action', $action);
            $this->assertNotNull($entry);
            $this->assertSame($this->tenantId, (int) $entry->tenant_id, "{$action}: scoped to the community");

            $payload = json_decode((string) $entry->new_value, true);
            $this->assertIsArray($payload, "{$action}: the audit payload is structured");
            $this->assertSame(self::ACTOR, $payload['actor'] ?? null, "{$action}: the operator is named");
            $this->assertSame(
                self::DPO_REFERENCE,
                $payload['dpo_authorisation'] ?? null,
                "{$action}: the DPO approval reference is persisted",
            );
        }

        $completed = $rows->firstWhere('action', 'legacy_vetting_evidence_destruction_completed');
        $counts = json_decode((string) $completed->new_value, true)['counts'] ?? null;
        $this->assertIsArray($counts, 'the completed record carries the counts');
        $this->assertSame(
            1,
            (int) ($counts['legacy_rows_metadata_redacted'] ?? -1),
            'the number of safeguarding records redacted is recorded',
        );
    }

    /**
     * F-409 — the destructive run is refused when no operator is named. Without
     * it the audit record cannot answer "who ran this", which is the first
     * thing a regulator or a public-sector customer asks.
     */
    public function test_the_destructive_run_is_refused_when_no_operator_is_named(): void
    {
        $id = $this->seedLegacyVettingRecord();
        $before = $this->auditRows()->count();

        $this->runDelete(['--actor' => ''])->assertExitCode(2);

        $row = DB::table('vetting_records')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('F409-SYNTHETIC-REF', (string) $row->reference_number, 'nothing was destroyed');
        $this->assertSame($before, $this->auditRows()->count(), 'and nothing was recorded');
    }

    /**
     * Inventory mode is read-only and must stay that way — it is the mode a
     * community runs to see what exists, and it is not an auditable event.
     */
    public function test_inventory_mode_changes_nothing_and_writes_no_audit_row(): void
    {
        $id = $this->seedLegacyVettingRecord();
        $before = $this->auditRows()->count();

        $this->artisan('safeguarding:legacy-vetting-evidence', [
            '--tenant' => (string) $this->tenantId,
        ])->assertExitCode(0);

        $row = DB::table('vetting_records')->where('id', $id)->first();
        $this->assertNotNull($row);
        $this->assertSame('F409-SYNTHETIC-REF', (string) $row->reference_number);
        $this->assertSame($before, $this->auditRows()->count());
    }
}
