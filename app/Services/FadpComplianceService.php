<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Core\TenantContext;

/**
 * FadpComplianceService — AG42 Swiss FADP / nDSG Compliance
 *
 * Manages consent ledger, retention configuration, and processing register
 * for tenants subject to the Swiss Federal Act on Data Protection (revDSG/nDSG).
 */
class FadpComplianceService
{
    // =========================================================================
    // AVAILABILITY
    // =========================================================================

    /**
     * Returns true only when all three FADP tables exist.
     * Guards every public method so the service degrades gracefully on
     * installations that haven't run the AG42 migration yet.
     */
    public static function isAvailable(): bool
    {
        return Schema::hasTable('fadp_consent_records')
            && Schema::hasTable('fadp_data_retention_config')
            && Schema::hasTable('fadp_processing_activities');
    }

    // =========================================================================
    // CONSENT LEDGER
    // =========================================================================

    /**
     * Record a consent grant, withdrawal, or update for a member.
     *
     * @param array<string,mixed> $meta  Optional extra metadata stored as JSON.
     */
    public static function recordConsent(
        int $userId,
        int $tenantId,
        string $consentType,
        string $action,
        array $meta = []
    ): void {
        DB::table('fadp_consent_records')->insert([
            'tenant_id'      => $tenantId,
            'user_id'        => $userId,
            'consent_type'   => $consentType,
            'action'         => $action,
            'consent_version' => $meta['consent_version'] ?? null,
            'ip_address'     => $meta['ip_address'] ?? null,
            'user_agent'     => $meta['user_agent'] ?? null,
            'metadata'       => isset($meta['extra']) ? json_encode($meta['extra']) : null,
            'created_at'     => Carbon::now(),
        ]);
    }

    /**
     * Return consent history for a single member (most recent first).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function getConsentHistory(int $userId, int $tenantId): array
    {
        return DB::table('fadp_consent_records')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Paginated admin view of ALL consent records for a tenant.
     *
     * @return array{items: array<int,array<string,mixed>>, total: int, page: int, per_page: int, last_page: int}
     */
    public static function getConsentLedger(int $tenantId, int $page = 1, int $perPage = 50): array
    {
        $offset = ($page - 1) * $perPage;

        $total = (int) DB::table('fadp_consent_records')
            ->where('tenant_id', $tenantId)
            ->count();

        $items = DB::table('fadp_consent_records')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->offset($offset)
            ->limit($perPage)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();

        return [
            'items'     => $items,
            'total'     => $total,
            'page'      => $page,
            'per_page'  => $perPage,
            'last_page' => (int) ceil($total / $perPage),
        ];
    }

    /**
     * Return all consent records for CSV export (no pagination).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function exportConsentLedger(int $tenantId): array
    {
        return DB::table('fadp_consent_records')
            ->where('tenant_id', $tenantId)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Summarise the consent ledger for a regulator-facing disclosure pack.
     *
     * @return array<string,mixed>
     */
    public static function consentLedgerSummary(int $tenantId): array
    {
        $rows = DB::table('fadp_consent_records')
            ->where('tenant_id', $tenantId)
            ->selectRaw('consent_type, action, COUNT(*) as total, MAX(created_at) as latest_at')
            ->groupBy('consent_type', 'action')
            ->orderBy('consent_type')
            ->orderBy('action')
            ->get();

        return [
            'total' => (int) DB::table('fadp_consent_records')->where('tenant_id', $tenantId)->count(),
            'latest_at' => DB::table('fadp_consent_records')->where('tenant_id', $tenantId)->max('created_at'),
            'by_type_and_action' => $rows->map(fn ($row) => [
                'consent_type' => (string) $row->consent_type,
                'action' => (string) $row->action,
                'total' => (int) $row->total,
                'latest_at' => $row->latest_at,
            ])->all(),
        ];
    }

    // =========================================================================
    // RETENTION CONFIGURATION
    // =========================================================================

    /**
     * Default retention periods (Swiss FADP conservative minimums).
     *
     * @return array<string,int>
     */
    private static function defaultRetentionConfig(): array
    {
        return [
            'member_data_years'       => 7,
            'transaction_data_years'  => 10,
            'activity_logs_years'     => 3,
            'messages_years'          => 2,
            'ai_embeddings_years'     => 1,
        ];
    }

