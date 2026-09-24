<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\OutboundUrlGuard;
use Illuminate\Support\Facades\DB;

/**
 * PushNotificationService — Laravel DI-based service for web push notifications.
 *
 * Manages push subscriptions, VAPID keys, and delegates sending to WebPushService.
 */
class PushNotificationService
{
    /**
     * Subscribe a device for push notifications.
     *
     * Tenant-scoped: stores the current tenant_id so push notifications
     * are only sent to subscriptions belonging to the correct tenant.
     *
     * @param array{endpoint: string, keys: array{p256dh: string, auth: string}} $subscription
     */
    public function subscribe(int $userId, array $subscription): bool
    {
        $endpoint = $subscription['endpoint'] ?? '';
        if (!is_string($endpoint) || $endpoint === '') {
            return false;
        }

        // A push endpoint is a server-side callback target: the platform POSTs to
        // it when delivering notifications. Reject anything that is not an HTTPS
        // URL for a recognised web-push provider so a stored endpoint cannot point
        // at an internal/loopback address (SSRF).
        if (!self::isAcceptablePushEndpoint($endpoint)) {
            return false;
        }

        $tenantId = \App\Core\TenantContext::getId();

        $existing = DB::table('push_subscriptions')
            ->where('user_id', $userId)
            ->where('endpoint', $endpoint)
            ->exists();

        if ($existing) {
            DB::table('push_subscriptions')
                ->where('user_id', $userId)
                ->where('endpoint', $endpoint)
                ->update([
                    'tenant_id'  => $tenantId,
                    'p256dh_key' => $subscription['keys']['p256dh'] ?? null,
                    'auth_key'   => $subscription['keys']['auth'] ?? null,
                    'updated_at' => now(),
                ]);
            return true;
        }

        DB::table('push_subscriptions')->insert([
            'user_id'    => $userId,
            'tenant_id'  => $tenantId,
            'endpoint'   => $endpoint,
            'p256dh_key' => $subscription['keys']['p256dh'] ?? null,
            'auth_key'   => $subscription['keys']['auth'] ?? null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return true;
    }

    /**
     * Exact-match hosts for recognised web-push service providers.
     *
     * @var list<string>
     */
    private const ALLOWED_PUSH_HOSTS = [
        'fcm.googleapis.com',                    // Chrome / Chromium / Android (FCM)
        'updates.push.services.mozilla.com',     // Firefox (Mozilla autopush)
        'web.push.apple.com',                    // Safari / Apple web push
    ];

    /**
     * Suffix-match hosts for providers that use regional/tenant subdomains.
     *
     * @var list<string>
     */
    private const ALLOWED_PUSH_HOST_SUFFIXES = [
        '.notify.windows.com',            // Windows Notification Service (Edge)
        '.push.services.mozilla.com',     // Mozilla autopush regional hosts
    ];

    /**
     * Whether an endpoint is a safe, recognised web-push delivery target.
     *
     * Enforces HTTPS, rejects loopback/private/reserved literals (including
     * IPv4-mapped IPv6 forms via OutboundUrlGuard) and restricts the host to a
     * known push provider. Does not resolve DNS — this runs on the request path,
     * and the provider allowlist already guarantees a real external target.
     */
    public static function isAcceptablePushEndpoint(string $endpoint): bool
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '' || strlen($endpoint) > 2048) {
            return false;
        }

        // Structural safety: HTTP(S) scheme, no local names, no private/loopback
        // (or IPv4-mapped IPv6) literals.
        if (!OutboundUrlGuard::isSafeBrowserUrl($endpoint)) {
            return false;
        }

        $parts = parse_url($endpoint);
        if (!is_array($parts) || strtolower((string) ($parts['scheme'] ?? '')) !== 'https') {
            return false;
        }

        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        if ($host === '') {
            return false;
        }

        if (in_array($host, self::ALLOWED_PUSH_HOSTS, true)) {
            return true;
        }
        foreach (self::ALLOWED_PUSH_HOST_SUFFIXES as $suffix) {
            if (str_ends_with($host, $suffix)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Unsubscribe a device from push notifications.
     */
    public function unsubscribe(int $userId, string $endpoint): bool
    {
        return DB::table('push_subscriptions')
            ->where('user_id', $userId)
            ->where('endpoint', $endpoint)
            ->delete() > 0;
    }

    /**
     * Get the VAPID public key for the client.
     */
    public function getVapidKey(): ?string
    {
        return config('services.vapid.public_key');
    }

    /**
     * Get subscription count for a user.
     */
    public function getSubscriptionCount(int $userId): int
    {
        return DB::table('push_subscriptions')
            ->where('user_id', $userId)
            ->count();
    }

    /**
     * Send a push notification to a user via WebPushService.
     *
     * This is a convenience method that delegates to WebPushService.
     * Push is best-effort — failures are logged but do not propagate.
     */
    public function send(int $userId, string $title, string $body, ?string $link = null): bool
    {
        try {
            $webPush = app(WebPushService::class);
            return $webPush->sendToUser($userId, $title, $body, $link);
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::error('PushNotificationService::send failed', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
            return false;
        }
    }
}
