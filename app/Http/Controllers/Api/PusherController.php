<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;
use App\Services\PusherService;
use App\Services\RealtimeService;
use App\Services\FederationRealtimeService;
use App\Support\UserDisplayName;

/**
 * PusherController — Eloquent-powered Pusher realtime auth and config.
 *
 * Fully migrated from legacy delegation to native Laravel.
 * IMPORTANT: auth() returns RAW Pusher JSON (not wrapped in respondWithData),
 * because the Pusher JS client expects the raw auth response format.
 */
class PusherController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FederationRealtimeService $federationRealtimeService,
        private readonly PusherService $pusherService,
        private readonly RealtimeService $realtimeService,
    ) {}

    /**
     * POST /api/v2/pusher/auth
     *
     * Authenticates private, presence, and federation channel subscriptions.
     * Returns RAW Pusher auth JSON — not wrapped in data envelope.
     */
    public function auth(): JsonResponse
    {
        $userId = $this->requireAuth();
        // Pusher SDK calls this on every subscribe; a well-behaved client hits
        // it a handful of times per session. 120/min is generous and blocks a
        // spam loop that'd exhaust the Pusher app auth quota.
        $this->rateLimit('pusher_auth', 120, 60);

        try {
            $socketId = $this->input('socket_id') ?? request()->request->get('socket_id');
            $channelName = $this->input('channel_name') ?? request()->request->get('channel_name');

            if (empty($socketId) || empty($channelName)) {
                return $this->respondWithError('VALIDATION_ERROR', __('api.missing_socket_or_channel'), null, 400);
            }

            // Handle presence channels
            if (str_starts_with($channelName, 'presence-')) {
                return $this->authPresence($channelName, $socketId, $userId);
            }

            // Handle federation private channels (cross-tenant)
            if (str_starts_with($channelName, 'private-federation.')) {
                return $this->authFederation($channelName, $socketId, $userId);
            }

            // Handle private channels
            if (str_starts_with($channelName, 'private-')) {
                return $this->authPrivate($channelName, $socketId, $userId);
            }

            // Public channels don't need auth
            return $this->respondWithError('INVALID_INPUT', __('api.invalid_channel_type'), null, 400);
        } catch (\Throwable $e) {
            Log::error('[PusherAuth] Exception', [
                'message' => $e->getMessage(),
                'file' => $e->getFile(),
                'line' => $e->getLine(),
            ]);
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

    /**
     * GET /api/v2/pusher/config
     *
     * Returns Pusher configuration for frontend initialization.
     */
    public function config(): JsonResponse
    {
        $userId = $this->getOptionalUserId();
        $config = $this->realtimeService->getFrontendConfig();

        // Add user-specific channels if logged in
        if ($userId !== null) {
            $config['channels'] = [
                'user' => $this->pusherService->getUserChannel($userId),
                'presence' => $this->pusherService->getPresenceChannel(),
            ];
            $config['userId'] = $userId;
        }

        return $this->respondWithData($config);
    }

    /**
     * Authenticate private channel subscription.
     * Returns RAW Pusher auth JSON.
     */
    private function authPrivate(string $channelName, string $socketId, int $userId): JsonResponse
    {
        try {
            $auth = $this->pusherService->authPrivateChannel($channelName, $socketId, $userId);

            if ($auth === null) {
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }

            // Return raw JSON string from Pusher SDK
            return response()->json(json_decode($auth, true));
        } catch (\Throwable $e) {
            Log::error('[PusherAuth] authPrivate error', ['message' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.auth_error'), null, 500);
        }
    }

    /**
     * Authenticate presence channel subscription.
     * Returns RAW Pusher auth JSON.
     */
    private function authPresence(string $channelName, string $socketId, int $userId): JsonResponse
    {
        try {
            $userInfo = $this->getUserInfo($userId);

            $auth = $this->pusherService->authPresenceChannel($channelName, $socketId, $userId, $userInfo);

            if ($auth === null) {
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }

            // Return raw JSON string from Pusher SDK
            return response()->json(json_decode($auth, true));
        } catch (\Throwable $e) {
            Log::error('[PusherAuth] authPresence error', ['message' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.auth_error'), null, 500);
        }
    }

    /**
     * Authenticate federation channel subscription (cross-tenant).
     * Returns RAW Pusher auth JSON.
     */
    private function authFederation(string $channelName, string $socketId, int $userId): JsonResponse
    {
        try {
            $tenantId = TenantContext::getId();
            if ($tenantId === null) {
                Log::warning('[PusherAuth] authFederation called without tenant context', ['user' => $userId]);
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }
            $auth = $this->federationRealtimeService->authFederationChannel($channelName, $socketId, $userId, $tenantId);

            if ($auth === null) {
                return $this->respondWithError('FORBIDDEN', __('api.forbidden'), null, 403);
            }

            // Return raw JSON string from Pusher SDK
            return response()->json(json_decode($auth, true));
        } catch (\Throwable $e) {
            Log::error('[PusherAuth] authFederation error', ['message' => $e->getMessage()]);
            return $this->respondWithError('SERVER_ERROR', __('api.auth_error'), null, 500);
        }
    }

    /**
     * Get user info for presence channel data.
     */
    private function getUserInfo(int $userId): array
    {
        $user = DB::table('users')
            ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'avatar_url')
            ->where('id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->first();

        if (!$user) {
            return ['id' => $userId];
        }

        $name = UserDisplayName::resolve($user);

        return [
            'id' => $user->id,
            'name' => $name ?: 'User',
            'avatar' => $user->avatar_url ?? null,
        ];
    }
}
