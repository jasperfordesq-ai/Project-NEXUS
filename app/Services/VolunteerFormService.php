<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\VolAccessibilityNeed;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerFormService — volunteer accessibility needs.
 *
 * Its custom-field half was removed on 17 Oct 2026: no client ever showed
 * those fields to a volunteer or stored an answer. The vol_custom_fields and
 * vol_custom_field_values tables stay, because GDPR export and erasure read them.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait on models.
 */
class VolunteerFormService
{
    public function __construct()
    {
    }

    /**
     * Get accessibility needs for a user within a tenant.
     *
     * @param int $userId
     * @param int $tenantId
     * @return array List of accessibility need records
     */
    public static function getAccessibilityNeeds(int $userId, int $tenantId): array
    {
        try {
            return VolAccessibilityNeed::where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->orderBy('need_type')
                ->get()
                ->map(fn ($row) => $row->toArray())
                ->toArray();
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::getAccessibilityNeeds error: ' . $e->getMessage());
            return [];
        }
    }

    /** The values `vol_accessibility_needs.need_type` accepts (a MariaDB enum). */
    public const ACCESSIBILITY_NEED_TYPES = ['mobility', 'visual', 'hearing', 'cognitive', 'dietary', 'language', 'other'];

    /** Column widths of `vol_accessibility_needs`, so an over-long value is refused rather than failing the write. */
    public const ACCESSIBILITY_EMERGENCY_NAME_MAX = 255;
    public const ACCESSIBILITY_EMERGENCY_PHONE_MAX = 50;
    /** `text` holds 65,535 bytes; 10,000 characters of 4-byte UTF-8 stays inside it. */
    public const ACCESSIBILITY_TEXT_MAX = 10000;

    /**
     * Check a replacement set of accessibility needs before anything is deleted.
     *
     * F-227: the save used to replace the member's whole set and report success
     * whatever happened. A duplicate need type (the unique key is
     * tenant+user+need_type), an unknown type or an over-long value made the
     * write fail and roll back while the member was told it had been saved, and
     * a request with no `needs` list at all replaced the set with nothing.
     *
     * @param mixed $needs The raw `needs` value from the request
     * @return string|null The offending field path, or null when the set is valid
     */
    public static function accessibilityNeedsInputError(mixed $needs): ?string
    {
        if (!is_array($needs) || !array_is_list($needs)) {
            return 'needs';
        }

        $seenTypes = [];
        $textLimits = [
            'description' => self::ACCESSIBILITY_TEXT_MAX,
            'accommodations_required' => self::ACCESSIBILITY_TEXT_MAX,
            'emergency_contact_name' => self::ACCESSIBILITY_EMERGENCY_NAME_MAX,
            'emergency_contact_phone' => self::ACCESSIBILITY_EMERGENCY_PHONE_MAX,
        ];

        foreach ($needs as $index => $need) {
            if (!is_array($need)) {
                return "needs.{$index}";
            }

            $type = $need['need_type'] ?? null;
            if (!is_string($type) || !in_array($type, self::ACCESSIBILITY_NEED_TYPES, true)) {
                return "needs.{$index}.need_type";
            }
            if (isset($seenTypes[$type])) {
                return "needs.{$index}.need_type";
            }
            $seenTypes[$type] = true;

            foreach ($textLimits as $field => $max) {
                $value = $need[$field] ?? null;
                if ($value === null) {
                    continue;
                }
                if (!is_string($value) || mb_strlen($value) > $max) {
                    return "needs.{$index}.{$field}";
                }
            }
        }

        return null;
    }

    /**
     * Replace all accessibility needs for a user (delete then insert within transaction).
     *
     * @param int $userId
     * @param array $data Array of need records
     * @param int $tenantId
     * @return bool True on success
     */
    public static function updateAccessibilityNeeds(int $userId, array $data, int $tenantId): bool
    {
        try {
            DB::transaction(function () use ($userId, $data, $tenantId) {
                // Delete existing needs for this user
                VolAccessibilityNeed::where('user_id', $userId)
                    ->where('tenant_id', $tenantId)
                    ->delete();

                // Insert new needs
                if (!empty($data)) {
                    foreach ($data as $need) {
                        VolAccessibilityNeed::create([
                            'tenant_id' => $tenantId,
                            'user_id' => $userId,
                            'need_type' => $need['need_type'] ?? '',
                            'description' => $need['description'] ?? null,
                            'accommodations_required' => $need['accommodations_required'] ?? null,
                            'emergency_contact_name' => $need['emergency_contact_name'] ?? null,
                            'emergency_contact_phone' => $need['emergency_contact_phone'] ?? null,
                        ]);
                    }
                }
            });

            return true;
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::updateAccessibilityNeeds error: ' . $e->getMessage());
            return false;
        }
    }
}