    /**
     * Retrieve retention config for a tenant (returns defaults if none saved).
     *
     * @return array<string,mixed>
     */
    public static function getRetentionConfig(int $tenantId): array
    {
        $row = DB::table('fadp_data_retention_config')
            ->where('tenant_id', $tenantId)
            ->first();

        if (! $row) {
            return [
                'config'           => self::defaultRetentionConfig(),
                'data_residency'   => 'EU',
                'dpa_contact_email' => null,
            ];
        }

        return [
            'config'           => json_decode($row->config, true) ?? self::defaultRetentionConfig(),
            'data_residency'   => $row->data_residency,
            'dpa_contact_email' => $row->dpa_contact_email,
        ];
    }

    /**
     * Upsert retention config for a tenant.
     * Seeds default processing activities on first save (if none exist yet).
     *
     * @param array<string,mixed> $config
     */
    public static function updateRetentionConfig(int $tenantId, array $config): void
    {
        $isFirst = ! DB::table('fadp_data_retention_config')
            ->where('tenant_id', $tenantId)
            ->exists();

        DB::table('fadp_data_retention_config')
            ->upsert(
                [
                    'tenant_id'        => $tenantId,
                    'config'           => json_encode($config['config'] ?? self::defaultRetentionConfig()),
                    'data_residency'   => $config['data_residency'] ?? 'EU',
                    'dpa_contact_email' => $config['dpa_contact_email'] ?? null,
                    'updated_at'       => Carbon::now(),
                ],
                ['tenant_id'],
                ['config', 'data_residency', 'dpa_contact_email', 'updated_at']
            );

        // Seed standard activities only on first-ever save
        if ($isFirst) {
            $noActivities = ! DB::table('fadp_processing_activities')
                ->where('tenant_id', $tenantId)
                ->exists();

            if ($noActivities) {
                self::seedDefaultActivities($tenantId);
            }
        }
    }

    // =========================================================================
    // PROCESSING ACTIVITIES
    // =========================================================================

    /**
     * Retrieve all active processing activities for a tenant (sorted).
     *
     * @return array<int,array<string,mixed>>
     */
    public static function getProcessingActivities(int $tenantId): array
    {
        return DB::table('fadp_processing_activities')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->orderBy('id')
            ->get()
            ->map(function ($row) {
                $r = (array) $row;
                $r['data_categories'] = json_decode($r['data_categories'], true) ?? [];
                $r['recipients']      = isset($r['recipients']) ? (json_decode($r['recipients'], true) ?? []) : [];
                $r['is_automated_profiling'] = (bool) $r['is_automated_profiling'];
                $r['is_active']       = (bool) $r['is_active'];
                return $r;
            })
            ->all();
    }

    /**
     * Insert or update a processing activity.
     *
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public static function upsertProcessingActivity(int $tenantId, array $data): array
    {
        $id = isset($data['id']) ? (int) $data['id'] : null;
        $now = Carbon::now();

        $payload = [
            'tenant_id'              => $tenantId,
            'activity_name'          => $data['activity_name'],
            'purpose'                => $data['purpose'],
            'data_categories'        => json_encode($data['data_categories'] ?? []),
            'recipients'             => isset($data['recipients']) ? json_encode($data['recipients']) : null,
            'retention_period'       => $data['retention_period'] ?? '',
            'legal_basis'            => $data['legal_basis'],
            'is_automated_profiling' => (bool) ($data['is_automated_profiling'] ?? false),
            'is_active'              => true,
            'sort_order'             => (int) ($data['sort_order'] ?? 0),
            'updated_at'             => $now,
        ];

        if ($id) {
            // Update only if it belongs to this tenant
            DB::table('fadp_processing_activities')
                ->where('id', $id)
                ->where('tenant_id', $tenantId)
                ->update($payload);
        } else {
            $payload['created_at'] = $now;
            $id = (int) DB::table('fadp_processing_activities')->insertGetId($payload);
        }

        $row = DB::table('fadp_processing_activities')
            ->where('tenant_id', $tenantId)
            ->where('id', $id)
            ->first();
        if (! $row) {
            return [];
        }

        $result = (array) $row;
        $result['data_categories'] = json_decode($result['data_categories'], true) ?? [];
        $result['recipients']      = isset($result['recipients']) ? (json_decode($result['recipients'], true) ?? []) : [];
        $result['is_automated_profiling'] = (bool) $result['is_automated_profiling'];
        $result['is_active']       = (bool) $result['is_active'];
        return $result;
    }

    /**
     * Soft-delete a processing activity (sets is_active = false).
     */
    public static function deleteProcessingActivity(int $id, int $tenantId): void
    {
        DB::table('fadp_processing_activities')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update(['is_active' => false, 'updated_at' => Carbon::now()]);
    }

