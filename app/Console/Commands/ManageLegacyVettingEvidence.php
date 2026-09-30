<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LegacyVettingEvidenceManager;
use App\Services\VolunteerCredentialPolicy;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Inventory retired vetting upload paths without inspecting file content.
 *
 * Deletion is deliberately cumbersome: it requires an explicit tenant scope
 * (or all-tenants scope), a named operator, a DPO authorisation reference, and
 * a fixed confirmation phrase. Nothing is deleted in the default mode.
 *
 * 🔴 F-409 — every destructive run is now recorded in `gdpr_audit_log`, twice:
 * an `..._authorised` row written BEFORE anything is touched (so a run that
 * dies part-way still leaves evidence that it happened) and a `..._completed`
 * row carrying the counts and the outcome. Until this was added the command
 * unlinked evidence files, nulled `vetting_records` metadata and hard-deleted
 * `vol_credentials` rows while writing nothing anywhere, and the
 * `--dpo-authorisation` reference it demanded was checked for non-emptiness
 * and then discarded. A community could not be told what had been destroyed on
 * its behalf, and a wrong or malicious run looked exactly like a correct one.
 *
 * If the audit record cannot be written, nothing is destroyed. That ordering is
 * the point: no record, no destruction.
 */
class ManageLegacyVettingEvidence extends Command
{
    public const CONFIRMATION_PHRASE = 'DELETE-LEGACY-VETTING-EVIDENCE';

    /** Audit table the destructive run is recorded in. */
    private const AUDIT_TABLE = 'gdpr_audit_log';
    private const AUDIT_ENTITY_TYPE = 'legacy_vetting_evidence';
    private const AUDIT_ACTION_AUTHORISED = 'legacy_vetting_evidence_destruction_authorised';
    private const AUDIT_ACTION_COMPLETED = 'legacy_vetting_evidence_destruction_completed';

    /**
     * Evidence-content fields that are prohibited in the replacement
     * metadata-only attestation model. Decision audit fields such as scheme,
     * status, actor, and confirmation time are intentionally not included.
     *
     * @var array<string, null|int>
     */
    private const LEGACY_SENSITIVE_METADATA_REDACTIONS = [
        'reference_number' => null,
        'issue_date' => null,
        'expiry_date' => null,
        'notes' => null,
        'rejection_reason' => null,
        'works_with_children' => 0,
        'works_with_vulnerable_adults' => 0,
        'requires_enhanced_check' => 0,
    ];

    protected $signature = 'safeguarding:legacy-vetting-evidence
        {--tenant= : Limit inventory/cleanup to one tenant ID}
        {--all-tenants : Explicitly select every tenant and the unscoped legacy root}
        {--show-paths : Print relative file paths (may itself be sensitive)}
        {--delete : Delete inventoried evidence, clear verified-local pointers, and redact prohibited legacy metadata}
        {--actor= : Required operator identity recorded against a --delete run}
        {--dpo-authorisation= : Required DPO approval/ticket reference for --delete}
        {--confirm= : Required exact destructive confirmation phrase for --delete}';

    protected $description = 'Inventory legacy vetting evidence and prohibited metadata; clean only with explicit DPO-authorised flags';

