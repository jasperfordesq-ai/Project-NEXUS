<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\TenantProvisioning;

use App\Services\TenantDefaultsSeeder;
use App\Services\TenantFeatureConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Str;
use InvalidArgumentException;
use RuntimeException;
use Throwable;

/**
 * AG44 — Self-service regional node provisioning.
 *
 * Pipeline:
 *   submitRequest()        — public form intake
 *   approveAndProvision()  — super-admin approval, dispatched as a job
 *   reject()               — super-admin rejection + email
 *
 * Provisioning steps (each appended to `provisioning_log`):
 *   1. Create tenants row
 *   2. Seed default categories / member attributes / navigation menus / settings /
 *      federation tables (shared with the hierarchy path via TenantDefaultsSeeder)
 *   3. Create initial admin user (applicant_email)
 *   4. Apply caring-community preset if applicable
 *   5. Mark request `provisioned` and link `provisioned_tenant_id`
 */
class TenantProvisioningService
{
    public const TABLE = 'tenant_provisioning_requests';

    /**
     * Slugs the public form must reject. Mirrors the platform's reserved
     * subdomains and important platform routes.
     */
    public const RESERVED_SLUGS = [
        'admin', 'api', 'www', 'app', 'mail', 'ftp', 'blog', 'status',
        'support', 'help', 'docs', 'agoris', 'hour-timebank', 'master',
        'platform', 'super-admin', 'auth', 'login', 'register', 'static',
        'assets', 'cdn', 'media', 'public', 'private', 'internal',
        'test', 'staging', 'production', 'dev', 'local',
    ];

    public const VALID_CATEGORIES = [
        'kiss_cooperative',
        'caring_community',
        'agoris_node',
        'community',
    ];

    public const VALID_BUCKETS = [
        'under_50',
        '50_250',
        '250_1000',
        '1000_5000',
        '5000_plus',
    ];

    /**
     * Returns true when the migration has been run.
     */
    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    /**
     * Validate the requested slug is structurally valid AND not in use.
     *
     * @return array{available: bool, reason?: string}
     */
    public static function validateSlugAvailable(string $slug): array
    {
        $slug = strtolower(trim($slug));

        if ($slug === '' || ! preg_match('/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$/', $slug)) {
            return ['available' => false, 'reason' => 'invalid_format'];
        }

        if (in_array($slug, self::RESERVED_SLUGS, true)) {
            return ['available' => false, 'reason' => 'reserved'];
        }

        $taken = DB::table('tenants')->where('slug', $slug)->exists();
        if ($taken) {
            return ['available' => false, 'reason' => 'taken'];
        }

        if (self::isAvailable()) {
            $pending = DB::table(self::TABLE)
                ->where('requested_slug', $slug)
                ->whereIn('status', ['pending', 'under_review', 'approved'])
                ->exists();
            if ($pending) {
                return ['available' => false, 'reason' => 'pending'];
            }
        }

        return ['available' => true];
    }

    /**
     * Public form submission.
     *
     * @param  array<string, mixed>  $data
     * @return array<string, mixed>  the persisted row
     *
     * @throws InvalidArgumentException on validation failure
     */
    public static function submitRequest(array $data, ?string $ipHash = null): array
    {
        // Required fields
        $required = ['applicant_name', 'applicant_email', 'org_name', 'requested_slug', 'tenant_category'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                throw new InvalidArgumentException(__('api.provisioning_field_required', ['field' => $field]));
            }
        }