    // =========================================================================
    // PROCESSING REGISTER EXPORT
    // =========================================================================

    /**
     * Generate a structured processing register for a tenant.
     * Suitable for PDF/CSV rendering by the admin panel.
     *
     * @return array<string,mixed>
     */
    public static function generateProcessingRegister(int $tenantId): array
    {
        $tenant = DB::table('tenants')->find($tenantId);
        $retentionConfig = self::getRetentionConfig($tenantId);
        $activities = self::getProcessingActivities($tenantId);

        return [
            'tenant_id'     => $tenantId,
            'tenant_name'   => $tenant ? ($tenant->name ?? "Tenant #{$tenantId}") : "Tenant #{$tenantId}",
            'generated_at'  => Carbon::now()->toIso8601String(),
            'data_residency' => $retentionConfig['data_residency'],
            'dpa_contact_email' => $retentionConfig['dpa_contact_email'],
            'retention_config'  => $retentionConfig['config'],
            'processing_activities' => $activities,
            'total_activities'      => count($activities),
            'automated_profiling_count' => count(array_filter(
                $activities,
                fn ($a) => (bool) ($a['is_automated_profiling'] ?? false)
            )),
        ];
    }

    /**
     * Generate the AG42 FADP disclosure pack used for DPA/canton diligence.
     *
     * @return array<string,mixed>
     */
    public static function generateDisclosurePack(int $tenantId): array
    {
        $register = self::generateProcessingRegister($tenantId);

        return [
            'pack_name' => __('api.fadp_disclosure_pack_name'),
            'generated_at' => Carbon::now()->toIso8601String(),
            'tenant' => [
                'id' => $register['tenant_id'],
                'name' => $register['tenant_name'],
            ],
            'data_residency_declaration' => [
                'declared_residency' => $register['data_residency'],
                'dpa_contact_email' => $register['dpa_contact_email'],
                'isolated_node_supported' => $register['data_residency'] === 'Switzerland',
            ],
            'retention_config' => $register['retention_config'],
            'processing_register' => [
                'total_activities' => $register['total_activities'],
                'automated_profiling_count' => $register['automated_profiling_count'],
                'activities' => $register['processing_activities'],
            ],
            'consent_ledger_summary' => self::consentLedgerSummary($tenantId),
            'member_rights' => [
                'access',
                'rectification',
                'erasure_or_restriction_where_applicable',
                'data_portability',
                'withdrawal_of_consent',
            ],
            'operator_controls' => [
                'tenant_scoped_storage',
                'auditable_consent_ledger',
                'configurable_retention_periods',
                'processing_register_export',
                'data_residency_declaration',
            ],
        ];
    }

    public static function processingRegisterCsv(int $tenantId): string
    {
        $register = self::generateProcessingRegister($tenantId);
        $rows = [[
            'tenant_name',
            'data_residency',
            'dpa_contact_email',
            'activity_name',
            'purpose',
            'data_categories',
            'recipients',
            'retention_period',
            'legal_basis',
            'automated_profiling',
        ]];

        foreach ($register['processing_activities'] as $activity) {
            $rows[] = [
                (string) $register['tenant_name'],
                (string) $register['data_residency'],
                (string) ($register['dpa_contact_email'] ?? ''),
                (string) $activity['activity_name'],
                (string) $activity['purpose'],
                implode('; ', $activity['data_categories'] ?? []),
                implode('; ', $activity['recipients'] ?? []),
                (string) $activity['retention_period'],
                (string) $activity['legal_basis'],
                (bool) ($activity['is_automated_profiling'] ?? false) ? 'yes' : 'no',
            ];
        }

        return implode("\n", array_map(
            fn (array $row) => implode(',', array_map([self::class, 'csvCell'], $row)),
            $rows
        )) . "\n";
    }

