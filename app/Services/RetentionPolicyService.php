<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * RetentionPolicyService — tenant-configurable data retention, archival
 * and disposal engine (IT-Data-03).
 *
 * Each supported data type maps to a tenant-scoped table plus the
 * timestamp column the retention window is measured against. Policies
 * are opt-in per tenant and per type (disabled = retain indefinitely,
 * matching previous platform behaviour). Enforcement deletes in bounded
 * batches so a huge backlog can never lock a table for minutes, and
 * every pass is recorded in tenant_retention_runs for compliance
 * evidence.
 *
 * v1 supports the 'delete' action on operational/log data types only.
 * User-generated content (messages, listings, posts) is intentionally
 * excluded until anonymize/archive actions exist — disposal of member
 * content deserves a softer treatment than DELETE.
 */
class RetentionPolicyService
{
    /** Disposal batch size — keeps each DELETE bounded and replication-friendly. */
    private const BATCH_SIZE = 5000;

    /** Cap on batches per (tenant, type) per run — backlog drains across runs. */
    private const MAX_BATCHES_PER_RUN = 20;

    public const MIN_RETENTION_DAYS = 30;
    public const MAX_RETENTION_DAYS = 3650;

    public const ACTIONS = ['delete'];

    /**
     * Registry of purgeable data types.
     * column       = timestamp the retention window is measured against.
     * default_days = window shown in the admin UI before a policy row exists
     *                (policies remain opt-in/disabled by default).
     * where_in     = optional status guard — only rows in these states are
     *                ever purged (open/active records are never disposed of
     *                regardless of age).
     * or_windows   = optional additional disposal triggers. Each entry is an
     *                independent OR-branch matched against the same cutoff:
     *                the row is purgeable when the branch column is older
     *                than the window, optionally restricted by the branch's
     *                own where_in status guard. NULL timestamps never match.
     */
    public const DATA_TYPES = [
        // 🔴 min_days (F-174): a per-type floor for accountability data. A plain
        // tenant admin must not be able to shrink retention of audit, activity or
        // safeguarding records to the global 30-day minimum — those windows exist for
        // statutory/assurance reasons. upsertPolicy() enforces
        // max(MIN_RETENTION_DAYS, min_days). The values are conservative defaults;
        // the owner may adjust per the customer's own retention schedule.
        'activity_log' => [
            'table' => 'activity_log',
            'column' => 'created_at',
            'default_days' => 365,
            'min_days' => 365,
        ],
        'admin_audit_log' => [
            'table' => 'org_audit_log',
            'column' => 'created_at',
            'default_days' => 2555,
            'min_days' => 2555,
        ],
        'notifications' => [
            'table' => 'notifications',
            'column' => 'created_at',
        ],
        'email_log' => [
            'table' => 'email_log',
            'column' => 'created_at',
        ],
        // Volunteering special-category data (GDPR Art. 9 adjacent). All
        // opt-in: enabling is a per-tenant DPO decision; the defaults below
        // are the recommended storage-limitation windows.
        'vol_mood_checkins' => [
            // Wellbeing self-reports (mood score + free-text note).
            'table' => 'vol_mood_checkins',
            'column' => 'created_at',
            'default_days' => 365,
        ],
        'vol_wellbeing_alerts' => [
            // Burnout-risk alerts about a volunteer. Only concluded alerts
            // are purgeable; active/acknowledged ones stay regardless of age.
            'table' => 'vol_wellbeing_alerts',
            'column' => 'created_at',
            'default_days' => 730,
            'min_days' => 730,
            'where_in' => ['status' => ['resolved', 'dismissed']],
        ],
        'vol_safeguarding_incidents' => [
            // Safeguarding case records. Statutory retention is long — the
            // default is ~7 years — and ONLY closed cases are ever purged;
            // open/investigating/escalated incidents are live case files.
            'table' => 'vol_safeguarding_incidents',
            'column' => 'created_at',
            'default_days' => 2555,
            'min_days' => 2555,
            'where_in' => ['status' => ['resolved', 'closed']],
        ],
        'vol_guardian_consents' => [
            // Minor guardian consents, measured from EXPIRY (expires_at), so
            // a consent record is kept N days beyond its lapse as evidence
            // and then purged. Rows with no expiry are matched only via the
            // or_windows branches below: WITHDRAWN consents (expires_at often
            // NULL, consent_withdrawn_at set) age out N days after withdrawal,
            // and abandoned 'pending' requests — guardian name/email/phone
            // captured but consent never given — age out N days after
            // creation. Given (active) consents with no expiry never match.
            'table' => 'vol_guardian_consents',
            'column' => 'expires_at',
            'default_days' => 365,
            'min_days' => 365,
            'or_windows' => [
                ['column' => 'consent_withdrawn_at'],
                ['column' => 'created_at', 'where_in' => ['status' => ['pending']]],
            ],
        ],
        // NOTE: login_attempts is deliberately NOT here. It is global
        // rate-limiting data with no tenant_id column, so a per-tenant
        // retention policy cannot scope it correctly; every registered
        // type MUST be a tenant-scoped table (see enforcePolicy guard).
    ];

