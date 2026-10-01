<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Models\MemberVettingAttestation;
use App\Models\SafeguardingVettingReviewRequest;
use App\Services\LegacyVettingEvidenceManager;
use App\Services\SafeguardingJurisdictionService;
use Illuminate\Console\Command;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Convert only strongly-proven legacy Enhanced DBS decisions into the new,
 * metadata-only safeguarding attestation model.
 *
 * Certificate evidence is deliberately outside this command's data contract.
 * It never selects or copies a reference, certificate date, note, result, or
 * file path. Ambiguous legacy rows create a broker review task and confer no
 * access.
 */
class MigrateLegacyVettingAttestations extends Command
{
    private const LEGACY_TYPE = 'dbs_enhanced';
    private const JURISDICTION = 'england_wales';
    private const EVENT_TYPE = 'legacy_imported';
    private const EVENT_REASON = 'trusted_legacy_confirmation';
    public const APPLY_ACKNOWLEDGEMENT = 'IMPORT-LEGACY-VETTING-DECISIONS';

    protected $signature = 'safeguarding:migrate-legacy-vetting-attestations
        {--tenant= : Limit the pass to one tenant ID}
        {--all-tenants : Explicitly select every eligible tenant}
        {--apply : Persist attestations and review requests (default is dry-run)}
        {--acknowledge= : Exact acknowledgement required with --apply}';

    protected $description = 'Dry-run a strict, metadata-only migration of trusted legacy Enhanced DBS decisions';

    public function __construct(
        private readonly SafeguardingJurisdictionService $jurisdictions,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $missing = $this->missingCoreTables();
        if ($missing !== []) {
            $this->error('Required tables are missing: ' . implode(', ', $missing));

            return self::FAILURE;
        }

        $tenantId = $this->parseTenantOption();
        if ($tenantId === false) {
            return self::INVALID;
        }

        $apply = (bool) $this->option('apply');
        if (! $this->scopeAndApplyFlagsAreValid($tenantId, $apply)) {
            return self::INVALID;
        }
        $tenantIds = $this->eligibleTenantIds($tenantId);
        $notEligible = $this->notEligibleTenantCount($tenantId);

        $totals = [
            'eligible_tenants' => count($tenantIds),
            'tenants_not_eligible' => $notEligible,
            'legacy_members_considered' => 0,
            'attestations_imported' => 0,
            'attestations_would_import' => 0,
            'review_requests_created' => 0,
            'review_requests_would_create' => 0,
            'skipped_existing_attestation' => 0,
            'skipped_existing_review' => 0,
        ];

        $this->components->info($apply
            ? 'APPLY mode: persisting strict metadata attestations and review tasks.'
            : 'DRY-RUN mode: no database rows will be written.');

        if ($tenantIds === []) {
            $this->components->warn('No explicitly configured England and Wales tenant is eligible.');
            $this->renderSummary($totals);

            return self::SUCCESS;
        }

        foreach ($tenantIds as $eligibleTenantId) {
            $this->jurisdictions->forget($eligibleTenantId);
            $policy = $this->jurisdictions->getPolicy($eligibleTenantId);
            if (! $this->isExpectedPolicy($policy)) {
                $totals['tenants_not_eligible']++;
                $totals['eligible_tenants']--;
                continue;
            }

            $trustedByMember = $this->trustedLegacyRows($eligibleTenantId)
                ->keyBy(fn (object $row): int => (int) $row->user_id);
            $memberIds = $this->candidateLegacyMemberIds($eligibleTenantId);
            $totals['legacy_members_considered'] += count($memberIds);

            foreach ($memberIds as $memberId) {
                if ($this->currentAttestationQuery($eligibleTenantId, $memberId, $policy)->exists()) {
                    $totals['skipped_existing_attestation']++;
                    continue;
                }

                $trusted = $trustedByMember->get($memberId);
                if ($trusted !== null) {
                    if (! $apply) {
                        $totals['attestations_would_import']++;
                        continue;
                    }

                    if ($this->importTrustedAttestation($eligibleTenantId, $memberId, $trusted, $policy)) {
                        $totals['attestations_imported']++;
                    } else {
                        $totals['skipped_existing_attestation']++;
                    }
                    continue;
                }

                if ($this->reviewRequestQuery($eligibleTenantId, $memberId, $policy)->exists()) {
                    $totals['skipped_existing_review']++;
                    continue;
                }

                if (! $apply) {
                    $totals['review_requests_would_create']++;
                    continue;
                }

                if ($this->createLegacyReviewRequest($eligibleTenantId, $memberId, $policy)) {
                    $totals['review_requests_created']++;
                } else {
                    $totals['skipped_existing_review']++;
                }
            }
        }

        $this->line('Eligible tenant IDs: ' . implode(', ', $tenantIds));
        $this->renderSummary($totals);

        return self::SUCCESS;
    }

