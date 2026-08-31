<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Controllers\Api;

use App\Services\FCMPushService;
use App\Services\PushNotificationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;
use App\Core\TenantContext;

/**
 * PushController — Push notification subscription management.
 *
 * Native DB facade implementation for most endpoints.
 * The send() method is kept as delegation because it uses the WebPush library.
 */
class PushController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly FCMPushService $fcmPushService,
        private readonly PushNotificationService $pushService,
    ) {}

    /**
     * POST /api/v2/push/subscribe
     *
     * Subscribe the current device to push notifications.
     * Body: endpoint, keys (p256dh, auth), device_name (optional).
     */
    public function subscribe(): JsonResponse
    {
        $userId = $this->requireAuth();
        $data = $this->getAllInput();

        $result = $this->pushService->subscribe($userId, $data);

        return $this->respondWithData(['subscribed' => $result], null, 201);
    }

    /**
     * POST /api/v2/push/unsubscribe
     *
     * Unsubscribe a device from push notifications.
     * Body: endpoint (required).
     */
    public function unsubscribe(): JsonResponse
    {
        $userId = $this->requireAuth();

        $endpoint = $this->requireInput('endpoint');
        $this->pushService->unsubscribe($userId, $endpoint);

        return $this->respondWithData(['message' => __('api_controllers_2.push.unsubscribed')]);
    }

    /**
     * GET /api/v2/push/vapid-key
     *
     * Get the VAPID public key for push subscriptions.
     */
    public function vapidKey(): JsonResponse
    {
        $key = $this->pushService->getVapidKey();

        return $this->respondWithData(['vapid_public_key' => $key]);
    }

    /**
     * POST /api/v2/push/send
     *
     * Sends a push notification to specified users (admin only).
     */
    public function send(): JsonResponse
    {
        $this->requireAdmin();
        $this->rateLimit('push_send', 10, 60);

        $tenantId = $this->getTenantId();
        $title = $this->input('title');
        $body = $this->input('body');

        if (empty($title) || empty($body)) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.title_and_body_required'), null, 400);
        }

        $targetUserIds = $this->input('user_ids');

        if ($targetUserIds && is_array($targetUserIds)) {
            // Sanitize to integers only — prevents SQL injection and cross-tenant ID confusion.
            $targetUserIds = array_values(array_filter(
                array_map('intval', $targetUserIds),
                fn($id) => $id > 0
            ));
        }

        if (!empty($targetUserIds)) {
            $placeholders = str_repeat('?,', count($targetUserIds) - 1) . '?';
            $subscriptionResults = DB::select("SELECT * FROM push_subscriptions WHERE tenant_id = ? AND user_id IN ($placeholders)", array_merge([$tenantId], $targetUserIds));
        } else {
            $subscriptionResults = DB::select("SELECT * FROM push_subscriptions WHERE tenant_id = ?", [$tenantId]);
        }

        $subscriptions = array_map(fn($r) => (array)$r, $subscriptionResults);

        if (empty($subscriptions)) {
            return $this->respondWithData(['sent' => 0, 'failed' => 0, 'message' => __('api_controllers_2.push.no_subscribers')]);
        }

        $sent = 0;
        $failed = 0;

        foreach ($subscriptions as $sub) {
            // Use reflection to call the private sendPush method, or call the service directly
            try {
                $publicKey = \App\Core\Env::get('VAPID_PUBLIC_KEY');
                $privateKey = \App\Core\Env::get('VAPID_PRIVATE_KEY');

                if (empty($publicKey) || empty($privateKey) || !class_exists('Minishlink\WebPush\WebPush')) {
                    $failed++;
                    continue;
                }

                $auth = ['VAPID' => [
                    'subject' => 'mailto:' . (getenv('MAIL_FROM') ?: 'admin@nexus.local'),
                    'publicKey' => $publicKey,
                    'privateKey' => $privateKey,
                ]];

                $webPush = new \Minishlink\WebPush\WebPush($auth);
                // Sanitize optional notification fields.
                // icon/badge must be root-relative paths (no external URLs).
                // url must be a root-relative path (no open-redirect risk).
                // tag is a plain identifier — strip everything except alphanumeric, dash, underscore.
                $rawIcon  = $this->input('icon', '/assets/images/pwa/icon.svg');
                $rawBadge = $this->input('badge', '/assets/images/pwa/badge.png');
                $rawUrl   = $this->input('url', '/');
                $rawTag   = $this->input('tag', 'nexus-notification');

                $icon  = (is_string($rawIcon)  && str_starts_with($rawIcon, '/')  && !str_starts_with($rawIcon, '//'))  ? $rawIcon  : '/assets/images/pwa/icon.svg';
                $badge = (is_string($rawBadge) && str_starts_with($rawBadge, '/') && !str_starts_with($rawBadge, '//')) ? $rawBadge : '/assets/images/pwa/badge.png';
                $url   = (is_string($rawUrl)   && str_starts_with($rawUrl, '/')   && !str_starts_with($rawUrl, '//'))   ? $rawUrl   : '/';
                $tag   = preg_replace('/[^a-zA-Z0-9\-_]/', '', (string) $rawTag) ?: 'nexus-notification';

                $webPush->queueNotification(
                    \Minishlink\WebPush\Subscription::create([
                        'endpoint' => $sub['endpoint'],
                        'keys' => ['p256dh' => $sub['p256dh_key'], 'auth' => $sub['auth_key']],
                    ]),
                    json_encode([
                        'title' => $title,
                        'body'  => $body,
                        'icon'  => $icon,
                        'badge' => $badge,
                        'url'   => $url,
                        'tag'   => $tag,
                    ])
                );

                $reports = $webPush->flush();
                foreach ($reports as $report) {
                    if ($report->isSuccess()) {
                        $sent++;
                    } else {
                        $failed++;
                        if ($report->isSubscriptionExpired()) {
                            DB::delete("DELETE FROM push_subscriptions WHERE endpoint = ?", [$sub['endpoint']]);
                        }
                    }
                }
            } catch (\Throwable $e) {
                $failed++;
            }
        }

        return $this->respondWithData(['sent' => $sent, 'failed' => $failed, 'total' => count($subscriptions)]);
    }

    /**
     * GET /api/v2/push/status
     *
     * Returns push subscription status for current user.
     *
     * Response: { data: { subscribed: bool, subscription_count: N } }
     */
    public function status(): JsonResponse
    {
        $userId = $this->requireAuth();
        $tenantId = $this->getTenantId();

        $count = (int) DB::table('push_subscriptions')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->count();

        return $this->respondWithData([
            'subscribed' => $count > 0,
            'subscription_count' => $count,
        ]);
    }

    /**
     * POST /api/v2/push/register-device
     *
     * Registers an FCM device token for native Android push notifications.
     * Body: token (required), platform (optional, default: android).
     */
    public function registerDevice(): JsonResponse
    {
        $this->rateLimit('push_register_device', 10, 60);

        $token = $this->input('token');
        $platform = $this->input('platform', 'android');

        $validation = Validator::make([
            'token' => $token,
            'platform' => $platform,
            'token_type' => $this->input('token_type', 'fcm'),
        ], [
            'token' => ['required', 'string', 'max:255'],
            'platform' => ['required', 'string', 'in:android,ios'],
            'token_type' => ['required', 'string', 'in:expo,fcm'],
        ]);

        if ($validation->fails()) {
            $field = (string) array_key_first($validation->errors()->messages());
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), $field, 422);
        }

        $token = trim((string) $token);
        $tokenType = (string) $this->input('token_type', 'fcm');
        if ($tokenType === 'expo' && preg_match('/^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/', $token) !== 1) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'token', 422);
        }

        $userId = $this->getOptionalUserId();

        if (!$userId) {
            return $this->respondWithData([
                'registered' => false,
                'pending' => true,
                'message' => __('api_controllers_2.push.token_pending'),
            ]);
        }

        try {
            $this->fcmPushService->ensureTableExists();

            $result = $this->fcmPushService->registerDevice(
                $userId,
                $token,
                $platform
            );

            if ($result) {
                return $this->respondWithData([
                    'registered' => true,
                    'message' => __('api_controllers_2.push.device_registered'),
                ]);
            }

            return $this->respondWithError('REGISTRATION_FAILED', __('api.device_registration_failed'), null, 500);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[PushApi] Register device error: ' . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

    /**
     * POST /api/v2/push/unregister-device
     *
     * Removes an FCM device token.
     * Body: token (required).
     */
    public function unregisterDevice(): JsonResponse
    {
        $this->rateLimit('push_unregister_device', 10, 60);

        $token = $this->input('token');

        if (!is_string($token) || trim($token) === '' || strlen($token) > 255) {
            return $this->respondWithError('VALIDATION_ERROR', __('api.invalid_input'), 'token', 422);
        }
        $token = trim($token);

        $userId = $this->getOptionalUserId();

        try {
            $result = $this->fcmPushService->unregisterDevice($token, $userId);

            return $this->respondWithData([
                'unregistered' => $result,
                'message' => $result
                    ? __('api_controllers_2.push.device_unregistered')
                    : __('api_controllers_2.push.device_not_found'),
            ]);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[PushApi] Unregister device error: ' . $e->getMessage());
            return $this->respondWithError('SERVER_ERROR', __('api.server_error'), null, 500);
        }
    }

}
