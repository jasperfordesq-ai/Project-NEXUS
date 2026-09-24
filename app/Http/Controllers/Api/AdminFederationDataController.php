<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Core\TenantContext;
use App\Services\FederationExternalPartnerService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * AdminFederationDataController
 *
 * Bulk export/import/purge of a tenant's federation data.
 * - Export streams a sanitized JSON snapshot (secrets are redacted).
 * - Import validates a JSON document and optionally performs a dry run.
 * - Purge removes federation_api_logs rows older than N days.
 *
 * All operations are scoped to the current tenant via TenantContext.
 */
class AdminFederationDataController extends BaseApiController
{
    protected bool $isV2Api = true;

    /** Fields that MUST NEVER leave the system, even to tenant admins. */
    private const EXTERNAL_PARTNER_SECRET_FIELDS = [
        'api_key',
        'signing_secret',
        'oauth_client_secret',
        'oauth_client_id',
        'oauth_token_url',
    ];

    private const ALLOWED_TABLES = [
        'federation_partnerships',
        'federation_external_partners',
        'federation_reputation',
        'federation_api_logs',
        'federation_api_keys',
        'federation_user_settings',
        'federation_messages',
        'federation_connections',
        'transactions',
        'federation_directory_profiles',
        'federation_neighborhoods',
        'federation_neighborhood_members',
        'federation_neighborhood_tenants',
        'federation_credit_agreements',
        'federation_audit_log',
    ];

    /** Hard safety cap on api_logs rows emitted per export. */
    private const API_LOGS_MAX_ROWS = 500000;

    /** Chunk size for cursor-based streaming. */
    private const STREAM_CHUNK_SIZE = 1000;

    /**
     * POST /api/v2/admin/federation/data/export
     *
     * Streams a JSON object containing all federation data owned by the
     * current tenant (partnerships, external_partners, reputation, api_logs
     * from the last 90 days). Secrets are redacted.
     */
    public function export(Request $request): StreamedResponse|JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $userId = $this->getUserId();

        Log::info('[FederationData] Export requested', [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
        ]);

        $filename = sprintf('federation_export_tenant_%d_%s.json', $tenantId, date('Y-m-d_His'));

