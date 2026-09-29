<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\VolAccessibilityNeed;
use App\Models\VolCustomField;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * VolunteerFormService — custom fields, form values, and accessibility needs.
 *
 * Manages dynamic form fields for volunteer applications and profiles,
 * custom field value storage for entities, and accessibility needs tracking.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait on models.
 */
class VolunteerFormService
{
    public function __construct()
    {
    }

    /**
     * Get active custom fields, optionally filtered by organization and applies_to context.
     *
     * @param int|null $organizationId Filter by organization (null = global fields only)
     * @param string $appliesTo Context: 'application', 'profile', 'shift', etc.
     * @return array List of custom field definitions ordered by display_order
     */
    public static function getCustomFields(?int $organizationId = null, string $appliesTo = 'application'): array
    {
        try {
            $query = VolCustomField::where('applies_to', $appliesTo)
                ->where('is_active', true);

            if ($organizationId !== null) {
                $query->where(function ($q) use ($organizationId) {
                    $q->where('organization_id', $organizationId)
                        ->orWhereNull('organization_id');
                });
            } else {
                $query->whereNull('organization_id');
            }

            return $query->orderBy('display_order')
                ->orderBy('id')
                ->get()
                ->map(fn ($field) => self::formatCustomField($field->toArray()))
                ->toArray();
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::getCustomFields error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Create a new custom field definition.
     *
     * @param array $data Field definition data
     * @return array The created field record
     */
    public static function createField(array $data): array
    {
        try {
            $normalized = self::normalizeCustomFieldPayload($data);

            $field = VolCustomField::create([
                'tenant_id' => TenantContext::getId(),
                'organization_id' => $normalized['organization_id'] ?? null,
                'field_key' => $normalized['field_key'] ?? '',
                'field_label' => $normalized['field_label'] ?? '',
                'field_type' => $normalized['field_type'] ?? 'text',
                'applies_to' => $normalized['applies_to'] ?? 'application',
                'is_required' => $normalized['is_required'] ?? 0,
                'field_options' => $normalized['field_options'] ?? null,
                'display_order' => $normalized['display_order'] ?? 0,
                'placeholder' => $normalized['placeholder'] ?? null,
                'help_text' => $normalized['help_text'] ?? null,
                'is_active' => 1,
            ]);

            return self::formatCustomField($field->fresh()->toArray());
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::createField error: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Update a custom field definition.
     *
     * @param int $id Field ID
     * @param array $data Fields to update
     * @return bool
     */
    public static function updateField(int $id, array $data): bool
    {
        try {
            $field = VolCustomField::find($id);
            if (!$field) {
                return false;
            }

            $data = self::normalizeCustomFieldPayload($data);

            $allowedFields = [
                'field_key', 'field_label', 'field_type', 'applies_to',
                'is_required', 'field_options', 'display_order', 'placeholder', 'help_text',
            ];

            $updates = [];
            foreach ($allowedFields as $fieldName) {
                if (array_key_exists($fieldName, $data)) {
                    $updates[$fieldName] = $data[$fieldName];
                }
            }

            if (empty($updates)) {
                return false;
            }

            return $field->update($updates);
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::updateField error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    private static function normalizeCustomFieldPayload(array $data): array
    {
        if (!isset($data['field_label']) && isset($data['label'])) {
            $data['field_label'] = $data['label'];
        }

        if (!isset($data['field_key']) && isset($data['name'])) {
            $data['field_key'] = $data['name'];
        }

        if (!isset($data['field_key']) && isset($data['field_name'])) {
            $data['field_key'] = $data['field_name'];
        }

        if (!isset($data['field_options']) && array_key_exists('options', $data)) {
            $data['field_options'] = $data['options'];
        }

        if (!isset($data['field_options']) && array_key_exists('options_json', $data)) {
            $data['field_options'] = $data['options_json'];
        }

        // VolCustomField casts field_options to 'array', so the value must be
        // set as an array — setting a JSON string through the cast would
        // double-encode it. Accept legacy JSON-string input by decoding.
        if (isset($data['field_options']) && is_string($data['field_options'])) {
            $decoded = json_decode($data['field_options'], true);
            $data['field_options'] = is_array($decoded) ? $decoded : null;
        }

        return $data;
    }

    /**
     * @param array<string, mixed> $field
     * @return array<string, mixed>
     */
    private static function formatCustomField(array $field): array
    {
        $options = $field['field_options'] ?? null;

        $field['label'] = $field['label'] ?? ($field['field_label'] ?? '');
        $field['name'] = $field['name'] ?? ($field['field_key'] ?? '');
        $field['options'] = is_string($options) ? (json_decode($options, true) ?: $options) : $options;

        return $field;
    }

    /**
     * Soft-delete a custom field (set is_active = 0).
     *
     * @param int $id Field ID
     * @return bool
     */
    public static function deleteField(int $id): bool
    {
        try {
            $field = VolCustomField::find($id);
            if (!$field) {
                return false;
            }

            return $field->update(['is_active' => 0]);
        } catch (\Exception $e) {
            Log::error('VolunteerFormService::deleteField error: ' . $e->getMessage());
            return false;
        }
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