    /** @return list<string> */
    private function missingCoreTables(): array
    {
        $required = [
            'tenants',
            'users',
            'vetting_records',
            'tenant_safeguarding_settings',
            'member_vetting_attestations',
            'member_vetting_attestation_events',
            'safeguarding_vetting_review_requests',
        ];

        return array_values(array_filter(
            $required,
            static fn (string $table): bool => ! Schema::hasTable($table),
        ));
    }

    private function parseTenantOption(): int|false|null
    {
        $raw = trim((string) ($this->option('tenant') ?? ''));
        if ($raw === '') {
            return null;
        }
        if (! ctype_digit($raw) || (int) $raw <= 0) {
            $this->error('--tenant must be a positive integer.');

            return false;
        }

        return (int) $raw;
    }

    private function scopeAndApplyFlagsAreValid(?int $tenantId, bool $apply): bool
    {
        $allTenants = (bool) $this->option('all-tenants');
        if ($tenantId !== null && $allTenants) {
            $this->error('Use either --tenant or --all-tenants, never both.');

            return false;
        }
        if (! $apply) {
            return true;
        }
        if ($tenantId === null && ! $allTenants) {
            $this->error('--apply requires either --tenant=<id> or --all-tenants.');

            return false;
        }
        if ((string) ($this->option('acknowledge') ?? '') !== self::APPLY_ACKNOWLEDGEMENT) {
            $this->error('--apply requires --acknowledge=' . self::APPLY_ACKNOWLEDGEMENT . '.');

            return false;
        }

        return true;
    }

