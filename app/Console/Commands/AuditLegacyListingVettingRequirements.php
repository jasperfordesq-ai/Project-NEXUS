<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Quarantine the old listing-level DBS boolean until a lawful, purpose-scoped
 * role attestation workflow exists. The messenger attestation is never reused.
 *
 * 🔴 F-427 — every `--apply` run is recorded in `gdpr_audit_log`, twice: an
 * `..._authorised` row written BEFORE anything changes (so a run that dies
 * part-way still leaves evidence that it happened) and a `..._completed` row
 * carrying the counts. Until this was added the command switched a safeguarding
 * requirement off across listings — with `--all-tenants`, every community in one
 * transaction — and wrote nothing anywhere, so a community could not be told who
 * removed the requirement, when, or from how many listings, and a wrong run
 * looked exactly like a correct one. Same class as F-409, same shape.
 *
 * If the audit record cannot be written, nothing is changed. That ordering is
 * the point: no record, no change.
 */
class AuditLegacyListingVettingRequirements extends Command
{
    public const ACKNOWLEDGEMENT = 'CLEAR_UNSUPPORTED_ROLE_FLAGS';

    /** Audit table the corrective run is recorded in. */
    private const AUDIT_TABLE = 'gdpr_audit_log';
    private const AUDIT_ENTITY_TYPE = 'listing_vetting_requirement';
    private const AUDIT_ACTION_AUTHORISED = 'listing_vetting_requirement_clear_authorised';
    private const AUDIT_ACTION_COMPLETED = 'listing_vetting_requirement_clear_completed';

    protected $signature = 'safeguarding:audit-listing-vetting-flags
        {--tenant= : Optional tenant ID}
        {--all-tenants : Explicitly select every tenant for corrective apply}
        {--apply : Clear unsupported dbs_required flags}
        {--actor= : Required operator identity recorded against an --apply run}
        {--acknowledge= : Required exact acknowledgement for --apply}';

    protected $description = 'Report legacy listing DBS flags that have no supported role-specific attestation workflow';

    public function handle(): int
    {
        $rawTenant = trim((string) ($this->option('tenant') ?? ''));
        $allTenants = (bool) $this->option('all-tenants');
        if ($rawTenant !== '' && $allTenants) {
            $this->error('Use either --tenant or --all-tenants, never both.');
            return self::INVALID;
        }
        if ($rawTenant !== '' && (! ctype_digit($rawTenant) || (int) $rawTenant <= 0)) {
            $this->error('--tenant must be a positive integer.');
            return self::INVALID;
        }
        $tenantId = $rawTenant !== '' ? (int) $rawTenant : null;

        $query = DB::table('listing_risk_tags as rt')
            ->join('listings as l', function ($join): void {
                $join->on('l.id', '=', 'rt.listing_id')->on('l.tenant_id', '=', 'rt.tenant_id');
            })
            ->where('rt.dbs_required', 1)
            ->orderBy('rt.tenant_id')
            ->orderBy('rt.listing_id');
        if ($tenantId !== null) {
            $query->where('rt.tenant_id', $tenantId);
        }
        $rows = $query->get(['rt.tenant_id', 'rt.listing_id', 'l.title']);

        $this->table(
            ['Tenant ID', 'Listing ID', 'Title'],
            $rows->map(static fn ($row): array => [
                (int) $row->tenant_id,
                (int) $row->listing_id,
                (string) $row->title,
            ])->all(),
        );
        $this->info("Unsupported listing role flags: {$rows->count()}");

        if (! $this->option('apply')) {
            $this->comment('Dry run only. Existing flags remain fail-closed and no rows were changed.');
            return self::SUCCESS;
        }
        if ($tenantId === null && ! $allTenants) {
            $this->error('Corrective apply requires --tenant=<id> or --all-tenants.');
            return self::INVALID;
        }
        // F-427: the audit record has to be able to answer "who ran this".
        // Nothing else on a CLI run can — inside the container every process is
        // www-data — so the operator names themselves or the run is refused.
        $actor = trim((string) ($this->option('actor') ?? ''));
        if ($actor === '') {
            $this->error('--apply requires a non-empty --actor operator identity for the audit record.');
            return self::INVALID;
        }
        if ((string) $this->option('acknowledge') !== self::ACKNOWLEDGEMENT) {
            $this->error('Refusing apply: use --acknowledge=' . self::ACKNOWLEDGEMENT);
            return self::FAILURE;
        }
        if (! Schema::hasTable(self::AUDIT_TABLE)) {
            $this->error(
                'Refusing apply: the ' . self::AUDIT_TABLE . ' audit table is missing, so the change could not be recorded.'
            );
            return self::FAILURE;
        }

        $scope = $tenantId !== null ? (string) $tenantId : 'all-tenants';
        $affectedTenantIds = $rows->map(static fn ($row): int => (int) $row->tenant_id)->unique()->values()->all();

        // F-427: recorded BEFORE the first change, so a run that dies part-way
        // through still leaves proof that it started and under whose authority.
        $this->recordCorrectiveRun(self::AUDIT_ACTION_AUTHORISED, $tenantId, $actor, $scope, [
            'phase' => 'authorised',
            'planned' => [
                'listing_requirements_to_clear' => $rows->count(),
                'communities_affected' => count($affectedTenantIds),
            ],
        ]);

        $cleared = 0;
        DB::transaction(static function () use ($rows, &$cleared): void {
            foreach ($rows as $row) {
                $cleared += DB::table('listing_risk_tags')
                    ->where('tenant_id', (int) $row->tenant_id)
                    ->where('listing_id', (int) $row->listing_id)
                    ->where('dbs_required', 1)
                    ->update(['dbs_required' => 0, 'updated_at' => now()]);
            }
        });

        $this->recordCorrectiveRun(self::AUDIT_ACTION_COMPLETED, $tenantId, $actor, $scope, [
            'phase' => 'completed',
            'counts' => [
                'listing_requirements_cleared' => $cleared,
                'communities_affected' => count($affectedTenantIds),
            ],
            'communities' => $affectedTenantIds,
        ]);

        $this->warn('Unsupported listing role flags cleared. Reintroduce role checks only with a separate purpose-scoped broker workflow.');

        return self::SUCCESS;
    }

    /**
     * Write one durable record of a corrective run. Deliberately NOT wrapped in
     * a swallowing catch: if the change cannot be recorded, the run must stop
     * rather than proceed unrecorded (see the class docblock).
     *
     * `gdpr_audit_log` is the table F-409's sibling fix records destructive
     * safeguarding runs in, so both appear in one place a community can be shown.
     *
     * @param array<string, mixed> $payload
     */
    private function recordCorrectiveRun(
        string $action,
        ?int $tenantId,
        string $actor,
        string $scope,
        array $payload,
    ): void {
        DB::table(self::AUDIT_TABLE)->insert([
            // `tenant_id` is NOT NULL; 0 denotes the explicit all-tenants scope,
            // which the `scope` key below states in words.
            'tenant_id' => $tenantId ?? 0,
            'user_id' => null,
            'admin_id' => null,
            'action' => $action,
            'entity_type' => self::AUDIT_ENTITY_TYPE,
            'entity_id' => $tenantId,
            'new_value' => json_encode(array_merge([
                'actor' => $actor,
                'scope' => $scope,
                'tenant_id' => $tenantId,
            ], $payload), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            'created_at' => now(),
        ]);
    }
}