    public function __construct(
        private readonly LegacyVettingEvidenceManager $evidence,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $scope = $this->resolveScope();
        if ($scope === false) {
            return self::INVALID;
        }

        $delete = (bool) $this->option('delete');
        if ($delete && ! $this->destructiveFlagsAreValid($scope['tenant_id'])) {
            return self::INVALID;
        }

        $entries = $this->evidence->inventory($scope['tenant_slug']);
        $pointers = $this->databasePointers($scope['tenant_id']);
        $sensitiveMetadataRows = $this->legacySensitiveMetadataRows($scope['tenant_id']);
        $volunteerPointers = $this->volunteerCredentialPointers($scope['tenant_id']);
        $volunteerManualReviewRows = $this->volunteerCredentialManualReviewRows($scope['tenant_id']);
        $externalPointers = $pointers
            ->filter(fn (object $row): bool => $this->evidence->isExternalPointer((string) $row->document_url))
            ->count();

        $this->components->info($delete
            ? 'DPO-authorised destructive mode selected.'
            : 'INVENTORY mode: no files or database rows will be changed.');
        $this->line('Scope: ' . $scope['label']);

        $byRoot = collect($entries)
            ->groupBy('root_label')
            ->map(static fn (Collection $rows): int => $rows->count());
        $rootRows = $byRoot->map(
            static fn (int $count, string $root): array => [$root, $count],
        )->values()->all();
        if ($rootRows === []) {
            $rootRows[] = ['(no evidence roots found)', 0];
        }
        $this->table(['Evidence root', 'Files'], $rootRows);

        if ((bool) $this->option('show-paths') && $entries !== []) {
            $this->components->warn('Relative paths can contain personal data; keep this output inside the approved DPO case.');
            $this->table(
                ['Root', 'Relative path', 'Bytes'],
                array_map(static fn (array $entry): array => [
                    $entry['root_label'],
                    $entry['relative_path'],
                    $entry['bytes'],
                ], $entries),
            );
        }

        $this->table(['Database pointer metric', 'Count'], [
            ['legacy document_url pointers', $pointers->count()],
            ['legacy rows containing prohibited metadata', $sensitiveMetadataRows->count()],
            ['external pointers requiring separate provider cleanup', $externalPointers],
            ['retired volunteering credential rows', $volunteerPointers->count()],
            ['unknown volunteering credential rows requiring manual review', $volunteerManualReviewRows->count()],
        ]);

        if ((bool) $this->option('show-paths') && $volunteerPointers->isNotEmpty()) {
            $this->components->warn('Retired volunteering credential paths are removal-only personal data.');
            $this->table(
                ['Tenant', 'Private relative path'],
                $volunteerPointers->map(fn (object $pointer): array => [
                    (int) $pointer->tenant_id,
                    $this->evidence->privateCredentialRelativePath(
                        (string) ($pointer->file_url ?? ''),
                        (int) $pointer->tenant_id,
                    ) ?? '(unrecognised pointer)',
                ])->all(),
            );
        }

        if (! $delete) {
            $this->components->warn(
                'No deletion performed. Follow the local DPO runbook before using --delete.'
            );

            return self::SUCCESS;
        }

        if ($sensitiveMetadataRows->isNotEmpty()
            && ! Schema::hasColumn('vetting_records', LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN)) {
            $this->components->error(
                'Cleanup refused: the durable legacy redaction marker column is missing. Run database migrations first.'
            );

            return self::FAILURE;
        }

        // F-409: recorded BEFORE the first irreversible act, so a run that dies
        // part-way through still leaves proof that it started and under whose
        // authority. The counts here are what the run intends to destroy.
        $this->recordDestructiveRun(self::AUDIT_ACTION_AUTHORISED, $scope, [
            'phase' => 'authorised',
            'planned' => [
                'evidence_files' => count($entries),
                'legacy_document_pointers' => $pointers->count(),
                'legacy_rows_with_prohibited_metadata' => $sensitiveMetadataRows->count(),
                'retired_volunteering_credential_rows' => $volunteerPointers->count(),
            ],
        ]);

        $deletion = $this->evidence->deleteInventoried($entries);
        $clearedPointers = 0;
        $outstandingPointers = 0;
        $retiredCredentialRowsDeleted = 0;
        $privateDeleted = 0;
        $privateMissing = 0;
        $privateRefused = 0;
        $privateFailed = 0;
        $sensitiveMetadataRowsRedacted = 0;

        foreach ($pointers as $pointer) {
            $url = (string) $pointer->document_url;
            if (! $this->evidence->localPointerIsAbsent($url, $scope['tenant_slug'])) {
                $outstandingPointers++;
                continue;
            }

            $clearedPointers += DB::table('vetting_records')
                ->where('id', (int) $pointer->id)
                ->where('tenant_id', (int) $pointer->tenant_id)
                ->where('document_url', $url)
                ->update([
                    'document_url' => null,
                    'updated_at' => now(),
                ]);
        }

        $redactions = $this->availableSensitiveMetadataRedactions();
        if ($sensitiveMetadataRows->isNotEmpty()) {
            $redactions[LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN] = 1;
        }
        if (Schema::hasColumn('vetting_records', 'updated_at')) {
            $redactions['updated_at'] = now();
        }
        foreach ($sensitiveMetadataRows as $row) {
            $sensitiveMetadataRowsRedacted += DB::table('vetting_records')
                ->where('id', (int) $row->id)
                ->where('tenant_id', (int) $row->tenant_id)
                ->update($redactions);
        }

        foreach ($volunteerPointers as $pointer) {
            $outcome = $this->evidence->deletePrivateCredentialPointer(
                (string) ($pointer->file_url ?? ''),
                (int) $pointer->tenant_id,
            );
            match ($outcome) {
                'deleted' => $privateDeleted++,
                'missing' => $privateMissing++,
                'refused' => $privateRefused++,
                default => $privateFailed++,
            };

            if (! in_array($outcome, ['deleted', 'missing'], true)) {
                continue;
            }

            $retiredCredentialRowsDeleted += DB::table('vol_credentials')
                ->where('id', (int) $pointer->id)
                ->where('tenant_id', (int) $pointer->tenant_id)
                ->where(function (Builder $query): void {
                    $this->constrainRetiredVolunteerCredential($query);
                })
                ->delete();
        }

        $counts = [
            'files_deleted' => $deletion['deleted'],
            'files_already_missing' => $deletion['missing'],
            'paths_refused_by_containment_checks' => $deletion['refused'],
            'file_deletions_failed' => $deletion['failed'],
            'local_database_pointers_cleared' => $clearedPointers,
            'database_pointers_still_requiring_review' => $outstandingPointers,
            'legacy_rows_metadata_redacted' => $sensitiveMetadataRowsRedacted,
            'retired_volunteering_credential_files_deleted' => $privateDeleted,
            'retired_volunteering_credential_files_already_missing' => $privateMissing,
            'retired_volunteering_credential_paths_refused' => $privateRefused,
            'retired_volunteering_credential_deletions_failed' => $privateFailed,
            'retired_volunteering_credential_rows_deleted' => $retiredCredentialRowsDeleted,
        ];

        $this->table(['Cleanup metric', 'Count'], [
            ['files deleted', $deletion['deleted']],
            ['files already missing', $deletion['missing']],
            ['paths refused by containment checks', $deletion['refused']],
            ['file deletions failed', $deletion['failed']],
            ['local database pointers cleared', $clearedPointers],
            ['database pointers still requiring review', $outstandingPointers],
            ['legacy rows with prohibited metadata redacted', $sensitiveMetadataRowsRedacted],
            ['retired volunteering credential files deleted', $privateDeleted],
            ['retired volunteering credential files already missing', $privateMissing],
            ['retired volunteering credential paths refused', $privateRefused],
            ['retired volunteering credential deletions failed', $privateFailed],
            ['retired volunteering credential rows deleted', $retiredCredentialRowsDeleted],
        ]);

        $incomplete = $deletion['refused'] > 0
            || $deletion['failed'] > 0
            || $outstandingPointers > 0
            || $privateRefused > 0
            || $privateFailed > 0;

        // F-409: recorded whether the run finished cleanly or not — an
        // incomplete destruction is exactly the state a community most needs a
        // record of.
        $this->recordDestructiveRun(self::AUDIT_ACTION_COMPLETED, $scope, [
            'phase' => 'completed',
            'outcome' => $incomplete ? 'incomplete' : 'complete',
            'counts' => $counts,
        ]);

        if ($incomplete) {
            $this->components->error(
                'Cleanup is incomplete. Preserve the DPO case and resolve refused, failed, external, or unrecognised paths.'
            );

            return self::FAILURE;
        }

        $this->components->info('Scoped local evidence cleanup completed. Validate backups/CDN copies before closure.');

        return self::SUCCESS;
    }

