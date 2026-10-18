<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Core\SuperPanelAccess;
use App\Exceptions\WebhookValidationException;
use App\Services\WebhookDispatchService;
use Illuminate\Http\JsonResponse;

/**
 * Outbound webhooks — the platform-level Integrations page.
 *
 * Moved here from the volunteering admin page on 2026-10-18 (owner decision):
 * the `outbound_webhooks` table is tenant-wide and in practice carries more
 * job-vacancy events than volunteering ones, and the page is for the one
 * person who should see it — a god account that is also a platform super
 * admin (`requireGodPlatformAdmin()`; see BaseApiController for why neither
 * existing check is enough).
 *
 * Every action takes the community to manage from `tenant_id` (query string
 * for reads, body for writes), defaulting to the community the request is
 * in, and that community must be within the caller's reach
 * (SuperPanelAccess::canAccessTenant). Deliberately no ensureFeature(): the
 * job.* events exist without the volunteering feature.
 *
 * Routes live in the platform-only group of routes/api.php.
 */
class AdminOutboundWebhooksController extends BaseApiController
{
    /** GET /v2/admin/integrations/webhooks/events */
    public function events(): JsonResponse
    {
        $this->requireGodPlatformAdmin();

        return $this->respondWithData(WebhookDispatchService::ALLOWED_EVENTS);
    }

    /** GET /v2/admin/integrations/webhooks?tenant_id= */
    public function index(): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        return $this->respondWithData(WebhookDispatchService::getWebhooks($tenantId));
    }

    /** POST /v2/admin/integrations/webhooks */
    public function store(): JsonResponse
    {
        $tenantId = $this->managedTenantId();
        $userId = $this->requireAuth();

        try {
            $result = WebhookDispatchService::createWebhook($userId, $this->getAllInput(), $tenantId);
        } catch (\InvalidArgumentException $e) {
            return $this->refusal($e);
        }

        return $this->respondWithData($result, null, 201);
    }

    /** PUT /v2/admin/integrations/webhooks/{id} */
    public function update($id): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        try {
            $result = WebhookDispatchService::updateWebhook((int) $id, $this->getAllInput(), $tenantId);
        } catch (\InvalidArgumentException $e) {
            return $this->refusal($e);
        }

        return $this->respondWithData(['success' => $result]);
    }

    /** DELETE /v2/admin/integrations/webhooks/{id} */
    public function destroy($id): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        return $this->respondWithData(['success' => WebhookDispatchService::deleteWebhook((int) $id, $tenantId)]);
    }

    /** POST /v2/admin/integrations/webhooks/{id}/test */
    public function test($id): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        try {
            $result = WebhookDispatchService::testWebhook((int) $id, $tenantId);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        return $this->respondWithData($result);
    }

    /** POST /v2/admin/integrations/webhooks/{id}/rotate-secret — the new secret is returned once. */
    public function rotateSecret($id): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        try {
            $secret = WebhookDispatchService::rotateSecret((int) $id, $tenantId);
        } catch (\RuntimeException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.webhook_not_found'), null, 404);
        }

        return $this->respondWithData(['id' => (int) $id, 'secret' => $secret]);
    }

    /** GET /v2/admin/integrations/webhooks/{id}/logs */
    public function logs($id): JsonResponse
    {
        $tenantId = $this->managedTenantId();

        $filters = [
            'status' => $this->query('status'),
            'limit' => $this->queryInt('per_page', 20, 1, 50),
        ];

        return $this->respondWithData(WebhookDispatchService::getLogs((int) $id, $filters, $tenantId));
    }

    /**
     * A refused create or update. The code names the rule that was broken so
     * the admin page can show its own translated wording; the message is for
     * other API callers.
     */
    private function refusal(\InvalidArgumentException $e): JsonResponse
    {
        if ($e instanceof WebhookValidationException) {
            return $this->respondWithError($e->errorCode, $e->getMessage(), $e->field, 422);
        }

        return $this->respondWithError('VALIDATION_ERROR', $e->getMessage(), null, 422);
    }

    /**
     * The gate, then the community being managed. A community outside the
     * caller's reach answers 403, the same as no access at all.
     */
    private function managedTenantId(): int
    {
        $userId = $this->requireGodPlatformAdmin();

        $requested = $this->input('tenant_id') ?? $this->query('tenant_id');
        $tenantId = $requested !== null && $requested !== '' ? (int) $requested : $this->getTenantId();

        // Stateless API auth: resolve the super-panel scope for this user
        // explicitly rather than from a PHP session. SuperPanelAccess caches
        // its answer for the life of the process, so an answer worked out for
        // another account must be thrown away first, never reused.
        $access = SuperPanelAccess::getAccess($userId);
        if ((int) ($access['user_id'] ?? 0) !== $userId) {
            SuperPanelAccess::reset();
            SuperPanelAccess::getAccess($userId);
        }
        if ($tenantId < 1 || !SuperPanelAccess::canAccessTenant($tenantId)) {
            throw new \Illuminate\Http\Exceptions\HttpResponseException(
                $this->error(__('api.access_denied'), 403, 'AUTH_INSUFFICIENT_PERMISSIONS')
            );
        }

        return $tenantId;
    }
}
