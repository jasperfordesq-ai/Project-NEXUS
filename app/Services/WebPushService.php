<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\User;
use App\Support\Billing\BillingLock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Minishlink\WebPush\Subscription;
use Minishlink\WebPush\WebPush;

/**
 * WebPushService — sends web push notifications via the minishlink/web-push library.
 *
 * Reads subscriptions from the `push_subscriptions` table and uses VAPID
 * credentials from environment variables.
 */
class WebPushService
{
    public function __construct()
    {
    }

    /**
     * Send a push notification to all subscriptions for a given user.
     */
    public function sendToUser($userId, $title, $body, $link = null, $type = 'general', $options = []): bool
    {
        // A community paused for non-payment sends nothing to its members.
        if (BillingLock::isLockedFailOpen((int) \App\Core\TenantContext::getId(), 'WebPushService')) {
            return false;
        }

        try {
            // Check push_enabled preference — default to sending (opt-out model)
            try {
                $prefs = User::getNotificationPreferences((int) $userId);
                if (!((bool) ($prefs['push_enabled'] ?? true))) {
                    return false;
                }
            } catch (\Throwable $prefError) {
                Log::debug('WebPushService: could not read push_enabled pref', [
                    'user_id' => $userId,
                    'error' => $prefError->getMessage(),
                ]);
                // Default to sending on error
            }

            $tenantId = \App\Core\TenantContext::getId();
            $subscriptions = DB::table('push_subscriptions')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->get();

            if ($subscriptions->isEmpty()) {
                return false;
            }

            $webPush = self::createWebPushInstance();
            if ($webPush === null) {
                return false;
            }

            $payload = $this->buildPayload(
                $title,
                $body,
                $link,
                $type,
                $options,
                \App\Core\TenantContext::getSlugPrefix()
            );

            foreach ($subscriptions as $sub) {
                $webPush->queueNotification(
                    Subscription::create([
                        'endpoint'        => $sub->endpoint,
                        'publicKey'       => $sub->p256dh_key,
                        'authToken'       => $sub->auth_key,
                        'contentEncoding' => 'aesgcm',
                    ]),
                    $payload
                );
            }

            // Flush and handle expired subscriptions
            foreach ($webPush->flush() as $report) {
                if ($report->isSubscriptionExpired()) {
                    DB::table('push_subscriptions')
                        ->where('endpoint', $report->getEndpoint())
                        ->delete();
                }
            }

            return true;
        } catch (\Exception $e) {
            Log::error('WebPushService::sendToUser failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Static proxy for sendToUser — used by code that cannot inject an instance.
     */
    public static function sendToUserStatic($userId, $title, $body, $link = null, $type = 'general', $options = []): bool
    {
        try {
            $instance = app(self::class);
            return $instance->sendToUser($userId, $title, $body, $link, $type, $options);
        } catch (\Exception $e) {
            Log::error('WebPushService::sendToUserStatic failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Send a push notification to multiple users.
     */
    public function sendToUsers($userIds, $title, $body, $link = null, $type = 'general', $options = []): int
    {
        $sent = 0;
        foreach ((array) $userIds as $userId) {
            if ($this->sendToUser($userId, $title, $body, $link, $type, $options)) {
                $sent++;
            }
        }
        return $sent;
    }

    /**
     * @param array<string, mixed> $options
     */
    protected function buildPayload(
        $title,
        $body,
        $link,
        $type,
        array $options,
        string $tenantPath
    ): string {
        return json_encode(array_merge([
            'title' => $title,
            'body' => $body,
            'url' => $link,
            'type' => $type,
            'icon' => '/icons/icon-192.png',
        ], $options, [
            'tenant_path' => rtrim($tenantPath, '/'),
        ]), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
    }

    /**
     * Create a WebPush instance with VAPID authentication.
     */
    private static function createWebPushInstance(): ?WebPush
    {
        $publicKey  = config('services.vapid.public_key');
        $privateKey = config('services.vapid.private_key');
        $subject    = config('services.vapid.subject', 'mailto:hello@project-nexus.ie');

        if (empty($publicKey) || empty($privateKey)) {
            Log::warning('WebPushService: VAPID keys not configured');
            return null;
        }

        return new WebPush([
            'VAPID' => [
                'subject'    => $subject,
                'publicKey'  => $publicKey,
                'privateKey' => $privateKey,
            ],
        ]);
    }
}
