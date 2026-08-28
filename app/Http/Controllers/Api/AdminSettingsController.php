<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\TenantSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AdminSettingsController -- Tenant settings and feature toggles.
 *
 * All methods require admin authentication. Super-admin-only settings
 * (maintenance_mode, registration_mode, etc.) are protected and cannot
 * be changed by regular tenant admins.
 */
class AdminSettingsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    /**
     * Setting keys that regular admins are allowed to modify.
     * Keys NOT in this list require super-admin privileges.
     */
    private const ADMIN_ALLOWED_KEYS = [
        'general.timezone',
        'general.welcome_message',
        'general.default_currency',
        // ISO 3166-1 alpha-2. Drives date and number formatting across the web,
        // mobile and accessible clients via App\I18n\FormattingLocale.
        //
        // This replaces `general.date_format` / `general.time_format`, which
        // were writable here and seeded at provisioning but READ BY NOTHING —
        // no PHP, no client — for their whole existence. A region beats a raw
        // pattern anyway: `d.m.Y` cannot produce translated month names and
        // cannot vary with the recipient's own language, which a community
        // sending mail in English and Irish needs.
        'general.region',
        'general.items_per_page',
        'general.welcome_credits',
        'general.footer_text',
        'general.partner_logo_url',
        'general.partner_logo_label',
        'general.powered_by_label',
        'general.powered_by_url',
        // Onboarding keys are managed by AdminOnboardingConfigController with its own whitelist
    ];

    /**
     * Setting keys that ONLY super-admins may modify.
     * Regular admins attempting to set these will receive a 403 error.
     */
    private const SUPER_ADMIN_ONLY_KEYS = [
        'general.maintenance_mode',
        'general.registration_mode',
        'general.email_verification',
        'general.admin_approval',
        'general.max_upload_size_mb',
    ];

    /**
     * All recognized setting key prefixes. Keys outside these namespaces are rejected.
     */
    private const ALLOWED_PREFIXES = [
        'general.',
        'onboarding.',
    ];

    /** GET /api/v2/admin/settings */
    public function index(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $settings = DB::select(
            'SELECT setting_key, setting_value FROM tenant_settings WHERE tenant_id = ?',
            [$tenantId]
        );

        $result = [];
        foreach ($settings as $s) {
            $result[$s->setting_key] = $s->setting_value;
        }

        return $this->respondWithData($result);
    }

    /** PUT /api/v2/admin/settings */
    public function update(): JsonResponse
    {
        $adminId = $this->requireAdmin();
        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();

        if (empty($data)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_settings_provided'), null, 422);
        }

        $isSuperAdmin = $this->isSuperAdmin();

        $updated = 0;
        $rejected = [];
        foreach ($data as $key => $value) {
            // Validate key format: alphanumeric + underscores/dots only, max 100 chars
            if (!is_string($key) || !preg_match('/^[a-zA-Z][a-zA-Z0-9_.]{0,99}$/', $key)) {
                continue;
            }

            // Reject keys outside recognized prefixes
            $hasValidPrefix = false;
            foreach (self::ALLOWED_PREFIXES as $prefix) {
                if (str_starts_with($key, $prefix)) {
                    $hasValidPrefix = true;
                    break;
                }
            }
            if (!$hasValidPrefix) {
                $rejected[] = $key;
                continue;
            }

            // Super-admin-only keys require elevated privileges
            if (in_array($key, self::SUPER_ADMIN_ONLY_KEYS, true) && !$isSuperAdmin) {
                $rejected[] = $key;
                continue;
            }

            // Regular admins can only modify keys in the explicit allowlist
            if (!$isSuperAdmin && !in_array($key, self::ADMIN_ALLOWED_KEYS, true)) {
                $rejected[] = $key;
                continue;
            }

            // Validate specific setting values
            $validationError = $this->validateSettingValue($key, $value);
            if ($validationError !== null) {
                return $this->respondWithError('VALIDATION_ERROR', $validationError, $key, 422);
            }

            $stringValue = is_array($value) ? json_encode($value) : (string) $value;
            DB::statement(
                'INSERT INTO tenant_settings (tenant_id, setting_key, setting_value) VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)',
                [$tenantId, $key, $stringValue]
            );
            $updated++;
        }

        // These writes go straight to the table, so the service's 5-minute
        // Redis cache would keep serving the old values — long enough for an
        // admin to conclude a setting had not saved. Formatting settings such
        // as general.region are read through that cache on every render.
        if ($updated > 0) {
            try {
                app(TenantSettingsService::class)->clearCacheForTenant($tenantId);
            } catch (\Throwable $e) {
                Log::warning('Tenant settings cache clear failed after admin update', [
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Audit log
        if ($updated > 0) {
            Log::info('Admin settings updated', [
                'admin_id' => $adminId,
                'tenant_id' => $tenantId,
                'keys_updated' => array_keys(
                    collect($data)->filter(fn ($v, $k) => !in_array($k, $rejected))->all()
                ),
            ]);
        }

        $response = ['updated' => $updated];
        if (!empty($rejected)) {
            $response['rejected_keys'] = $rejected;
        }

        return $this->respondWithData($response);
    }

    // Feature toggles — REMOVED 2026-08-28
    //
    // features() and toggleFeature() read and wrote a `tenant_features` table
    // that exists in no migration, no schema dump and no live database. Neither
    // was routed and nothing called them internally, so the feature never ran.
    // Real feature toggling goes through App\Services\TenantFeatureConfig and
    // the tenants.features JSON column.

    /**
     * Validate specific setting values for safety bounds.
     *
     * @return string|null Error message, or null if valid
     */
    private function validateSettingValue(string $key, mixed $value): ?string
    {
        return match ($key) {
            'general.max_upload_size_mb' => (function () use ($value) {
                $mb = (int) $value;
                if ($mb < 1 || $mb > 50) {
                    return __('api.max_upload_size_range');
                }
                return null;
            })(),
            'general.items_per_page' => (function () use ($value) {
                $ipp = (int) $value;
                if ($ipp < 5 || $ipp > 100) {
                    return __('api.items_per_page_range');
                }
                return null;
            })(),
            'general.welcome_credits' => (function () use ($value) {
                $wc = (int) $value;
                if ($wc < 0 || $wc > 100) {
                    return __('api.welcome_credits_range');
                }
                return null;
            })(),
            'general.maintenance_mode' => (function () use ($value) {
                if (!in_array((string) $value, ['true', 'false', '1', '0'], true)) {
                    return __('api.maintenance_mode_boolean');
                }
                return null;
            })(),
            'general.registration_mode' => (function () use ($value) {
                if (!in_array($value, ['open', 'closed', 'invite_only'], true)) {
                    return __('api.registration_mode_invalid');
                }
                return null;
            })(),
            'general.region' => (function () use ($value) {
                // ISO 3166-1 alpha-2. Deliberately a shape check rather than a
                // closed country list: this only selects formatting
                // conventions, and an unknown pair degrades to the base
                // language rather than failing (see FormattingLocale::carbon).
                if (!is_string($value) || preg_match('/^[A-Za-z]{2}$/', trim($value)) !== 1) {
                    return __('api.region_invalid');
                }
                return null;
            })(),
            default => null,
        };
    }

    /**
     * Check if current authenticated user is a super admin.
     */
    private function isSuperAdmin(): bool
    {
        try {
            $this->requireSuperAdmin();
            return true;
        } catch (\Throwable) {
            return false;
        }
    }
}
