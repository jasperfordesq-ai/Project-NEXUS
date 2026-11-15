<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api\SuperAdmin;

use App\Http\Controllers\Api\BaseApiController;
use App\Jobs\ProvisionTenantJob;
use App\Services\TenantProvisioning\TenantProvisioningService;
use Illuminate\Http\JsonResponse;
use InvalidArgumentException;
use RuntimeException;

/**
 * AG44 — The queue of requests for a new community.
 *
 * 🔴 Platform team only (`is_god` AND super admin) since 15 Nov 2026: the page
 * lives in the Platform team panel, and approving a request creates a
 * community anywhere in the tree. Every action calls
 * requireGodPlatformAdmin(); the route group's `super-admin` middleware is
 * the outer barrier, not the rule.
 *
 * Routes:
 *   GET  /v2/super-admin/provisioning-requests
 *   GET  /v2/super-admin/provisioning-requests/{id}
 *   POST /v2/super-admin/provisioning-requests/{id}/approve
 *   POST /v2/super-admin/provisioning-requests/{id}/reject
 *   POST /v2/super-admin/provisioning-requests/{id}/retry
 */
class TenantProvisioningController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function index(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        if (! TenantProvisioningService::isAvailable()) {
            return $this->respondWithData([]);
        }

        $status = $this->query('status');
        $rows   = TenantProvisioningService::listRequests($status ?: null);
        return $this->respondWithData($rows);
    }

    public function show(int $id): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        if (! TenantProvisioningService::isAvailable()) {
            return $this->respondNotFound(__('api.provisioning_request_not_found'));
        }

        $row = TenantProvisioningService::getRequest($id);
        if (! $row) {
            return $this->respondNotFound(__('api.provisioning_request_not_found'));
        }
        return $this->respondWithData($row);
    }

    public function approve(int $id): JsonResponse
    {
        $reviewerId = $this->requireGodPlatformAdmin();

        if (! TenantProvisioningService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.provisioning_service_unavailable'), null, 503);
        }

        $row = TenantProvisioningService::getRequest($id);
        if (! $row) {
            return $this->respondNotFound(__('api.provisioning_request_not_found'));
        }

        // Dispatch async — pipeline can take a few seconds.
        ProvisionTenantJob::dispatch($id, $reviewerId);

        return $this->respondWithData(['queued' => true, 'request_id' => $id]);
    }

    public function reject(int $id): JsonResponse
    {
        $reviewerId = $this->requireGodPlatformAdmin();

        if (! TenantProvisioningService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.provisioning_service_unavailable'), null, 503);
        }

        $reason = (string) $this->input('reason', '');
        if (trim($reason) === '') {
            return $this->respondWithError('VALIDATION_ERROR', __('api.provisioning_reject_reason_required'), 'reason', 422);
        }

        try {
            $row = TenantProvisioningService::reject($id, $reason, $reviewerId);
            return $this->respondWithData($row);
        } catch (InvalidArgumentException $e) {
            return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
        } catch (RuntimeException $e) {
            return $this->respondWithError('EMAIL_SEND_FAILED', __('api.create_failed', ['resource' => 'tenant provisioning rejection email']), null, 500);
        }
    }

    public function retry(int $id): JsonResponse
    {
        $reviewerId = $this->requireGodPlatformAdmin();

        if (! TenantProvisioningService::isAvailable()) {
            return $this->respondWithError('SERVICE_UNAVAILABLE', __('api.provisioning_service_unavailable'), null, 503);
        }

        ProvisionTenantJob::dispatch($id, $reviewerId);
        return $this->respondWithData(['queued' => true, 'request_id' => $id]);
    }
}
