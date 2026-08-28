<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * DeliverableController -- Project deliverable management (CRUD, comments).
 *
 * All methods require authentication.
 */
class DeliverableController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct() {}

    /** GET /api/v2/deliverables */
    public function index(): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();
        $page = $this->queryInt('page', 1, 1);
        $perPage = $this->queryInt('per_page', 20, 1, 100);
        $offset = ($page - 1) * $perPage;

        $items = DB::select(
            'SELECT * FROM deliverables WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [$tenantId, $perPage, $offset]
        );
        $total = DB::selectOne(
            'SELECT COUNT(*) as cnt FROM deliverables WHERE tenant_id = ?',
            [$tenantId]
        )->cnt;

        return $this->respondWithPaginatedCollection($items, (int) $total, $page, $perPage);
    }

    /** GET /api/v2/deliverables/{id} */
    public function show(int $id): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();

        $deliverable = DB::selectOne(
            'SELECT * FROM deliverables WHERE id = ? AND tenant_id = ?',
            [$id, $tenantId]
        );

        if ($deliverable === null) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        return $this->respondWithData($deliverable);
    }

    /** POST /api/v2/deliverables */
    public function store(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $title = $this->requireInput('title');
        $description = $this->input('description', '');
        $dueDate = $this->input('due_date');
        $status = $this->input('status', 'pending');

        DB::insert(
            'INSERT INTO deliverables (tenant_id, user_id, title, description, due_date, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [$tenantId, $userId, $title, $description, $dueDate, $status]
        );

        $id = (int) DB::getPdo()->lastInsertId();

        return $this->respondWithData(['id' => $id, 'title' => $title, 'status' => $status], null, 201);
    }

    /** PUT /api/v2/deliverables/{id} */
    public function update(int $id): JsonResponse
    {
        $this->requireAuth();
        $tenantId = $this->getTenantId();
        $data = $this->getAllInput();

        $allowed = ['title', 'description', 'due_date', 'status'];
        $sets = [];
        $params = [];

        foreach ($data as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $sets[] = "{$key} = ?";
                $params[] = $value;
            }
        }

        if (empty($sets)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.no_valid_fields'));
        }

        $params[] = $id;
        $params[] = $tenantId;

        $affected = DB::update(
            'UPDATE deliverables SET ' . implode(', ', $sets) . ' WHERE id = ? AND tenant_id = ?',
            $params
        );

        if ($affected === 0) {
            return $this->respondWithError('NOT_FOUND', __('api.deliverable_not_found'), null, 404);
        }

        return $this->respondWithData(['id' => $id, 'updated' => true]);
    }
}
