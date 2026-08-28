<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * DeliverableService — Laravel DI-based service for project deliverable tracking.
 *
 * Manages deliverables lifecycle including creation, updates, and comment threads.
 */
class DeliverableService
{
    /**
     * Get all deliverables for a project/tenant.
     */
    public function getAll(int $tenantId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $offset = max(0, (int) ($filters['offset'] ?? 0));

        $query = DB::table('deliverables')->where('tenant_id', $tenantId);

        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (! empty($filters['project_id'])) {
            $query->where('project_id', (int) $filters['project_id']);
        }

        $total = $query->count();
        $items = $query->orderByDesc('created_at')->offset($offset)->limit($limit)
            ->get()->map(fn ($r) => (array) $r)->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * Get a single deliverable by ID.
     */
    public function getById(int $id, int $tenantId): ?array
    {
        $row = DB::table('deliverables')->where('id', $id)->where('tenant_id', $tenantId)->first();
        return $row ? (array) $row : null;
    }

    /**
     * Update an existing deliverable.
     */
    public function update(int $id, int $tenantId, array $data): bool
    {
        $allowed = ['title', 'description', 'status', 'due_date', 'assigned_to'];
        $update = array_intersect_key($data, array_flip($allowed));
        $update['updated_at'] = now();

        return DB::table('deliverables')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($update) > 0;
    }
}