    /**
     * The minimum retention window allowed for a data type: the global floor,
     * raised by the type's own min_days where one is declared (F-174).
     */
    public static function minRetentionDaysFor(string $dataType): int
    {
        $config = self::DATA_TYPES[$dataType] ?? [];

        return max(self::MIN_RETENTION_DAYS, (int) ($config['min_days'] ?? 0));
    }

    /**
     * All policies for a tenant, keyed by data type. Types without a row
     * are returned with defaults (disabled) so the admin UI can render
     * the full registry in one pass.
     *
     * @return array<string, array{data_type: string, retention_days: int, action: string, is_enabled: bool, updated_at: ?string}>
     */
    public static function getPolicies(int $tenantId): array
    {
        $rows = DB::table('tenant_retention_policies')
            ->where('tenant_id', $tenantId)
            ->get()
            ->keyBy('data_type');

        $policies = [];
        foreach (self::DATA_TYPES as $type => $config) {
            $row = $rows->get($type);
            $policies[$type] = [
                'data_type' => $type,
                'retention_days' => $row ? (int) $row->retention_days : (int) ($config['default_days'] ?? 365),
                'action' => $row ? (string) $row->action : 'delete',
                'is_enabled' => $row ? (bool) $row->is_enabled : false,
                // F-174: surface the per-type floor so the admin UI can enforce it too.
                'min_days' => self::minRetentionDaysFor($type),
                'updated_at' => $row->updated_at ?? null,
            ];
        }

        return $policies;
    }

    /**
     * Create or update one policy. Returns an error string (translated)
     * or null on success.
     */
    public static function upsertPolicy(
        int $tenantId,
        string $dataType,
        int $retentionDays,
        bool $isEnabled,
        string $action = 'delete',
        ?int $updatedBy = null,
    ): ?string {
        if (!isset(self::DATA_TYPES[$dataType])) {
            return __('api.retention_unknown_data_type');
        }
        if (!in_array($action, self::ACTIONS, true)) {
            return __('api.retention_unknown_action');
        }
        // F-174: accountability data types carry a per-type floor above the global
        // minimum. A plain admin cannot set audit/activity/safeguarding retention
        // below it.
        $minDays = self::minRetentionDaysFor($dataType);
        if ($retentionDays < $minDays || $retentionDays > self::MAX_RETENTION_DAYS) {
            return __('api.retention_days_range', [
                'min' => $minDays,
                'max' => self::MAX_RETENTION_DAYS,
            ]);
        }

        DB::table('tenant_retention_policies')->updateOrInsert(
            ['tenant_id' => $tenantId, 'data_type' => $dataType],
            [
                'retention_days' => $retentionDays,
                'action' => $action,
                'is_enabled' => $isEnabled,
                'updated_by' => $updatedBy,
                'updated_at' => now(),
                'created_at' => now(),
            ]
        );

        return null;
    }

    /**
     * Enforce every enabled policy for one tenant. Returns per-type
     * results: ['activity_log' => ['affected' => 123, 'status' => 'completed'], ...]
     *
     * @return array<string, array{affected: int, status: string}>
     */
    public static function enforceForTenant(int $tenantId): array
    {
        $policies = DB::table('tenant_retention_policies')
            ->where('tenant_id', $tenantId)
            ->where('is_enabled', true)
            ->get();

        $results = [];
        foreach ($policies as $policy) {
            $type = (string) $policy->data_type;
            if (!isset(self::DATA_TYPES[$type])) {
                continue; // registry shrank since the row was written
            }

            $days = max(self::MIN_RETENTION_DAYS, (int) $policy->retention_days);
            $results[$type] = self::enforcePolicy($tenantId, $type, $days, (string) $policy->action);
        }

        return $results;
    }

