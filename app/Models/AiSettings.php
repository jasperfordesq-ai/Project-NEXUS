<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * AI Settings model — provides static helpers for tenant-scoped AI configuration.
 */
class AiSettings extends Model
{
    use HasTenantScope;

    protected $table = 'ai_settings';

    protected $fillable = [
        'tenant_id',
        'setting_key',
        'setting_value',
        'is_encrypted',
    ];

    protected $casts = [
        'is_encrypted' => 'boolean',
    ];

    /**
     * Get all AI settings for a tenant as key => value array.
     */
    public static function getAllForTenant(int $tenantId): array
    {
        return DB::table('ai_settings')
            ->where('tenant_id', $tenantId)
            ->pluck('setting_value', 'setting_key')
            ->toArray();
    }

    /**
     * Get a single setting value.
     */
    public static function get(int $tenantId, string $key, ?string $default = null): ?string
    {
        return DB::table('ai_settings')
            ->where('tenant_id', $tenantId)
            ->where('setting_key', $key)
            ->value('setting_value') ?? $default;
    }

    /**
     * Check if a setting exists and is non-empty.
     */
    public static function has(int $tenantId, string $key): bool
    {
        $value = self::get($tenantId, $key);
        return !empty($value);
    }

    /**
     * Parse a persisted administrator switch using recognized boolean values.
     * Unknown non-empty strings fail closed instead of inheriting PHP's
     * surprising `(bool) "false" === true` behaviour.
     */
    public static function parseBoolean(mixed $value): bool
    {
        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) === true;
    }

    /**
     * Get a masked version of a setting (for display).
     */
    public static function getMasked(int $tenantId, string $key): ?string
    {
        $value = self::get($tenantId, $key);
        if (empty($value)) {
            return null;
        }
        return substr($value, 0, 4) . str_repeat('*', max(0, strlen($value) - 8)) . substr($value, -4);
    }

    /**
     * Set multiple settings at once.
     */
    public static function setMultiple(int $tenantId, array $settings): void
    {
        foreach ($settings as $key => $value) {
            DB::table('ai_settings')->updateOrInsert(
                ['tenant_id' => $tenantId, 'setting_key' => $key],
                ['setting_value' => $value, 'updated_at' => now()]
            );
        }
    }
}