    private static function csvCell(mixed $value): string
    {
        // Quoting alone does not stop a spreadsheet evaluating `="..."` as a
        // formula; neutralise the leading character first (security audit,
        // 2026-09-11), then quote for the CSV grammar.
        $cell = str_replace('"', '""', \App\Support\CsvExportSanitizer::cell($value));

        return '"' . $cell . '"';
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    /**
     * Seed standard KISS/NEXUS processing activities for a new tenant.
     */
    private static function seedDefaultActivities(int $tenantId): void
    {
        $now = Carbon::now();

        $defaults = [
            [
                'activity_name'          => 'Member account management',
                'purpose'                => 'Managing member registrations, profiles, and authentication',
                'data_categories'        => ['name', 'email', 'phone', 'address'],
                'recipients'             => null,
                'retention_period'       => '7 years after membership ends',
                'legal_basis'            => 'contract',
                'is_automated_profiling' => false,
                'sort_order'             => 1,
            ],
            [
                'activity_name'          => 'Time-credit transactions',
                'purpose'                => 'Recording and auditing time-credit exchanges between members',
                'data_categories'        => ['name', 'transaction_amounts', 'timestamps'],
                'recipients'             => null,
                'retention_period'       => '10 years',
                'legal_basis'            => 'contract',
                'is_automated_profiling' => false,
                'sort_order'             => 2,
            ],
            [
                'activity_name'          => 'Volunteer hour logging',
                'purpose'                => 'Recording verified volunteer hours for municipal impact reporting',
                'data_categories'        => ['name', 'hours', 'activity_type', 'timestamps'],
                'recipients'             => null,
                'retention_period'       => '10 years',
                'legal_basis'            => 'legitimate_interest',
                'is_automated_profiling' => false,
                'sort_order'             => 3,
            ],
            [
                'activity_name'          => 'AI-powered member matching',
                'purpose'                => 'Suggesting volunteer-recipient matches using interest embeddings and collaborative filtering',
                'data_categories'        => ['interests', 'activity_history', 'embeddings'],
                'recipients'             => null,
                'retention_period'       => '1 year or until consent withdrawn',
                'legal_basis'            => 'consent',
                'is_automated_profiling' => true,
                'sort_order'             => 4,
            ],
            [
                'activity_name'          => 'Push notifications',
                'purpose'                => 'Sending community updates, event reminders, and emergency alerts',
                'data_categories'        => ['device_tokens', 'notification_preferences'],
                'recipients'             => null,
                'retention_period'       => 'Until consent withdrawn',
                'legal_basis'            => 'consent',
                'is_automated_profiling' => false,
                'sort_order'             => 5,
            ],
            [
                'activity_name'          => 'Community analytics',
                'purpose'                => 'Aggregated reporting on community health and municipal impact (no individual identification)',
                'data_categories'        => ['aggregated_activity_metrics'],
                'recipients'             => null,
                'retention_period'       => '3 years',
                'legal_basis'            => 'legitimate_interest',
                'is_automated_profiling' => false,
                'sort_order'             => 6,
            ],
        ];

        foreach ($defaults as $activity) {
            DB::table('fadp_processing_activities')->insert([
                'tenant_id'              => $tenantId,
                'activity_name'          => $activity['activity_name'],
                'purpose'                => $activity['purpose'],
                'data_categories'        => json_encode($activity['data_categories']),
                'recipients'             => $activity['recipients'],
                'retention_period'       => $activity['retention_period'],
                'legal_basis'            => $activity['legal_basis'],
                'is_automated_profiling' => $activity['is_automated_profiling'],
                'is_active'              => true,
                'sort_order'             => $activity['sort_order'],
                'created_at'             => $now,
                'updated_at'             => $now,
            ]);
        }
    }
}