        return new StreamedResponse(function () use ($tenantId): void {
            // NOTE: we intentionally do NOT call ob_end_flush()/ob_end_clean() here.
            // Symfony's StreamedResponse already invokes @ob_flush() + flush() after
            // the callback, and per-chunk @fflush($out) pushes data to PHP's output.
            // On Apache/PHP-FPM the X-Accel-Buffering: no + Content-Type headers +
            // chunked encoding are sufficient to avoid full-buffer accumulation.
            // Popping buffers here breaks PHPUnit's TestResponse::streamedContent()
            // which relies on its own ob_start/ob_end_clean pair.

            $out = fopen('php://output', 'w');
            if ($out === false) {
                return;
            }

            fwrite($out, '{"meta":' . json_encode([
                'tenant_id' => $tenantId,
                'exported_at' => date('c'),
                'format_version' => 1,
            ]) . ',');

            $this->streamPartnerships($out, $tenantId);
            fwrite($out, ',');
            $this->streamExternalPartners($out, $tenantId);
            fwrite($out, ',');
            $this->streamReputation($out, $tenantId);
            fwrite($out, ',');
            $this->streamUserSettings($out, $tenantId);
            fwrite($out, ',');
            $this->streamMessages($out, $tenantId);
            fwrite($out, ',');
            $this->streamConnections($out, $tenantId);
            fwrite($out, ',');
            $this->streamInternalTransactions($out, $tenantId);
            fwrite($out, ',');
            $this->streamDirectoryProfile($out, $tenantId);
            fwrite($out, ',');
            $this->streamNeighborhoodMemberships($out, $tenantId);
            fwrite($out, ',');
            $this->streamCreditAgreements($out, $tenantId);
            fwrite($out, ',');
            $this->streamAuditLog($out, $tenantId);
            fwrite($out, ',');
            $this->streamApiKeys($out, $tenantId);
            fwrite($out, ',');
            $this->streamApiLogs($out, $tenantId, 90);

            fwrite($out, '}');
            @fflush($out);
            fclose($out);
        }, 200, [
            'Content-Type' => 'application/json; charset=utf-8',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
            'Cache-Control' => 'no-cache, no-store, must-revalidate',
            'X-Content-Type-Options' => 'nosniff',
            // Apache mod_proxy / nginx: disable response buffering so the client sees the stream as it's written.
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * POST /api/v2/admin/federation/data/import (multipart: file, dry_run)
     */
    public function import(Request $request): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $userId = $this->getUserId();

        $dryRun = filter_var($request->input('dry_run', true), FILTER_VALIDATE_BOOLEAN);

        if (!$request->hasFile('file')) {
            return $this->respondWithError('NO_FILE', __('api.missing_required_field', ['field' => 'file']), 'file', 422);
        }

        $file = $request->file('file');
        if ($file === null || !$file->isValid()) {
            return $this->respondWithError('INVALID_FILE', __('api.invalid_file_upload'), 'file', 422);
        }

        $contents = @file_get_contents($file->getRealPath());
        if ($contents === false) {
            return $this->respondWithError('READ_FAILED', __('api.failed_to_read_file'), 'file', 400);
        }

        $data = json_decode($contents, true);
        if (!is_array($data)) {
            return $this->respondWithError('INVALID_JSON', __('api.invalid_json'), 'file', 400);
        }

        // Shape validation
        $errors = $this->validateImportShape($data);
        if (!empty($errors)) {
            return $this->respondWithErrors($errors, 422);
        }

        $summary = [
            'dry_run' => $dryRun,
            'partnerships' => ['new' => 0, 'skipped' => 0, 'invalid' => 0],
            'external_partners' => ['new' => 0, 'skipped' => 0, 'invalid' => 0],
        ];

        // Partnerships: only import rows where the CURRENT tenant is the
        // INITIATING side (tenant_id). Accepting rows with the counterparty in
        // tenant_id would fabricate a "pending request from them" that this
        // tenant could then self-approve via approvePartnership() — creating an
        // active partnership the counterparty never requested. Rows where the
        // current tenant is only the receiver are skipped: the counterparty
        // must send a genuine request through requestPartnership().
        if (!empty($data['partnerships']) && is_array($data['partnerships'])) {
            $hasCanonicalPair = $this->columnExists('federation_partnerships', 'canonical_pair');
            foreach ($data['partnerships'] as $row) {
                if (!is_array($row) || !isset($row['tenant_id'], $row['partner_tenant_id'], $row['status'])) {
                    $summary['partnerships']['invalid']++;
                    continue;
                }
                $ownTenant = (int) $row['tenant_id'] === $tenantId;
                if (!$ownTenant) {
                    $summary['partnerships']['skipped']++;
                    continue;
                }
                $firstTenantId = (int) $row['tenant_id'];
                $secondTenantId = (int) $row['partner_tenant_id'];
                $canonicalPair = min($firstTenantId, $secondTenantId) . '-' . max($firstTenantId, $secondTenantId);

                // Deduplicate on canonical tenant pair, then fall back to the old directional key.
                try {
                    if ($hasCanonicalPair) {
                        $exists = DB::selectOne(
                            'SELECT id FROM federation_partnerships
                             WHERE canonical_pair = ?
                                OR (tenant_id = ? AND partner_tenant_id = ?)
                                OR (tenant_id = ? AND partner_tenant_id = ?)',
                            [$canonicalPair, $firstTenantId, $secondTenantId, $secondTenantId, $firstTenantId]
                        );
                    } else {
                        $exists = DB::selectOne(
                            'SELECT id FROM federation_partnerships
                             WHERE (tenant_id = ? AND partner_tenant_id = ?)
                                OR (tenant_id = ? AND partner_tenant_id = ?)',
                            [$firstTenantId, $secondTenantId, $secondTenantId, $firstTenantId]
                        );
                    }
                } catch (\Throwable) {
                    $summary['partnerships']['invalid']++;
                    continue;
                }
                if ($exists) {
                    $summary['partnerships']['skipped']++;
                    continue;
                }
                // F-154: an imported partnership must ALWAYS start as 'pending',
                // regardless of the status in the uploaded file. Only the
                // counterparty's genuine approval (approvePartnership) may make a
                // partnership active. Allowing an import to seed a 'suspended' row
                // — which carries no suspended_by_tenant_id and no approved_at —
                // let this tenant then call reactivatePartnership() and flip it to
                // active without the partner community ever approving it.
                $status = 'pending';

                $summary['partnerships']['new']++;
                if (!$dryRun) {
                    try {
                        $columns = [
                            'tenant_id', 'partner_tenant_id', 'status', 'federation_level',
                            'messaging_enabled', 'transactions_enabled', 'profiles_enabled',
                            'listings_enabled', 'events_enabled', 'groups_enabled', 'notes', 'created_at',
                        ];
                        $values = [
                            $firstTenantId,
                            $secondTenantId,
                            $status,
                            (int) ($row['federation_level'] ?? 1),
                            (int) !empty($row['messaging_enabled']),
                            (int) !empty($row['transactions_enabled']),
                            (int) !empty($row['profiles_enabled']),
                            (int) !empty($row['listings_enabled']),
                            (int) !empty($row['events_enabled']),
                            (int) !empty($row['groups_enabled']),
                            isset($row['notes']) ? (string) $row['notes'] : null,
                            now(),
                        ];
                        if ($hasCanonicalPair) {
                            array_splice($columns, 2, 0, ['canonical_pair']);
                            array_splice($values, 2, 0, [$canonicalPair]);
                        }
                        $placeholders = implode(', ', array_fill(0, count($columns), '?'));
                        DB::insert(
                            'INSERT INTO federation_partnerships (' . implode(', ', $columns) . ") VALUES ({$placeholders})",
                            $values
                        );
                    } catch (\Throwable $e) {
                        $summary['partnerships']['new']--;
                        $summary['partnerships']['invalid']++;
                    }
                }
            }
        }

        // External partners: only import rows that belong to current tenant.
        if (!empty($data['external_partners']) && is_array($data['external_partners'])) {
            foreach ($data['external_partners'] as $row) {
                if (!is_array($row) || !isset($row['tenant_id'], $row['name'], $row['base_url'])) {
                    $summary['external_partners']['invalid']++;
                    continue;
                }
                if ((int) $row['tenant_id'] !== $tenantId) {
                    $summary['external_partners']['skipped']++;
                    continue;
                }
                $baseUrl = (string) $row['base_url'];
                if (FederationExternalPartnerService::validateBaseUrl($baseUrl) !== null) {
                    $summary['external_partners']['invalid']++;
                    continue;
                }
                try {
                    $exists = DB::selectOne(
                        'SELECT id FROM federation_external_partners WHERE tenant_id = ? AND base_url = ?',
                        [$tenantId, $baseUrl]
                    );
                } catch (\Throwable) {
                    $summary['external_partners']['invalid']++;
                    continue;
                }
                if ($exists) {
                    $summary['external_partners']['skipped']++;
                    continue;
                }
                $summary['external_partners']['new']++;
                if (!$dryRun) {
                    try {
                        DB::insert(
                            'INSERT INTO federation_external_partners
                             (tenant_id, name, description, base_url, api_path, status, created_by, created_at)
                             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                            [
                                $tenantId,
                                (string) $row['name'],
                                isset($row['description']) ? (string) $row['description'] : null,
                                $baseUrl,
                                isset($row['api_path']) ? (string) $row['api_path'] : '/api/v1/federation',
                                'pending',
                                $userId,
                            ]
                        );
                    } catch (\Throwable $e) {
                        $summary['external_partners']['new']--;
                        $summary['external_partners']['invalid']++;
                    }
                }
            }
        }

        Log::info('[FederationData] Import complete', [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'dry_run' => $dryRun,
            'summary' => $summary,
        ]);

        return $this->respondWithData($summary);
    }

    /**
     * POST /api/v2/admin/federation/data/purge
     * Body: { "days": 365 }
     * Deletes federation_api_logs rows older than N days scoped to this tenant's api keys.
     */
    public function purge(Request $request): JsonResponse
    {
        $this->requireSuperAdmin();
        $tenantId = TenantContext::getId();
        $userId = $this->getUserId();

        $days = (int) $request->input('days', 365);
        if ($days < 30 || $days > 3650) {
            return $this->respondWithError('INVALID_DAYS', __('api.value_out_of_range', ['min' => 30, 'max' => 3650]), 'days', 422);
        }

        $cutoff = date('Y-m-d H:i:s', strtotime("-{$days} days"));
        $deleted = 0;

        try {
            // DELETE must be scoped to rows whose api_key belongs to this tenant.
            $deleted = DB::delete(
                'DELETE l FROM federation_api_logs l
                 INNER JOIN federation_api_keys k ON k.id = l.api_key_id
                 WHERE k.tenant_id = ? AND l.created_at < ?',
                [$tenantId, $cutoff]
            );
        } catch (\Throwable $e) {
            Log::warning('[FederationData] Purge failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
            return $this->respondWithError('PURGE_FAILED', __('api.purge_failed'), null, 500);
        }

        Log::info('[FederationData] Purge complete', [
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'days' => $days,
            'deleted' => $deleted,
        ]);

        return $this->respondWithData([
            'deleted' => $deleted,
            'cutoff' => $cutoff,
            'days' => $days,
        ]);
    }

    // ───────────────────────────────── helpers ─────────────────────────────────

    /**
     * Opens a JSON array for a section and writes rows produced by $producer one-by-one.
     * $producer is a callable taking a `callable(array):void $emit` that it invokes for each row.
     * This keeps memory bounded to one row at a time regardless of total row count.
     *
     * @param resource $out
     * @param callable(callable(array<string,mixed>):void):void $producer
     */
    private function streamArraySection($out, string $key, callable $producer): void
    {
        fwrite($out, json_encode($key) . ':[');

        $first = true;
        $emit = function (array $row) use ($out, &$first): void {
            if (!$first) {
                fwrite($out, ',');
            }
            $first = false;
            fwrite($out, (string) json_encode($row, JSON_UNESCAPED_SLASHES));
            // Periodic flush so the client sees progress and PHP releases buffers.
            @fflush($out);
        };

        try {
            $producer($emit);
        } catch (\Throwable $e) {
            Log::warning('[FederationData] Stream section failed', [
                'section' => $key,
                'error' => $e->getMessage(),
            ]);
        }

        fwrite($out, ']');
    }

    /** @param resource $out */
    private function streamPartnerships($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'partnerships', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_partnerships')) {
                return;
            }
            DB::table('federation_partnerships')
                ->select([
                    'id', 'tenant_id', 'partner_tenant_id', 'status', 'federation_level',
                    'messaging_enabled', 'transactions_enabled', 'profiles_enabled',
                    'listings_enabled', 'events_enabled', 'groups_enabled',
                    'requested_at', 'approved_at', 'terminated_at', 'notes',
                    'created_at', 'updated_at',
                ])
                ->where(function ($q) use ($tenantId): void {
                    $q->where('tenant_id', $tenantId)
                      ->orWhere('partner_tenant_id', $tenantId);
                })
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamExternalPartners($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'external_partners', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_external_partners')) {
                return;
            }
            DB::table('federation_external_partners')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $arr = (array) $r;
                        // Redact secrets — MUST NEVER emit these fields.
                        foreach (self::EXTERNAL_PARTNER_SECRET_FIELDS as $field) {
                            if (array_key_exists($field, $arr)) {
                                $arr[$field] = null;
                            }
                        }
                        $emit($arr);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamReputation($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'reputation', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_reputation')) {
                return;
            }
            DB::table('federation_reputation')
                ->select([
                    'id', 'user_id', 'home_tenant_id', 'trust_score', 'reliability_score',
                    'responsiveness_score', 'review_score', 'total_transactions',
                    'successful_transactions', 'reviews_received', 'reviews_given',
                    'hours_given', 'hours_received', 'is_verified', 'share_reputation',
                    'created_at', 'updated_at',
                ])
                ->where('home_tenant_id', $tenantId)
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamUserSettings($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'user_settings', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_user_settings')) {
                return;
            }
            DB::table('federation_user_settings as fus')
                ->join('users as u', 'u.id', '=', 'fus.user_id')
                ->where('u.tenant_id', $tenantId)
                ->select('fus.*')
                ->orderBy('fus.user_id')
                ->chunk(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamMessages($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'messages', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_messages')) {
                return;
            }
            DB::table('federation_messages')
                ->where(function ($q) use ($tenantId): void {
                    $q->where('sender_tenant_id', $tenantId)
                      ->orWhere('receiver_tenant_id', $tenantId);
                })
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamConnections($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'connections', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_connections')) {
                return;
            }
            DB::table('federation_connections')
                ->where(function ($q) use ($tenantId): void {
                    $q->where('requester_tenant_id', $tenantId)
                      ->orWhere('receiver_tenant_id', $tenantId);
                })
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamInternalTransactions($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'internal_transactions', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('transactions')) {
                return;
            }
            DB::table('transactions')
                ->where('is_federated', 1)
                ->where(function ($q) use ($tenantId): void {
                    $q->where('sender_tenant_id', $tenantId)
                      ->orWhere('receiver_tenant_id', $tenantId);
                })
                ->select([
                    'id', 'tenant_id', 'sender_id', 'receiver_id', 'amount', 'description',
                    'status', 'is_federated', 'sender_tenant_id', 'receiver_tenant_id',
                    'listing_id', 'transaction_type', 'created_at', 'updated_at',
                ])
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamDirectoryProfile($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'directory_profile', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_directory_profiles')) {
                return;
            }
            $row = DB::table('federation_directory_profiles')->where('tenant_id', $tenantId)->first();
            if ($row) {
                $emit((array) $row);
            }
        });
    }