    /**
     * @return array{tenant_id: int|null, tenant_slug: string|null, label: string}|false
     */
    private function resolveScope(): array|false
    {
        $rawTenant = trim((string) ($this->option('tenant') ?? ''));
        $allTenants = (bool) $this->option('all-tenants');

        if ($rawTenant !== '' && $allTenants) {
            $this->error('Use either --tenant or --all-tenants, never both.');

            return false;
        }
        if ($rawTenant === '') {
            return [
                'tenant_id' => null,
                'tenant_slug' => null,
                'label' => $allTenants ? 'all tenants (explicit)' : 'all roots (inventory only)',
            ];
        }
        if (! ctype_digit($rawTenant) || (int) $rawTenant <= 0) {
            $this->error('--tenant must be a positive integer.');

            return false;
        }

        $tenant = DB::table('tenants')
            ->where('id', (int) $rawTenant)
            ->select(['id', 'slug'])
            ->first();
        if ($tenant === null || ! is_string($tenant->slug) || trim($tenant->slug) === '') {
            $this->error('The selected tenant does not exist or has no safe upload slug.');

            return false;
        }

        return [
            'tenant_id' => (int) $tenant->id,
            'tenant_slug' => (string) $tenant->slug,
            'label' => 'tenant ID ' . (int) $tenant->id,
        ];
    }

