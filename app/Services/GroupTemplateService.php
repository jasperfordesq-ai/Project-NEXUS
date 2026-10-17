<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use App\Core\TenantContext;

/**
 * GroupTemplateService — Pre-configured group templates for quick creation.
 */
class GroupTemplateService
{
    /**
     * Get all active templates for the tenant.
     */
    public static function getAll(): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('group_templates')
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get()
            ->map(function ($row) {
                $row->default_tags = json_decode($row->default_tags, true);
                $row->features = json_decode($row->features, true);
                return (array) $row;
            })
            ->toArray();
    }

    /**
     * Get a single template.
     */
    public static function get(int $templateId): ?array
    {
        $tenantId = TenantContext::getId();

        $template = DB::table('group_templates')
            ->where('id', $templateId)
            ->where('tenant_id', $tenantId)
            ->first();

        if (!$template) return null;

        $template->default_tags = json_decode($template->default_tags, true);
        $template->features = json_decode($template->features, true);
        return (array) $template;
    }

    /**
     * Create a template.
     */
    public static function create(array $data): int
    {
        $tenantId = TenantContext::getId();

        return DB::table('group_templates')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => $data['name'],
            'description' => $data['description'] ?? null,
            'icon' => $data['icon'] ?? null,
            'default_visibility' => $data['default_visibility'] ?? 'public',
            'default_type_id' => $data['default_type_id'] ?? null,
            'default_tags' => json_encode($data['default_tags'] ?? []),
            'features' => json_encode($data['features'] ?? []),
            'welcome_message' => $data['welcome_message'] ?? null,
            'is_active' => $data['is_active'] ?? true,
            'sort_order' => $data['sort_order'] ?? 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /**
     * Update a template.
     */
    public static function update(int $templateId, array $data): bool
    {
        $tenantId = TenantContext::getId();

        $update = ['updated_at' => now()];
        foreach (['name', 'description', 'icon', 'default_visibility', 'default_type_id', 'welcome_message', 'is_active', 'sort_order'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = $data[$field];
            }
        }
        if (isset($data['default_tags'])) $update['default_tags'] = json_encode($data['default_tags']);
        if (isset($data['features'])) $update['features'] = json_encode($data['features']);

        return DB::table('group_templates')
            ->where('id', $templateId)
            ->where('tenant_id', $tenantId)
            ->update($update) > 0;
    }

    /**
     * Delete a template.
     */
    public static function delete(int $templateId): bool
    {
        $tenantId = TenantContext::getId();

        return DB::table('group_templates')
            ->where('id', $templateId)
            ->where('tenant_id', $tenantId)
            ->delete() > 0;
    }

    /**
     * Apply a template when creating a group — returns settings to pass to GroupService::create().
     */
    public static function applyTemplate(int $templateId): ?array
    {
        $template = self::get($templateId);
        if (!$template) return null;

        return [
            'visibility' => $template['default_visibility'],
            'type_id' => $template['default_type_id'],
            'features' => $template['features'] ?? [],
            'welcome_message' => $template['welcome_message'],
        ];
    }
}