    /** @param resource $out */
    private function streamNeighborhoodMemberships($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'neighborhood_memberships', function (callable $emit) use ($tenantId): void {
            foreach (['federation_neighborhood_tenants', 'federation_neighborhood_members'] as $table) {
                if (!$this->tableExists($table)) {
                    continue;
                }
                DB::table($table)
                    ->where('tenant_id', $tenantId)
                    ->orderBy('id')
                    ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit, $table): void {
                        foreach ($rows as $r) {
                            $row = (array) $r;
                            $row['membership_source'] = $table;
                            $emit($row);
                        }
                    });
            }
        });
    }

    /** @param resource $out */
    private function streamCreditAgreements($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'credit_agreements', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_credit_agreements')) {
                return;
            }
            DB::table('federation_credit_agreements')
                ->where(function ($q) use ($tenantId): void {
                    $q->where('from_tenant_id', $tenantId)
                      ->orWhere('to_tenant_id', $tenantId);
                })
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamAuditLog($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'audit_log', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_audit_log')) {
                return;
            }
            DB::table('federation_audit_log')
                ->where(function ($q) use ($tenantId): void {
                    $q->where('source_tenant_id', $tenantId)
                      ->orWhere('target_tenant_id', $tenantId);
                })
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $emit((array) $r);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamApiKeys($out, int $tenantId): void
    {
        $this->streamArraySection($out, 'api_keys', function (callable $emit) use ($tenantId): void {
            if (!$this->tableExists('federation_api_keys')) {
                return;
            }
            DB::table('federation_api_keys')
                ->where('tenant_id', $tenantId)
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit): void {
                    foreach ($rows as $r) {
                        $arr = (array) $r;
                        foreach (['key_hash', 'signing_secret'] as $field) {
                            if (array_key_exists($field, $arr)) {
                                $arr[$field] = null;
                            }
                        }
                        $emit($arr);
                    }
                });
        });
    }

    /** @param resource $out */
    private function streamApiLogs($out, int $tenantId, int $days): void
    {
        $this->streamArraySection($out, 'api_logs', function (callable $emit) use ($tenantId, $days): void {
            if (!$this->tableExists('federation_api_logs') || !$this->tableExists('federation_api_keys')) {
                return;
            }
            $since = date('Y-m-d H:i:s', strtotime("-{$days} days"));
            $emitted = 0;

            // Resolve tenant-owned api_key ids once so chunkById can operate on a
            // single-table query (chunkById doesn't play nicely with JOINs).
            $apiKeyIds = DB::table('federation_api_keys')
                ->where('tenant_id', $tenantId)
                ->pluck('id')
                ->all();

            if (empty($apiKeyIds)) {
                return;
            }

            DB::table('federation_api_logs')
                ->whereIn('api_key_id', $apiKeyIds)
                ->where('created_at', '>=', $since)
                ->select([
                    'id', 'api_key_id', 'endpoint', 'method', 'ip_address',
                    'signature_valid', 'auth_method', 'response_code',
                    'response_time_ms', 'created_at',
                ])
                ->orderBy('id')
                ->chunkById(self::STREAM_CHUNK_SIZE, function ($rows) use ($emit, &$emitted): bool {
                    foreach ($rows as $r) {
                        if ($emitted >= self::API_LOGS_MAX_ROWS) {
                            return false; // stop chunking
                        }
                        $emit((array) $r);
                        $emitted++;
                    }
                    return true;
                });
        });
    }

    /**
     * @param array<string,mixed> $data
     * @return array<int,array{code:string,message:string,field:string}>
     */
    private function validateImportShape(array $data): array
    {
        $errors = [];
        $allowedKeys = [
            'meta', 'partnerships', 'external_partners', 'reputation',
            'user_settings', 'messages', 'connections', 'internal_transactions',
            'directory_profile', 'neighborhood_memberships', 'credit_agreements',
            'audit_log', 'api_keys', 'api_logs',
        ];
        foreach ($data as $key => $value) {
            if (!in_array((string) $key, $allowedKeys, true)) {
                $errors[] = [
                    'code' => 'UNKNOWN_KEY',
                    'message' => __('errors.admin.federation.unknown_key', ['key' => $key]),
                    'field' => (string) $key,
                ];
            }
        }
        foreach (['partnerships', 'external_partners'] as $k) {
            if (isset($data[$k]) && !is_array($data[$k])) {
                $errors[] = [
                    'code' => 'INVALID_SHAPE',
                    'message' => __('errors.admin.federation.must_be_array', ['field' => $k]),
                    'field' => $k,
                ];
            }
        }
        return $errors;
    }

    private function tableExists(string $table): bool
    {
        if (!in_array($table, self::ALLOWED_TABLES, true)) {
            return false;
        }
        static $cache = [];
        if (array_key_exists($table, $cache)) {
            return $cache[$table];
        }
        try {
            DB::select("SELECT 1 FROM `{$table}` LIMIT 1");
            return $cache[$table] = true;
        } catch (\Throwable) {
            return $cache[$table] = false;
        }
    }

    private function columnExists(string $table, string $column): bool
    {
        if (!$this->tableExists($table)) {
            return false;
        }

        try {
            $columns = DB::select("SHOW COLUMNS FROM `{$table}` LIKE ?", [$column]);
            return !empty($columns);
        } catch (\Throwable) {
            return false;
        }
    }

}