    private function destructiveFlagsAreValid(?int $tenantId): bool
    {
        if ($tenantId === null && ! (bool) $this->option('all-tenants')) {
            $this->error('--delete requires either --tenant=<id> or --all-tenants.');

            return false;
        }

        // F-409: the audit record has to be able to answer "who ran this".
        // Nothing else on a CLI run can — inside the container every process is
        // www-data — so the operator names themselves or the run is refused.
        if ($this->operatorIdentity() === '') {
            $this->error('--delete requires a non-empty --actor operator identity for the audit record.');

            return false;
        }

        $authorisation = trim((string) ($this->option('dpo-authorisation') ?? ''));
        if ($authorisation === '') {
            $this->error('--delete requires a non-empty --dpo-authorisation approval/ticket reference.');

            return false;
        }

        if ((string) ($this->option('confirm') ?? '') !== self::CONFIRMATION_PHRASE) {
            $this->error('--confirm must exactly equal ' . self::CONFIRMATION_PHRASE . '.');

            return false;
        }

        if (! Schema::hasTable(self::AUDIT_TABLE)) {
            $this->error(
                'Cleanup refused: the ' . self::AUDIT_TABLE . ' audit table is missing, so the destruction could not be recorded.'
            );

            return false;
        }

        return true;
    }

    private function operatorIdentity(): string
    {
        return trim((string) ($this->option('actor') ?? ''));
    }

    private function dpoAuthorisation(): string
    {
        return trim((string) ($this->option('dpo-authorisation') ?? ''));
    }

    /**
     * Write one durable record of a destructive run. Deliberately NOT wrapped in
     * a swallowing catch: if the destruction cannot be recorded, the caller must
     * stop rather than proceed unrecorded (see the class docblock).
     *
     * `gdpr_audit_log` is the platform's existing erasure/minimisation trail —
     * the same table `GdprService::logAction()` writes to — so this run appears
     * alongside the other data-protection actions a community can be shown.
     *
     * @param array{tenant_id: int|null, tenant_slug: string|null, label: string} $scope
     * @param array<string, mixed>                                                $payload
     */
    private function recordDestructiveRun(string $action, array $scope, array $payload): void
    {
        DB::table(self::AUDIT_TABLE)->insert([
            // `tenant_id` is NOT NULL; 0 denotes the explicit all-tenants scope,
            // which the `scope` key below states in words.
            'tenant_id' => $scope['tenant_id'] ?? 0,
            'user_id' => null,
            'admin_id' => null,
            'action' => $action,
            'entity_type' => self::AUDIT_ENTITY_TYPE,
            'entity_id' => $scope['tenant_id'],
            'new_value' => json_encode(array_merge([
                'actor' => $this->operatorIdentity(),
                'dpo_authorisation' => $this->dpoAuthorisation(),
                'scope' => $scope['label'],
                'tenant_id' => $scope['tenant_id'],
            ], $payload), JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES),
            'created_at' => now(),
        ]);
    }