        $email = strtolower(trim((string) $data['applicant_email']));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException(__('api.provisioning_invalid_email'));
        }

        $category = (string) $data['tenant_category'];
        if (! in_array($category, self::VALID_CATEGORIES, true)) {
            throw new InvalidArgumentException(__('api.provisioning_invalid_category'));
        }

        $slug = strtolower(trim((string) $data['requested_slug']));
        $slugCheck = self::validateSlugAvailable($slug);
        if (! ($slugCheck['available'] ?? false)) {
            throw new InvalidArgumentException(__('api.provisioning_slug_unavailable', [
                'reason' => $slugCheck['reason'] ?? 'taken',
            ]));
        }

        $bucket = isset($data['expected_member_count_bucket']) ? (string) $data['expected_member_count_bucket'] : null;
        if ($bucket !== null && $bucket !== '' && ! in_array($bucket, self::VALID_BUCKETS, true)) {
            $bucket = null;
        }

        $languages = $data['languages'] ?? ['en'];
        if (is_string($languages)) {
            $decoded = json_decode($languages, true);
            $languages = is_array($decoded) ? $decoded : ['en'];
        }
        $languages = array_values(array_filter(array_map(static fn ($l) => is_string($l) ? substr(trim($l), 0, 5) : null, (array) $languages)));
        if ($languages === []) {
            $languages = ['en'];
        }

        $defaultLanguage = isset($data['default_language']) && is_string($data['default_language'])
            ? substr(trim($data['default_language']), 0, 5)
            : ($languages[0] ?? 'en');

        $subdomain = isset($data['requested_subdomain']) && $data['requested_subdomain'] !== ''
            ? strtolower(trim((string) $data['requested_subdomain']))
            : null;

        if ($subdomain !== null) {
            $subTaken = DB::table(self::TABLE)
                ->where('requested_subdomain', $subdomain)
                ->exists();
            if ($subTaken) {
                throw new InvalidArgumentException(__('api.provisioning_subdomain_unavailable'));
            }
        }

        // 1/day per email rate-limit
        $recent = DB::table(self::TABLE)
            ->where('applicant_email', $email)
            ->where('created_at', '>=', now()->subDay())
            ->exists();
        if ($recent) {
            throw new InvalidArgumentException(__('api.provisioning_too_recent'));
        }

        $now = now();
        $row = [
            'applicant_name'                => trim((string) $data['applicant_name']),
            'applicant_email'               => $email,
            'applicant_phone'               => isset($data['applicant_phone']) ? trim((string) $data['applicant_phone']) : null,
            'org_name'                      => trim((string) $data['org_name']),
            'country_code'                  => strtoupper(substr(trim((string) ($data['country_code'] ?? 'CH')), 0, 2)),
            'region_or_canton'              => isset($data['region_or_canton']) ? trim((string) $data['region_or_canton']) : null,
            'requested_slug'                => $slug,
            'requested_subdomain'           => $subdomain,
            'tenant_category'               => $category,
            'languages'                     => json_encode($languages),
            'default_language'              => $defaultLanguage,
            'expected_member_count_bucket'  => $bucket,
            'intended_use'                  => isset($data['intended_use']) ? trim((string) $data['intended_use']) : null,
            'captcha_token'                 => isset($data['captcha_token']) ? substr((string) $data['captcha_token'], 0, 500) : null,
            'ip_hash'                       => $ipHash,
            'status_token'                  => Str::random(40),
            'status'                        => 'pending',
            'provisioning_log'              => json_encode([]),
            'created_at'                    => $now,
            'updated_at'                    => $now,
        ];

        $id = DB::table(self::TABLE)->insertGetId($row);
        $row['id'] = $id;

        return $row;
    }

    /**
     * Mark a request approved and run the provisioning pipeline.
     *
     * @return array<string, mixed>  the (possibly partial) request row
     *
     * @throws RuntimeException on irrecoverable failure
     */
    public static function approveAndProvision(int $requestId, int $reviewerId): array
    {
        $request = DB::table(self::TABLE)->where('id', $requestId)->first();
        if (! $request) {
            throw new InvalidArgumentException(__('api.provisioning_request_not_found'));
        }

        if ($request->status === 'provisioned' && $request->provisioned_tenant_id) {
            return (array) $request;
        }

        DB::table(self::TABLE)->where('id', $requestId)->update([
            'status'      => 'approved',
            'reviewed_by' => $reviewerId,
            'reviewed_at' => now(),
            'updated_at'  => now(),
        ]);

        $log = self::decodeLog($request->provisioning_log ?? null);
        $tempPassword = null;
        $tenantId = null;
        $adminUserId = null;

        try {
            // Step 1 — create tenants row
            $tenantId = self::createTenantRow((array) $request);
            $log[] = self::logEntry('create_tenant', 'ok', ['tenant_id' => $tenantId]);

            // Step 2 — seed defaults (categories/attributes/menus/settings/federation)
            self::seedTenantDefaults($tenantId, (array) $request, $reviewerId);
            $log[] = self::logEntry('seed_defaults', 'ok');

            // Step 3 — create admin user
            [$adminUserId, $tempPassword] = self::createAdminUser($tenantId, (array) $request);
            $log[] = self::logEntry('create_admin_user', 'ok', ['user_id' => $adminUserId]);

            // Step 4 — apply caring-community preset where applicable
            if (in_array($request->tenant_category, ['kiss_cooperative', 'caring_community'], true)) {
                self::applyCaringPreset($tenantId, (array) $request);
                $log[] = self::logEntry('apply_caring_preset', 'ok');
            }

            // Step 5 — send welcome email (best-effort)
            try {
                TenantProvisioningMailer::sendWelcome((array) $request, $tenantId, $tempPassword);
                $log[] = self::logEntry('send_welcome_email', 'ok');
            } catch (Throwable $e) {
                $log[] = self::logEntry('send_welcome_email', 'warn', ['error' => $e->getMessage()]);
            }

            DB::table(self::TABLE)->where('id', $requestId)->update([
                'status'                => 'provisioned',
                'provisioned_tenant_id' => $tenantId,
                'provisioning_log'      => json_encode($log),
                'updated_at'            => now(),
            ]);
        } catch (Throwable $e) {
            $log[] = self::logEntry('pipeline', 'error', ['error' => $e->getMessage()]);
            DB::table(self::TABLE)->where('id', $requestId)->update([
                'status'           => 'failed',
                'provisioning_log' => json_encode($log),
                'updated_at'       => now(),
            ]);
            Log::error('TenantProvisioningService: pipeline failed', [
                'request_id' => $requestId,
                'error'      => $e->getMessage(),
            ]);
            throw new RuntimeException('Provisioning failed: ' . $e->getMessage(), 0, $e);
        }

        return (array) DB::table(self::TABLE)->where('id', $requestId)->first();
    }

    /**
     * Reject a pending request.
     */
    public static function reject(int $requestId, string $reason, int $reviewerId): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new InvalidArgumentException(__('api.provisioning_reject_reason_required'));
        }

        $request = DB::table(self::TABLE)->where('id', $requestId)->first();
        if (! $request) {
            throw new InvalidArgumentException(__('api.provisioning_request_not_found'));
        }

        if (! TenantProvisioningMailer::sendRejection((array) $request, $reason)) {
            throw new RuntimeException('Tenant provisioning rejection email was not accepted for delivery.');
        }

        DB::table(self::TABLE)->where('id', $requestId)->update([
            'status'           => 'rejected',
            'rejection_reason' => $reason,
            'reviewed_by'      => $reviewerId,
            'reviewed_at'      => now(),
            'updated_at'       => now(),
        ]);

        return (array) DB::table(self::TABLE)->where('id', $requestId)->first();
    }

    /**
     * List requests for the super-admin queue.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function listRequests(?string $status = null): array
    {
        $q = DB::table(self::TABLE)->orderByDesc('created_at');
        if ($status !== null && $status !== '') {
            $q->where('status', $status);
        }
        return $q->get()->map(static fn ($r) => (array) $r)->all();
    }

    public static function getRequest(int $id): ?array
    {
        $row = DB::table(self::TABLE)->where('id', $id)->first();
        return $row ? (array) $row : null;
    }

    public static function getRequestByToken(string $token): ?array
    {
        $row = DB::table(self::TABLE)->where('status_token', $token)->first();
        if (! $row) {
            return null;
        }
        // Strip sensitive fields before returning to public callers.
        $public = (array) $row;
        unset(
            $public['captcha_token'],
            $public['ip_hash'],
            $public['provisioning_log'],
            $public['rejection_reason'],
            $public['reviewed_by'],
        );
        return $public;
    }

    // ─── Pipeline helpers ────────────────────────────────────────────────────

    private static function createTenantRow(array $request): int
    {
        $defaults = TenantFeatureConfig::FEATURE_DEFAULTS ?? [];

        $configuration = [
            'modules' => [
                'events'       => true,
                'polls'        => true,
                'goals'        => true,
                'volunteering' => true,
                'resources'    => true,
            ],
            'supported_languages' => json_decode((string) ($request['languages'] ?? '["en"]'), true) ?: ['en'],
            'default_language'    => $request['default_language'] ?? 'en',
        ];

        $now = now();
        $insert = [
            'name'             => $request['org_name'],
            'slug'             => $request['requested_slug'],
            'tenant_category'  => $request['tenant_category'] ?? 'community',
            'default_layout'   => 'modern',
            'theme'            => 'modern',
            'tagline'          => null,
            'features'         => json_encode($defaults),
            'configuration'    => json_encode($configuration),
            'contact_email'    => $request['applicant_email'],
            'contact_phone'    => $request['applicant_phone'] ?? null,
            'is_active'        => 1,
            'country_code'     => $request['country_code'] ?? 'CH',
            'location_name'    => $request['region_or_canton'] ?? null,
            'created_at'       => $now,
            'updated_at'       => $now,
        ];

        // Optional subdomain → domain hint (operator still needs to wire DNS)
        if (! empty($request['requested_subdomain'])) {
            $insert['domain'] = $request['requested_subdomain'] . '.project-nexus.ie';
        }

        return (int) DB::table('tenants')->insertGetId($insert);
    }

    /**
     * Reuse existing seeders / commands where possible. Failures in any
     * one optional seeder MUST NOT abort the pipeline — they're logged and
     * skipped. The tenant is still usable from the admin panel.
     */
    private static function seedTenantDefaults(int $tenantId, array $request, ?int $reviewerId = null): void
    {
        // Federation tables: mirror the canonical seeding in
        // TenantHierarchyService (per-feature rows, default-on).
        // federation_system_control is a platform-wide singleton — never
        // seeded per tenant.
        $now = now();

        if (Schema::hasTable('federation_tenant_whitelist') && $reviewerId !== null) {
            try {
                DB::table('federation_tenant_whitelist')->insertOrIgnore([
                    'tenant_id'   => $tenantId,
                    'approved_at' => $now,
                    'approved_by' => $reviewerId,
                    'notes'       => 'Auto-approved during tenant provisioning',
                ]);
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: federation_tenant_whitelist skipped', ['error' => $e->getMessage()]);
            }
        }

        if (Schema::hasTable('federation_tenant_features')) {
            try {
                $federationFeatures = [
                    'tenant_federation_enabled',
                    'tenant_appear_in_directory',
                    'tenant_profiles_enabled',
                    'tenant_messaging_enabled',
                    'tenant_transactions_enabled',
                    'tenant_listings_enabled',
                    'tenant_events_enabled',
                    'tenant_groups_enabled',
                ];
                foreach ($federationFeatures as $featureKey) {
                    DB::table('federation_tenant_features')->insertOrIgnore([
                        'tenant_id'   => $tenantId,
                        'feature_key' => $featureKey,
                        'is_enabled'  => 1,
                        'updated_at'  => $now,
                    ]);
                }
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: federation_tenant_features skipped', ['error' => $e->getMessage()]);
            }
        }

        // Tenant settings — minimum viable set
        if (Schema::hasTable('tenant_settings')) {
            $settings = [
                'general.timezone'         => 'Europe/Zurich',
                'general.default_currency' => 'CHF',
                'general.date_format'      => 'd.m.Y',
                'general.time_format'      => 'H:i',
                'general.welcome_credits'  => '5',
                'onboarding.enabled'       => '1',
                'onboarding.mandatory'     => '0',
            ];
            foreach ($settings as $key => $val) {
                try {
                    DB::table('tenant_settings')->updateOrInsert(
                        ['tenant_id' => $tenantId, 'setting_key' => $key],
                        ['setting_value' => $val, 'created_at' => $now, 'updated_at' => $now]
                    );
                } catch (Throwable $e) {
                    Log::info('seedTenantDefaults: tenant_settings entry skipped', ['key' => $key, 'error' => $e->getMessage()]);
                }
            }
        }

        // Default categories / member attributes / navigation menus — the same
        // canonical day-one defaults the hierarchy path seeds, via the shared
        // TenantDefaultsSeeder so the two creation paths never drift. Each is
        // idempotent and non-fatal (a provisioned tenant must still come up).
        if (Schema::hasTable('categories')) {
            try {
                TenantDefaultsSeeder::seedCategories($tenantId);
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: seedCategories skipped', ['error' => $e->getMessage()]);
            }
        }
        if (Schema::hasTable('attributes')) {
            try {
                TenantDefaultsSeeder::seedAttributes($tenantId);
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: seedAttributes skipped', ['error' => $e->getMessage()]);
            }
        }
        if (Schema::hasTable('menus') && Schema::hasTable('menu_items')) {
            try {
                TenantDefaultsSeeder::seedMenus($tenantId);
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: seedMenus skipped', ['error' => $e->getMessage()]);
            }
        }

        // The standard shipped Terms of Service, as an acceptable document.
        // Acceptance enforcement only blocks on a row in legal_documents, so
        // without this a newly provisioned community has nothing for a member
        // to accept. Never overwrites a community's own terms.
        if (Schema::hasTable('legal_documents')) {
            try {
                TenantDefaultsSeeder::seedStandardLegalDocuments($tenantId);
            } catch (Throwable $e) {
                Log::info('seedTenantDefaults: seedStandardLegalDocuments skipped', ['error' => $e->getMessage()]);
            }
        }
    }

    /**
     * @return array{0: int, 1: string} [adminUserId, tempPassword]
     */
    private static function createAdminUser(int $tenantId, array $request): array
    {
        $tempPassword = Str::random(16);
        $email = $request['applicant_email'];

        // If a user with this email already exists for the tenant, reuse it.
        $existing = DB::table('users')
            ->where('email', $email)
            ->where('tenant_id', $tenantId)
            ->first();

        if ($existing) {
            DB::table('users')->where('id', $existing->id)->update([
                'role'          => 'admin',
                'is_approved'   => 1,
                'status'        => 'active',
                'updated_at'    => now(),
            ]);
            return [(int) $existing->id, ''];
        }

        $now = now();
        $name = $request['applicant_name'] ?: 'Admin';
        $hash = Hash::make($tempPassword);

        $insert = [
            'tenant_id'    => $tenantId,
            'name'         => $name,
            'first_name'   => self::firstName($name),
            'last_name'    => self::lastName($name),
            'email'        => $email,
            'password_hash' => $hash,
            'password'     => $hash,
            'role'         => 'admin',
            'is_super_admin' => 0,
            'is_approved'  => 1,
            'status'       => 'active',
            'created_at'   => $now,
            'updated_at'   => $now,
        ];

        $userId = (int) DB::table('users')->insertGetId($insert);
        return [$userId, $tempPassword];
    }

    private static function applyCaringPreset(int $tenantId, array $request): void
    {
        $tenant = DB::table('tenants')->where('id', $tenantId)->first();
        if (! $tenant) {
            return;
        }
        try {
            Artisan::call('tenant:apply-caring-community-preset', [
                'slug' => $tenant->slug,
            ]);
        } catch (Throwable $e) {
            Log::warning('applyCaringPreset failed', ['error' => $e->getMessage()]);
        }
    }

    // ─── Misc helpers ────────────────────────────────────────────────────────

    private static function firstName(string $name): string
    {
        $parts = preg_split('/\s+/', trim($name)) ?: [];
        return $parts[0] ?? $name;
    }

    private static function lastName(string $name): string
    {
        $parts = preg_split('/\s+/', trim($name)) ?: [];
        if (count($parts) <= 1) {
            return '';
        }
        return implode(' ', array_slice($parts, 1));
    }

    private static function logEntry(string $step, string $status, array $extra = []): array
    {
        return array_merge([
            'step'   => $step,
            'status' => $status,
            'at'     => now()->toIso8601String(),
        ], $extra);
    }

    private static function decodeLog(?string $raw): array
    {
        if ($raw === null || $raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        return is_array($decoded) ? $decoded : [];
    }
}
