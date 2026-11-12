<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\Admin;

use App\Core\TenantContext;
use App\Http\Controllers\Api\BaseApiController;
use App\Services\SiteAnnouncementService;
use Illuminate\Http\JsonResponse;

/**
 * Community announcement banner — admin endpoints (Nov 2026).
 *
 * A community admin posts one-line notices that the member website shows as a
 * coloured banner. Admins of the CURRENT community only: requireAdmin() on top
 * of the route-level admin middleware, and every call is scoped to
 * TenantContext::getId(), so another community's announcement is a 404.
 *
 *   GET    /v2/admin/announcements        index
 *   POST   /v2/admin/announcements        store
 *   PUT    /v2/admin/announcements/{id}   update
 *   DELETE /v2/admin/announcements/{id}   destroy
 */
class SiteAnnouncementAdminController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly SiteAnnouncementService $service,
    ) {
    }

    /** GET /v2/admin/announcements */
    public function index(): JsonResponse
    {
        $this->requireAdmin();

        return $this->respondWithData([
            'items' => $this->service->listForTenant(TenantContext::getId()),
        ]);
    }

    /** POST /v2/admin/announcements */
    public function store(): JsonResponse
    {
        $userId = $this->requireAdmin();

        $result = $this->service->create(TenantContext::getId(), $userId, $this->getAllInput());

        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData([
            'announcement' => $result['announcement'],
        ], null, 201);
    }

    /** PUT /v2/admin/announcements/{id} */
    public function update(string $id): JsonResponse
    {
        $this->requireAdmin();

        $result = $this->service->update(TenantContext::getId(), (int) $id, $this->getAllInput());

        if (isset($result['error'])) {
            return $this->respondNotFound(__('api.site_announcement_not_found'));
        }

        if (isset($result['errors'])) {
            return $this->respondWithErrors($result['errors'], 422);
        }

        return $this->respondWithData([
            'announcement' => $result['announcement'],
        ]);
    }

    /** DELETE /v2/admin/announcements/{id} */
    public function destroy(string $id): JsonResponse
    {
        $this->requireAdmin();

        if (!$this->service->delete(TenantContext::getId(), (int) $id)) {
            return $this->respondNotFound(__('api.site_announcement_not_found'));
        }

        return $this->respondWithData(['ok' => true]);
    }
}