    /** @return Collection<int, object> */
    private function databasePointers(?int $tenantId): Collection
    {
        if (! Schema::hasTable('vetting_records') || ! Schema::hasColumn('vetting_records', 'document_url')) {
            return collect();
        }

        $query = DB::table('vetting_records')
            ->whereNotNull('document_url')
            ->where('document_url', '!=', '')
            ->select(['id', 'tenant_id', 'document_url']);

        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy('tenant_id')->orderBy('id')->get();
    }

    /** @return Collection<int, object> */
    private function legacySensitiveMetadataRows(?int $tenantId): Collection
    {
        $redactions = $this->availableSensitiveMetadataRedactions();
        if (! Schema::hasTable('vetting_records') || $redactions === []) {
            return collect();
        }

        $query = DB::table('vetting_records')
            ->select(['id', 'tenant_id'])
            ->where(function ($query) use ($redactions): void {
                foreach ($redactions as $column => $replacement) {
                    if ($replacement === 0) {
                        $query->orWhere($column, '!=', 0);
                    } else {
                        $query->orWhereNotNull($column);
                    }
                }
            });

        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy('tenant_id')->orderBy('id')->get();
    }

    /** @return array<string, null|int> */
    private function availableSensitiveMetadataRedactions(): array
    {
        if (! Schema::hasTable('vetting_records')) {
            return [];
        }

        return array_filter(
            self::LEGACY_SENSITIVE_METADATA_REDACTIONS,
            static fn (mixed $_replacement, string $column): bool => Schema::hasColumn('vetting_records', $column),
            ARRAY_FILTER_USE_BOTH,
        );
    }

    /** @return Collection<int, object> */
    private function volunteerCredentialPointers(?int $tenantId): Collection
    {
        if (! Schema::hasTable('vol_credentials')) {
            return collect();
        }

        $query = DB::table('vol_credentials')
            ->where(function (Builder $query): void {
                $this->constrainRetiredVolunteerCredential($query);
            })
            ->select(['id', 'tenant_id', 'file_url']);

        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy('tenant_id')->orderBy('id')->get();
    }

    /** @return Collection<int, object> */
    private function volunteerCredentialManualReviewRows(?int $tenantId): Collection
    {
        if (! Schema::hasTable('vol_credentials')) {
            return collect();
        }

        $normalisedType = DB::raw('LOWER(TRIM(credential_type))');
        $query = DB::table('vol_credentials')
            ->whereNotIn($normalisedType, VolunteerCredentialPolicy::ALLOWED_TYPES)
            ->whereNotIn($normalisedType, VolunteerCredentialPolicy::PROHIBITED_VETTING_TYPES)
            ->where(function (Builder $query): void {
                $query->whereNull('notes')
                    ->orWhere('notes', '!=', LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER);
            })
            ->select(['id', 'tenant_id']);

        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }

        return $query->orderBy('tenant_id')->orderBy('id')->get();
    }

    private function constrainRetiredVolunteerCredential(Builder $query): void
    {
        $query->whereIn(
            DB::raw('LOWER(TRIM(credential_type))'),
            VolunteerCredentialPolicy::PROHIBITED_VETTING_TYPES,
        )->orWhere('notes', LegacyVettingEvidenceManager::GDPR_CLEANUP_PENDING_MARKER);
    }
}