    /** @return list<int> */
    private function eligibleTenantIds(?int $tenantId): array
    {
        $query = DB::table('tenant_safeguarding_settings as settings')
            ->join('tenants', 'tenants.id', '=', 'settings.tenant_id')
            ->where('settings.jurisdiction', self::JURISDICTION)
            ->where('tenants.is_active', 1);

        if ($tenantId !== null) {
            $query->where('settings.tenant_id', $tenantId);
        }

        return $query->orderBy('settings.tenant_id')
            ->pluck('settings.tenant_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
    }

    private function notEligibleTenantCount(?int $tenantId): int
    {
        $query = DB::table('tenants')
            ->leftJoin('tenant_safeguarding_settings as settings', 'settings.tenant_id', '=', 'tenants.id')
            ->where('tenants.is_active', 1)
            ->where(function (Builder $builder): void {
                $builder->whereNull('settings.tenant_id')
                    ->orWhere('settings.jurisdiction', '!=', self::JURISDICTION);
            });

        if ($tenantId !== null) {
            $query->where('tenants.id', $tenantId);
        }

        return $query->count();
    }

    /**
     * Selects decision metadata only. Certificate references, issue/expiry
     * values, notes, results, and document paths are never returned.
     *
     * A null-expiry presence predicate is intentionally conservative: legacy
     * records that carry any certificate-date lifecycle are routed to review.
     *
     * 🔴 F-410 — the gate below vets the candidate row thoroughly but used to
     * ask nothing about the REST of that member's history, so an old `verified`
     * row produced `decision = confirmed` even when the same member's later
     * criminal-record check had been rejected or revoked. The words `rejected`
     * and `revoked` appeared nowhere in this command. The minted row carries the
     * tenant-scope contact triple that `SafeguardingInteractionPolicy` reads to
     * ALLOW direct contact with members who declared a safeguarding need. (It
     * does NOT open a DBS-gated listing — that gate asks for `listing_role` /
     * `listing` scope, which this command never writes.)
     *
     * `contradictedByAnotherRecord()` below now routes any such member to the
     * existing broker-review branch, which confers no access. That is the
     * contract this class's own docblock already states: ambiguous legacy rows
     * create a review task.
     *
     * @return Collection<int, object>
     */
    private function trustedLegacyRows(int $tenantId): Collection
    {
        $requiredVettingColumns = [
            'id', 'tenant_id', 'user_id', 'vetting_type', 'status', 'verified_by',
            'verified_at', 'expiry_date', 'deleted_at', 'created_at', 'updated_at',
            LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN,
        ];
        $requiredLogColumns = [
            'tenant_id', 'user_id', 'action', 'action_type', 'entity_type', 'entity_id', 'created_at',
        ];

        if (! Schema::hasTable('activity_log')
            || ! $this->tableHasColumns('vetting_records', $requiredVettingColumns)
            || ! $this->tableHasColumns('activity_log', $requiredLogColumns)) {
            $this->components->warn(
                'Exact per-record verification provenance is unavailable; affected legacy rows will require review.'
            );

            return collect();
        }

        $rows = DB::table('vetting_records as vr')
            ->join('users as member', function ($join): void {
                $join->on('member.id', '=', 'vr.user_id')
                    ->on('member.tenant_id', '=', 'vr.tenant_id');
            })
            ->join('users as verifier', function ($join): void {
                $join->on('verifier.id', '=', 'vr.verified_by')
                    ->on('verifier.tenant_id', '=', 'vr.tenant_id');
            })
            ->where('vr.tenant_id', $tenantId)
            ->where('vr.vetting_type', self::LEGACY_TYPE)
            ->where('vr.status', 'verified')
            ->whereNull('vr.deleted_at')
            ->whereNull('vr.expiry_date')
            ->where('vr.' . LegacyVettingEvidenceManager::LEGACY_REDACTION_MARKER_COLUMN, 0)
            ->whereNotNull('vr.verified_by')
            ->whereNotNull('vr.verified_at')
            ->whereColumn('vr.verified_by', '!=', 'vr.user_id')
            ->where('member.status', 'active')
            ->where('verifier.status', 'active')
            ->where(function (Builder $query): void {
                $query->whereIn('verifier.role', ['broker', 'admin', 'tenant_admin', 'super_admin'])
                    ->orWhere('verifier.is_admin', 1)
                    ->orWhere('verifier.is_tenant_super_admin', 1)
                    ->orWhere('verifier.is_super_admin', 1)
                    ->orWhere('verifier.is_god', 1);
            })
            ->whereExists(function (Builder $query): void {
                $query->selectRaw('1')
                    ->from('activity_log as audit')
                    ->whereColumn('audit.tenant_id', 'vr.tenant_id')
                    ->whereColumn('audit.user_id', 'vr.verified_by')
                    ->whereColumn('audit.entity_id', 'vr.id')
                    ->where('audit.action', 'vetting_record_verified')
                    ->where('audit.action_type', 'admin')
                    ->where('audit.entity_type', 'vetting_record')
                    ->whereRaw(
                        'audit.created_at BETWEEN DATE_SUB(vr.verified_at, INTERVAL 15 MINUTE) '
                        . 'AND DATE_ADD(vr.verified_at, INTERVAL 15 MINUTE)'
                    );
            })
            ->whereNotExists(function (Builder $query): void {
                $this->contradictedByAnotherRecord($query);
            })
            ->select([
                'vr.user_id',
                'vr.verified_by',
                'vr.verified_at',
            ])
            ->orderBy('vr.user_id')
            ->orderByDesc('vr.verified_at')
            ->orderByDesc('vr.id')
            ->get();

        return $rows->unique(static fn (object $row): int => (int) $row->user_id)->values();
    }

    /**
     * F-410 — a legacy `verified` row is only trustworthy if nothing else in the
     * same member's history for the same check type contradicts it. Two things
     * count as a contradiction, and both route the member to broker review
     * rather than to a minted clearance:
     *
     *  1. Any other record with `status` `rejected` or `revoked`, whatever its
     *     date. Legacy imported data carries unreliable ordering, and a refused
     *     or withdrawn criminal-record check anywhere in the history is exactly
     *     the "ambiguous" case this command promises to escalate rather than
     *     decide. `revoked` is also the value the platform's own GDPR erasure
     *     path writes, so it is not a hypothetical.
     *  2. Any other record dated after the trusted row's `verified_at` — a later
     *     check that is pending, submitted or expired means the community has
     *     re-opened the question and has no answer yet. Promoting the old
     *     decision would answer it on their behalf.
     *
     * Deliberately scoped to the SAME tenant, member and `vetting_type`: another
     * community's records, and a different check type, say nothing about this
     * decision.
     */
    private function contradictedByAnotherRecord(Builder $query): void
    {
        $query->selectRaw('1')
            ->from('vetting_records as superseding')
            ->whereColumn('superseding.tenant_id', 'vr.tenant_id')
            ->whereColumn('superseding.user_id', 'vr.user_id')
            ->whereColumn('superseding.vetting_type', 'vr.vetting_type')
            ->whereColumn('superseding.id', '!=', 'vr.id')
            ->whereNull('superseding.deleted_at')
            ->where(function (Builder $contradiction): void {
                $contradiction
                    ->whereIn('superseding.status', ['rejected', 'revoked'])
                    ->orWhereRaw('superseding.created_at > vr.verified_at')
                    ->orWhereRaw('superseding.updated_at > vr.verified_at');
            });
    }

    /** @return list<int> */
    private function candidateLegacyMemberIds(int $tenantId): array
    {
        $query = DB::table('vetting_records as vr')
            ->join('users as member', function ($join): void {
                $join->on('member.id', '=', 'vr.user_id')
                    ->on('member.tenant_id', '=', 'vr.tenant_id');
            })
            ->where('vr.tenant_id', $tenantId)
            ->whereIn('vr.status', ['pending', 'submitted', 'verified', 'expired'])
            ->whereNotIn('member.status', ['deleted', 'deactivated']);

        if (Schema::hasColumn('vetting_records', 'deleted_at')) {
            $query->whereNull('vr.deleted_at');
        }

        return $query->distinct()
            ->orderBy('vr.user_id')
            ->pluck('vr.user_id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
    }

    /** @param array<string, mixed> $policy */
    private function importTrustedAttestation(
        int $tenantId,
        int $memberId,
        object $trusted,
        array $policy,
    ): bool {
        return DB::transaction(function () use ($tenantId, $memberId, $trusted, $policy): bool {
            if ($this->currentAttestationQuery($tenantId, $memberId, $policy)->lockForUpdate()->exists()) {
                return false;
            }

            $now = now();
            $inserted = DB::table('member_vetting_attestations')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'user_id' => $memberId,
                'scheme_code' => $policy['scheme_code'],
                'attestation_code' => $policy['attestation_code'],
                // F-426 — say which check this is a clearance for, the same way
                // the ordinary broker route does.
                'certification_codes' => json_encode($this->certificationCodes($policy), JSON_THROW_ON_ERROR),
                'purpose_code' => $policy['purpose_code'],
                'scope_type' => $policy['scope_type'],
                'scope_identifier' => $policy['scope_identifier'],
                'decision' => MemberVettingAttestation::DECISION_CONFIRMED,
                'confirmed_by' => (int) $trusted->verified_by,
                'confirmed_at' => $trusted->verified_at,
                'revoked_by' => null,
                'revoked_at' => null,
                'revocation_reason_code' => null,
                'policy_version' => $policy['policy_version'],
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            if ($inserted !== 1) {
                return false;
            }

            $attestationId = (int) $this->currentAttestationQuery($tenantId, $memberId, $policy)->value('id');
            if ($attestationId <= 0) {
                throw new \RuntimeException('The imported safeguarding attestation could not be resolved.');
            }

            DB::table('member_vetting_attestation_events')->insert([
                'attestation_id' => $attestationId,
                'tenant_id' => $tenantId,
                'user_id' => $memberId,
                'scheme_code' => $policy['scheme_code'],
                'attestation_code' => $policy['attestation_code'],
                'purpose_code' => $policy['purpose_code'],
                'scope_type' => $policy['scope_type'],
                'scope_identifier' => $policy['scope_identifier'],
                'event_type' => self::EVENT_TYPE,
                'decision_before' => null,
                'decision_after' => MemberVettingAttestation::DECISION_CONFIRMED,
                'reason_code' => self::EVENT_REASON,
                'actor_user_id' => (int) $trusted->verified_by,
                'policy_version' => $policy['policy_version'],
                'created_at' => $now,
            ]);

            DB::table('safeguarding_vetting_review_requests')
                ->where('tenant_id', $tenantId)
                ->where('user_id', $memberId)
                ->where('scheme_code', $policy['scheme_code'])
                ->where('attestation_code', $policy['attestation_code'])
                ->where('purpose_code', $policy['purpose_code'])
                ->where('scope_type', $policy['scope_type'])
                ->where('scope_identifier', $policy['scope_identifier'])
                ->where('policy_version', $policy['policy_version'])
                ->where('status', SafeguardingVettingReviewRequest::STATUS_PENDING)
                ->update([
                    'status' => SafeguardingVettingReviewRequest::STATUS_COMPLETED,
                    'handled_by' => (int) $trusted->verified_by,
                    'handled_at' => $now,
                    'resolution_code' => 'confirmed',
                    'updated_at' => $now,
                ]);

            return true;
        }, 3);
    }

    /** @param array<string, mixed> $policy */
    private function createLegacyReviewRequest(int $tenantId, int $memberId, array $policy): bool
    {
        return DB::transaction(function () use ($tenantId, $memberId, $policy): bool {
            if ($this->reviewRequestQuery($tenantId, $memberId, $policy)->lockForUpdate()->exists()) {
                return false;
            }

            $now = now();
            $inserted = DB::table('safeguarding_vetting_review_requests')->insertOrIgnore([
                'tenant_id' => $tenantId,
                'user_id' => $memberId,
                'jurisdiction' => self::JURISDICTION,
                'scheme_code' => $policy['scheme_code'],
                'attestation_code' => $policy['attestation_code'],
                'purpose_code' => $policy['purpose_code'],
                'scope_type' => $policy['scope_type'],
                'scope_identifier' => $policy['scope_identifier'],
                'policy_version' => $policy['policy_version'],
                'status' => SafeguardingVettingReviewRequest::STATUS_PENDING,
                'request_source' => SafeguardingVettingReviewRequest::SOURCE_LEGACY_MIGRATION,
                'requested_by' => null,
                'requested_at' => $now,
                'handled_by' => null,
                'handled_at' => null,
                'resolution_code' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            return $inserted === 1;
        }, 3);
    }

    /** @param array<string, mixed> $policy */
    private function currentAttestationQuery(int $tenantId, int $memberId, array $policy): Builder
    {
        return DB::table('member_vetting_attestations')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $memberId)
            ->where('scheme_code', $policy['scheme_code'])
            ->where('attestation_code', $policy['attestation_code'])
            ->where('purpose_code', $policy['purpose_code'])
            ->where('scope_type', $policy['scope_type'])
            ->where('scope_identifier', $policy['scope_identifier']);
    }

    /** @param array<string, mixed> $policy */
    private function reviewRequestQuery(int $tenantId, int $memberId, array $policy): Builder
    {
        return DB::table('safeguarding_vetting_review_requests')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $memberId)
            ->where('purpose_code', $policy['purpose_code'])
            ->where('scope_type', $policy['scope_type'])
            ->where('scope_identifier', $policy['scope_identifier']);
    }

    /** @param list<string> $columns */
    private function tableHasColumns(string $table, array $columns): bool
    {
        foreach ($columns as $column) {
            if (! Schema::hasColumn($table, $column)) {
                return false;
            }
        }

        return true;
    }

    /** @param array<string, int> $totals */
    private function renderSummary(array $totals): void
    {
        $this->table(
            ['Metric', 'Count'],
            collect($totals)
                ->map(static fn (int $count, string $metric): array => [$metric, $count])
                ->values()
                ->all(),
        );
    }

    /** @param array<string, mixed> $policy */
    private function isExpectedPolicy(array $policy): bool
    {
        return ($policy['configured'] ?? false) === true
            && ($policy['contact_policy_available'] ?? false) === true
            && ($policy['jurisdiction'] ?? null) === self::JURISDICTION
            && ($policy['scheme_code'] ?? null) === 'dbs_england_wales'
            && ($policy['attestation_code'] ?? null) === self::LEGACY_TYPE
            && is_string($policy['policy_version'] ?? null)
            && $policy['policy_version'] !== ''
            // F-426 — a clearance this command cannot NAME is not minted at all.
            && count($this->certificationCodes($policy)) === 1;
    }

    /**
     * F-426 — the certification code(s) the community's configured jurisdiction
     * defines, derived exactly as the ordinary broker route derives them: when a
     * jurisdiction offers a single option that option is the decision's code,
     * and a decision that names no code is refused outright
     * (`INVALID_VETTING_CERTIFICATION_CODE` in
     * `MemberVettingAttestationService::normalizeCertificationDetails()`).
     *
     * The import supplied no `certification_codes` at all, so every imported
     * clearance was stored NULL — a confirmed clearance that does not say which
     * check it is a clearance for, on a column brokers read on the vetting
     * roster. Every human-made attestation carries the code; now so does every
     * imported one.
     *
     * @param  array<string, mixed>  $policy
     * @return list<string>
     */
    private function certificationCodes(array $policy): array
    {
        $options = is_array($policy['certification_options'] ?? null)
            ? $policy['certification_options']
            : [];

        $codes = [];
        foreach ($options as $option) {
            if (is_array($option) && is_string($option['code'] ?? null) && $option['code'] !== '') {
                $codes[] = (string) $option['code'];
            }
        }

        return array_values(array_unique($codes));
    }
}