    /** @return array{affected: int, status: string} */
    private static function enforcePolicy(int $tenantId, string $dataType, int $retentionDays, string $action): array
    {
        $config = self::DATA_TYPES[$dataType];
        $cutoff = now()->subDays($retentionDays);

        $affected = 0;
        $status = 'completed';
        $error = null;

        // Fail safe rather than fail nightly: a registered type whose table
        // lacks tenant_id, the timestamp column, or a where_in guard column
        // could never be scoped correctly. Skip it (status 'skipped', no
        // DELETE) instead of throwing an unscoped query every run.
        $requiredColumns = array_merge(
            ['tenant_id', $config['column']],
            array_keys($config['where_in'] ?? [])
        );
        foreach (($config['or_windows'] ?? []) as $window) {
            $requiredColumns = array_merge(
                $requiredColumns,
                [$window['column']],
                array_keys($window['where_in'] ?? [])
            );
        }
        $missingColumn = false;
        foreach ($requiredColumns as $requiredColumn) {
            if (!\Schema::hasColumn($config['table'], $requiredColumn)) {
                $missingColumn = true;
                break;
            }
        }
        if ($missingColumn) {
            Log::warning('[Retention] skipped — table missing tenant_id/timestamp column', [
                'tenant_id' => $tenantId,
                'data_type' => $dataType,
                'table' => $config['table'],
            ]);
            self::recordRun($tenantId, $dataType, $action, $retentionDays, 0, 'skipped', 'missing_column');
            return ['affected' => 0, 'status' => 'skipped'];
        }

        try {
            for ($batch = 0; $batch < self::MAX_BATCHES_PER_RUN; $batch++) {
                // Every batch is tenant-scoped AND bounded.
                $query = DB::table($config['table'])
                    ->where('tenant_id', $tenantId);

                // Window match: the primary timestamp column, OR any of the
                // type's or_windows branches (each with its own optional
                // status guard). All branches are grouped so the tenant scope
                // and the where_in guard below still apply to every row.
                $query->where(function ($q) use ($config, $cutoff) {
                    $q->where($config['column'], '<', $cutoff);
                    foreach (($config['or_windows'] ?? []) as $window) {
                        $q->orWhere(function ($branch) use ($window, $cutoff) {
                            $branch->where($window['column'], '<', $cutoff);
                            foreach (($window['where_in'] ?? []) as $col => $values) {
                                $branch->whereIn($col, $values);
                            }
                        });
                    }
                });

                // Status guard: types with a where_in constraint only ever
                // purge rows in the listed (concluded) states — an open
                // safeguarding case or active wellbeing alert is never
                // disposed of, however old it is.
                foreach (($config['where_in'] ?? []) as $col => $values) {
                    $query->whereIn($col, $values);
                }

                $deleted = $query
                    ->limit(self::BATCH_SIZE)
                    ->delete();

                $affected += $deleted;
                if ($deleted < self::BATCH_SIZE) {
                    break;
                }
            }

            if ($affected === self::BATCH_SIZE * self::MAX_BATCHES_PER_RUN) {
                $status = 'partial'; // backlog remains; next run continues
            }
        } catch (\Throwable $e) {
            $status = 'failed';
            $error = mb_substr($e->getMessage(), 0, 500);
            Log::warning('[Retention] enforcement failed', [
                'tenant_id' => $tenantId,
                'data_type' => $dataType,
                'error' => $e->getMessage(),
            ]);
        }

        self::recordRun($tenantId, $dataType, $action, $retentionDays, $affected, $status, $error);

        return ['affected' => $affected, 'status' => $status];
    }

    private static function recordRun(
        int $tenantId,
        string $dataType,
        string $action,
        int $retentionDays,
        int $affected,
        string $status,
        ?string $error,
    ): void {
        try {
            DB::table('tenant_retention_runs')->insert([
                'tenant_id' => $tenantId,
                'data_type' => $dataType,
                'action' => $action,
                'retention_days' => $retentionDays,
                'affected_rows' => $affected,
                'status' => $status,
                'error' => $error,
                'ran_at' => now(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('[Retention] failed to record run: ' . $e->getMessage(), [
                'tenant_id' => $tenantId,
                'data_type' => $dataType,
            ]);
        }
    }

    /**
     * Recent enforcement runs for the admin UI / compliance evidence.
     *
     * @return array<int, object>
     */
    public static function getRecentRuns(int $tenantId, int $limit = 50): array
    {
        return DB::table('tenant_retention_runs')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('ran_at')
            ->orderByDesc('id')
            ->limit(min(max($limit, 1), 200))
            ->get()
            ->all();
    }
}
