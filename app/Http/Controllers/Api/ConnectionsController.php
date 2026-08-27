<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Exceptions\SafeguardingPolicyException;
use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\User;
use App\Services\ConnectionService;
use App\Services\EmailDispatchService;
use Illuminate\Http\JsonResponse;
use App\Models\Notification;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * ConnectionsController - Member connections (friend requests).
 *
 * Endpoints (v2):
 *   GET    /api/v2/connections                  index()
 *   GET    /api/v2/connections/pending          pendingCounts()
 *   GET    /api/v2/connections/status/{userId}  status()
 *   POST   /api/v2/connections                  request()
 *   PUT    /api/v2/connections/{id}/accept      accept()
 *   PUT    /api/v2/connections/{id}/decline     decline()
 *   DELETE /api/v2/connections/{id}             destroy()
 */
class ConnectionsController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly ConnectionService $connectionService,
    ) {}

    // -----------------------------------------------------------------
    //  GET /api/v2/connections
    // -----------------------------------------------------------------

    /**
     * List connections for the authenticated user.
     *
     * Query params: status (accepted|pending), cursor, per_page (default 20).
     */
    public function index(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_list', 60, 60);

        $filters = [
            'limit' => $this->queryInt('per_page', 20, 1, 100),
        ];
        if ($this->query('status')) {
            $filters['status'] = $this->query('status');
        }
        if ($this->query('cursor')) {
            $filters['cursor'] = $this->query('cursor');
        }

        $result = $this->connectionService->getConnections($userId, $filters);

        return $this->respondWithCollection(
            $result['items'],
            $result['cursor'] ?? null,
            $filters['limit'],
            $result['has_more'] ?? false
        );
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/connections/pending
    // -----------------------------------------------------------------

    /**
     * Get pending connection request counts.
     */
    public function pendingCounts(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_pending', 120, 60);

        $counts = $this->connectionService->getPendingCounts($userId);

        return $this->respondWithData($counts);
    }

    // -----------------------------------------------------------------
    //  GET /api/v2/connections/status/{userId}
    // -----------------------------------------------------------------

    /**
     * Get connection status with a specific user.
     */
    public function status(int $otherUserId): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_status', 120, 60);

        $status = $this->connectionService->getStatus($userId, $otherUserId);

        return $this->respondWithData($status);
    }

    // -----------------------------------------------------------------
    //  POST /api/v2/connections
    // -----------------------------------------------------------------

    /**
     * Send a connection request. Requires authentication.
     *
     * Body: { "user_id": int }
     */
    public function request(): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connection_request', 20, 60);

        try {
            $result = $this->connectionService->sendRequest($userId, $this->getAllInput());
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            $msg = $e->getMessage();
            $code = 'VALIDATION_ERROR';
            $status = 422;

            if (str_contains($msg, 'yourself')) {
                $status = 400;
            } elseif (str_contains($msg, 'already exists')) {
                $code = 'ALREADY_EXISTS';
                $status = 409;
            }

            return $this->respondWithError($code, $msg, null, $status);
        }

        return $this->respondWithData($result, null, 201);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/connections/{id}/accept
    // -----------------------------------------------------------------

    /**
     * Accept a pending connection request.
     */
    public function accept(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_accept', 30, 60);

        try {
            $connection = $this->connectionService->accept($id, $userId);
        } catch (\Illuminate\Database\Eloquent\ModelNotFoundException $e) {
            return $this->respondWithError('NOT_FOUND', __('api.connection_request_not_found'), null, 404);
        } catch (SafeguardingPolicyException $e) {
            return $this->safeguardingPolicyError($e);
        } catch (\RuntimeException $e) {
            $msg = $e->getMessage();
            $status = 422;

            if (str_contains($msg, 'not pending')) {
                $status = 409;
            } elseif (str_contains($msg, 'receiver')) {
                $status = 403;
            }

            return $this->respondWithError('INVALID_STATE', $msg, null, $status);
        }

        // Award XP to both users for making a connection
        try {
            \App\Services\GamificationService::awardXP($userId, \App\Services\GamificationService::XP_VALUES['make_connection'], 'make_connection', __('api_controllers_2.connections.accepted_connection'));
            $otherUserId = ($connection->requester_id === $userId) ? $connection->receiver_id : $connection->requester_id;
            \App\Services\GamificationService::awardXP($otherUserId, \App\Services\GamificationService::XP_VALUES['make_connection'], 'make_connection', __('api_controllers_2.connections.connection_accepted'));
            \App\Services\GamificationService::runAllBadgeChecks($userId);
            \App\Services\GamificationService::runAllBadgeChecks($otherUserId);
        } catch (\Throwable $e) {
            \Log::warning('Gamification XP award failed', ['action' => 'make_connection', 'user' => $userId, 'error' => $e->getMessage()]);
        }

        return $this->respondWithData([
            'connection_id' => $connection->id,
            'status'        => 'connected',
        ]);
    }

    // -----------------------------------------------------------------
    //  PUT /api/v2/connections/{id}/decline
    // -----------------------------------------------------------------

    /**
     * Decline a pending connection request. Notifies the requester by email.
     */
    public function decline(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_decline', 30, 60);

        // Fetch the connection before deleting so we can notify the requester
        $existing = $this->connectionService->getById($id, $userId);

        if ($existing === null) {
            return $this->respondWithError('NOT_FOUND', __('api.connection_not_found'), null, 404);
        }

        // Only the receiver can decline a pending request
        if (($existing['receiver_id'] ?? null) !== $userId || ($existing['status'] ?? '') !== 'pending') {
            return $this->respondWithError('INVALID_STATE', __('api.connection_not_pending'), null, 409);
        }

        $requesterId = $existing['requester_id'] ?? null;

        $this->connectionService->delete($id, $userId);

        // Notify the requester that their connection request was not accepted
        if ($requesterId) {
            try {
                $decliner  = User::find($userId);
                $requester = User::find($requesterId);
                $tenantId = (int) ($requester->tenant_id ?? TenantContext::getId());
                $tenantName = TenantContext::get()['name'] ?? __('emails.common.platform_name');

                LocaleContext::withLocale($requester, function () use ($decliner, $requester, $requesterId, $tenantName, $tenantId) {
                    $declinerName = UserDisplayName::resolve($decliner)
                        ?: ($decliner->name ?? __('emails.common.fallback_someone'));

                    // Bell notification
                    Notification::createNotification(
                        (int) $requesterId,
                        __('emails_misc.social.connection_declined', ['name' => $declinerName]),
                        '/members',
                        'connection_declined'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($requesterId), 'connection_declined', __('emails_misc.social.connection_declined', ['name' => $declinerName]), '/members');

                    // Email notification. Declines use the same connections
                    // preference as requests/acceptances so the direct email
                    // path does not bypass the canonical opt-out.
                    $emailEnabled = true;
                    try {
                        $prefs = User::getNotificationPreferences((int) $requesterId);
                        $emailEnabled = (bool) ($prefs['email_connections'] ?? true);
                    } catch (\Throwable $prefError) {
                        Log::debug('[ConnectionsController] connection declined preference lookup failed', [
                            'requester_id' => $requesterId,
                            'error' => $prefError->getMessage(),
                        ]);
                    }

                    if ($emailEnabled && $requester && $requester->email) {
                        $requesterName = $requester->first_name ?? $requester->name ?? '';

                        $html = EmailTemplateBuilder::make()
                            ->theme('brand')
                            ->title(__('emails_security_alerts.connection_declined.title'))
                            ->previewText(__('emails_security_alerts.connection_declined.preview', ['name' => $declinerName]))
                            ->greeting($requesterName)
                            ->paragraph(__('emails_security_alerts.connection_declined.body', ['name' => $declinerName, 'community' => $tenantName]))
                            ->paragraph(__('emails_security_alerts.connection_declined.suggestion'))
                            ->button(__('emails_security_alerts.connection_declined.cta'), EmailTemplateBuilder::tenantUrl('/members'))
                            ->render();

                        $subject = __('emails_security_alerts.connection_declined.subject', ['community' => $tenantName]);
                        if (!EmailDispatchService::sendRaw($requester->email, $subject, $html, null, null, null, 'connection_declined', ['tenant_id' => $tenantId])) {
                            Log::warning('[ConnectionsController] connection declined email failed to send', [
                                'requester_id' => $requesterId,
                            ]);
                        }
                    }
                });
            } catch (\Throwable $e) {
                Log::warning('[ConnectionsController] connection declined notification failed', [
                    'connection_id' => $id,
                    'requester_id'  => $requesterId,
                    'error'         => $e->getMessage(),
                ]);
            }
        }

        return $this->noContent();
    }

    // -----------------------------------------------------------------
    //  DELETE /api/v2/connections/{id}
    // -----------------------------------------------------------------

    /**
     * Remove a connection or cancel a pending request.
     */
    public function destroy(int $id): JsonResponse
    {
        $userId = $this->requireAuth();
        $this->rateLimit('connections_delete', 30, 60);

        $existing = $this->connectionService->getById($id, $userId);

        if ($existing === null) {
            return $this->respondWithError('NOT_FOUND', __('api.connection_not_found'), null, 404);
        }

        $this->connectionService->delete($id, $userId);

        return $this->noContent();
    }
}
