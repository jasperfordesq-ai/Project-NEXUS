<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use App\Jobs\CheckExpoPushReceipts;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use App\Core\TenantContext;

/**
 * FCMPushService — Firebase Cloud Messaging push notification service.
 *
 * Sends push notifications to Android/iOS devices via FCM HTTP v1 API.
 * Manages device token registration in the `fcm_device_tokens` table.
 *
 * Configuration:
 *   - FCM_SERVER_KEY env var (legacy HTTP API fallback)
 *   - FIREBASE_SERVICE_ACCOUNT_PATH env var or firebase-service-account.json file (HTTP v1 API)
 *   - FIREBASE_PROJECT_ID env var
 *
 * Gracefully no-ops when unconfigured — never throws on missing credentials.
 *
 * Self-contained native Laravel implementation — no legacy delegation.
 */
class FCMPushService
{
    /** FCM HTTP v1 API endpoint template. */
    private const FCM_V1_URL = 'https://fcm.googleapis.com/v1/projects/%s/messages:send';

    /** Legacy FCM HTTP API endpoint. */
    private const FCM_LEGACY_URL = 'https://fcm.googleapis.com/fcm/send';

    /** Expo Push API endpoint for Expo-managed Android/iOS tokens. */
    private const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

    /** Cached OAuth2 access token for HTTP v1 API. */
    private static ?string $accessToken = null;

    /** Cached access token expiry timestamp. */
    private static ?int $tokenExpiry = null;

    public function __construct()
    {
    }

    /**
     * Send a push notification to a single user's registered devices.
     *
     * @return array{sent: int, failed: int, errors: string[]}
     */
    public static function sendToUser(int $userId, string $title, string $body, array $data = []): array
    {
        // Honour the user's push_enabled preference. Default true so legacy
        // users with no JSON pref still receive notifications until they
        // explicitly opt out. Best-effort — pref-lookup failures don't block.
        try {
            $prefs = \App\Models\User::getNotificationPreferences($userId);
            if (!(bool) ($prefs['push_enabled'] ?? true)) {
                return ['sent' => 0, 'failed' => 0, 'errors' => []];
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::debug('FCMPushService: pref lookup failed: ' . $e->getMessage());
        }

        $tenantId = TenantContext::getId();
        $tokens = DB::table('fcm_device_tokens')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->pluck('token')
            ->toArray();

        if (empty($tokens)) {
            return ['sent' => 0, 'failed' => 0, 'errors' => []];
        }

        $preferredLocale = self::preferredLocaleForUser($userId, $tenantId);

        return LocaleContext::withLocale(
            $preferredLocale ?? (string) config('app.locale', 'en'),
            fn (): array => self::sendToTokens($tokens, $title, $body, $data),
        );
    }

    /**
     * Send a push notification to multiple users' registered devices.
     *
     * @return array{sent: int, failed: int, errors: string[]}
     */
    public static function sendToUsers(array $userIds, string $title, string $body, array $data = []): array
    {
        if (empty($userIds)) {
            return ['sent' => 0, 'failed' => 0, 'errors' => []];
        }

        // Filter out users who turned off push_enabled.
        try {
            $optedIn = [];
            foreach ($userIds as $uid) {
                $prefs = \App\Models\User::getNotificationPreferences((int) $uid);
                if ((bool) ($prefs['push_enabled'] ?? true)) {
                    $optedIn[] = (int) $uid;
                }
            }
            $userIds = $optedIn;
            if (empty($userIds)) {
                return ['sent' => 0, 'failed' => 0, 'errors' => []];
            }
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::debug('FCMPushService: batch pref filter failed: ' . $e->getMessage());
        }

        $tenantId = TenantContext::getId();
        $tokenGroups = self::tokensGroupedByRecipientLocale($userIds, $tenantId);
        if ($tokenGroups === []) {
            return ['sent' => 0, 'failed' => 0, 'errors' => []];
        }

        $combined = ['sent' => 0, 'failed' => 0, 'errors' => []];
        foreach ($tokenGroups as $locale => $tokens) {
            $result = LocaleContext::withLocale(
                $locale !== '' ? $locale : (string) config('app.locale', 'en'),
                fn (): array => self::sendToTokens($tokens, $title, $body, $data),
            );
            $combined['sent'] += $result['sent'];
            $combined['failed'] += $result['failed'];
            array_push($combined['errors'], ...$result['errors']);
        }

        return $combined;
    }

    /**
     * Check whether FCM is configured (either v1 service account or legacy server key).
     */
    public function isConfigured(): bool
    {
        return self::isConfiguredStatic();
    }

    /**
     * Register a device token for push notifications.
     *
     * Uses INSERT ... ON DUPLICATE KEY UPDATE for idempotency (token column has unique index).
     */
    public function registerDevice(int $userId, string $token, string $platform = 'android'): bool
    {
        try {
            $tenantId = TenantContext::getId();

            DB::statement(
                'INSERT INTO fcm_device_tokens (user_id, tenant_id, token, platform, created_at, updated_at)
                 VALUES (?, ?, ?, ?, NOW(), NOW())
                 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), tenant_id = VALUES(tenant_id),
                                         platform = VALUES(platform), updated_at = NOW()',
                [$userId, $tenantId, $token, $platform]
            );

            return true;
        } catch (\Throwable $e) {
            Log::error('FCMPushService::registerDevice failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Unregister (delete) a device token.
     *
     * Always scoped to the current tenant to prevent cross-tenant token deletion.
     * When userId is provided, also verifies the token belongs to that user
     * (prevents one user from removing another user's push registration).
     */
    public function unregisterDevice(string $token, ?int $userId = null): bool
    {
        try {
            $tenantId = TenantContext::getId();

            $query = DB::table('fcm_device_tokens')
                ->where('token', $token)
                ->where('tenant_id', $tenantId); // CRITICAL: scope to current tenant

            if ($userId !== null) {
                $query->where('user_id', $userId);
            }

            $deleted = $query->delete();

            return $deleted > 0;
        } catch (\Throwable $e) {
            Log::error('FCMPushService::unregisterDevice failed', [
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Ensure the fcm_device_tokens table exists.
     *
     * Called defensively before registration. Uses Schema check for safety.
     */
    public function ensureTableExists(): void
    {
        // The table is part of the core schema — this is a no-op safety check.
        // If the table somehow doesn't exist, the INSERT will fail with a clear error.
        // We don't create tables at runtime — that's what migrations are for.
    }

    // =========================================================================
    // Internal helpers
    // =========================================================================

    private static function preferredLocaleForUser(int $userId, int $tenantId): ?string
    {
        try {
            $locale = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->value('preferred_language');

            return is_string($locale) && trim($locale) !== '' ? trim($locale) : null;
        } catch (\Throwable $e) {
            Log::debug('FCMPushService: preferred-locale lookup failed: ' . $e->getMessage());
            return null;
        }
    }

    /**
     * @param list<int> $userIds
     * @return array<string,list<string>>
     */
    private static function tokensGroupedByRecipientLocale(array $userIds, int $tenantId): array
    {
        $rows = DB::table('fcm_device_tokens as device_tokens')
            ->join('users', function ($join): void {
                $join->on('users.id', '=', 'device_tokens.user_id')
                    ->on('users.tenant_id', '=', 'device_tokens.tenant_id');
            })
            ->where('device_tokens.tenant_id', $tenantId)
            ->whereIn('device_tokens.user_id', $userIds)
            ->get(['device_tokens.token', 'users.preferred_language']);

        $groups = [];
        foreach ($rows as $row) {
            $token = is_string($row->token ?? null) ? trim($row->token) : '';
            if ($token === '') {
                continue;
            }
            $locale = is_string($row->preferred_language ?? null)
                ? trim($row->preferred_language)
                : '';
            $groups[$locale][] = $token;
        }

        return $groups;
    }

    /**
     * Static configuration check.
     */
    private static function isConfiguredStatic(): bool
    {
        // Check for HTTP v1 API (service account file)
        $saPath = config('services.fcm.service_account_path', base_path('firebase-service-account.json'));
        if (file_exists($saPath)) {
            return true;
        }

        // Check for legacy server key
        if (!empty(config('services.fcm.server_key'))) {
            return true;
        }

        return false;
    }

    /**
     * Send push notifications to a list of device tokens.
     *
     * Tries HTTP v1 API first, falls back to legacy HTTP API.
     *
     * @return array{sent: int, failed: int, errors: string[]}
     */
    private static function sendToTokens(array $tokens, string $title, string $body, array $data): array
    {
        if (self::shouldSuppressNativePush($data)) {
            return ['sent' => 0, 'failed' => 0, 'errors' => []];
        }
        $highPriority = self::shouldUseHighPriority($data);
        [$title, $body, $data] = self::lockScreenSafePresentation($title, $body, $data);

        $sent = 0;
        $failed = 0;
        $errors = [];
        $expoTokens = [];
        $nativeTokens = [];

        foreach ($tokens as $token) {
            if (self::isExpoPushToken((string) $token)) {
                $expoTokens[] = (string) $token;
            } else {
                $nativeTokens[] = (string) $token;
            }
        }

        if (!empty($expoTokens)) {
            $expoResult = self::sendToExpoTokens($expoTokens, $title, $body, $data, $highPriority);
            $sent += $expoResult['sent'];
            $failed += $expoResult['failed'];
            $errors = array_merge($errors, $expoResult['errors']);
        }

        if (empty($nativeTokens)) {
            return ['sent' => $sent, 'failed' => $failed, 'errors' => $errors];
        }

        $tokens = $nativeTokens;

        if (!self::isConfiguredStatic()) {
            return [
                'sent' => $sent,
                'failed' => $failed + count($tokens),
                'errors' => array_merge($errors, ['FCM not configured']),
            ];
        }

        // Try HTTP v1 API first
        $projectId = self::getProjectId();
        $accessToken = $projectId ? self::getAccessToken() : null;

        if ($projectId && $accessToken) {
            $url = sprintf(self::FCM_V1_URL, $projectId);

            foreach ($tokens as $token) {
                try {
                    $message = [
                        'message' => [
                            'token' => $token,
                            'notification' => [
                                'title' => $title,
                                'body' => $body,
                            ],
                        ],
                    ];

                    if (!empty($data)) {
                        // FCM data values must be strings
                        $message['message']['data'] = array_map('strval', $data);
                    }
                    $message['message']['android'] = [
                        'notification' => [
                            'channel_id' => $highPriority ? 'emergency' : 'default',
                        ],
                    ];
                    if ($highPriority) {
                        $message['message']['android']['priority'] = 'HIGH';
                        $message['message']['apns'] = ['headers' => ['apns-priority' => '10']];
                    }

                    $response = Http::withToken($accessToken)
                        ->timeout(10)
                        ->post($url, $message);

                    if ($response->successful()) {
                        $sent++;
                    } else {
                        $failed++;
                        $responseBody = $response->json();
                        $errorMsg = $responseBody['error']['message'] ?? $response->body();
                        $errorStatus = $responseBody['error']['status'] ?? '';
                        $errors[] = "Token {$token}: {$errorMsg}";

                        // Remove invalid/expired/unauthenticated tokens.
                        // FCM v1 dead-token signals:
                        //   - 404 UNREGISTERED — token permanently invalid (app uninstalled, token refreshed)
                        //   - 400 INVALID_ARGUMENT / InvalidRegistration — malformed or foreign-app token
                        //   - 401 UNAUTHENTICATED — stale / revoked token
                        $httpStatus = $response->status();
                        $isDeadToken = $httpStatus === 404
                            || $httpStatus === 401
                            || str_contains($errorMsg, 'UNREGISTERED')
                            || str_contains($errorStatus, 'UNREGISTERED')
                            || str_contains($errorStatus, 'UNAUTHENTICATED')
                            || (
                                $httpStatus === 400
                                && (
                                    str_contains($errorMsg, 'INVALID_ARGUMENT')
                                    || str_contains($errorMsg, 'InvalidRegistration')
                                    || str_contains($errorMsg, 'invalid registration')
                                    || str_contains($errorStatus, 'INVALID_ARGUMENT')
                                )
                            );

                        if ($isDeadToken) {
                            DB::table('fcm_device_tokens')->where('token', $token)->delete();
                        }
                    }
                } catch (\Throwable $e) {
                    $failed++;
                    $errors[] = "Token {$token}: {$e->getMessage()}";
                }
            }

            return ['sent' => $sent, 'failed' => $failed, 'errors' => $errors];
        }

        // Fallback: legacy FCM HTTP API with server key
        $serverKey = config('services.fcm.server_key');
        if (empty($serverKey)) {
            return ['sent' => 0, 'failed' => count($tokens), 'errors' => ['No valid FCM credentials']];
        }

        foreach ($tokens as $token) {
            try {
                $payload = [
                    'to' => $token,
                    'notification' => [
                        'title' => $title,
                        'body' => $body,
                        'android_channel_id' => $highPriority ? 'emergency' : 'default',
                    ],
                ];

                if (!empty($data)) {
                    $payload['data'] = $data;
                }
                if ($highPriority) {
                    $payload['priority'] = 'high';
                }

                $response = Http::withHeaders([
                    'Authorization' => "key={$serverKey}",
                ])->timeout(10)->post(self::FCM_LEGACY_URL, $payload);

                if ($response->successful()) {
                    $result = $response->json();
                    if (($result['success'] ?? 0) > 0) {
                        $sent++;
                    } else {
                        $failed++;
                        $errorMsg = $result['results'][0]['error'] ?? 'Unknown error';
                        $errors[] = "Token {$token}: {$errorMsg}";

                        // Remove invalid tokens (legacy error strings from FCM HTTP API).
                        if (in_array($errorMsg, ['NotRegistered', 'InvalidRegistration', 'MismatchSenderId'], true)) {
                            DB::table('fcm_device_tokens')->where('token', $token)->delete();
                        }
                    }
                } else {
                    $failed++;
                    $status = $response->status();
                    $errors[] = "Token {$token}: HTTP {$status}";

                    // Legacy API HTTP status-based dead-token cleanup:
                    //   - 401 — stale server/API key (token can't be validated, keep the key-rotation team's record clean)
                    //   - 404 — token no longer exists
                    //   - 400 w/ InvalidRegistration / NotRegistered body — malformed token
                    $body = $response->body();
                    if (
                        $status === 404
                        || $status === 401
                        || ($status === 400 && (
                            str_contains($body, 'InvalidRegistration')
                            || str_contains($body, 'NotRegistered')
                            || str_contains($body, 'INVALID_ARGUMENT')
                        ))
                    ) {
                        DB::table('fcm_device_tokens')->where('token', $token)->delete();
                    }
                }
            } catch (\Throwable $e) {
                $failed++;
                $errors[] = "Token {$token}: {$e->getMessage()}";
            }
        }

        return ['sent' => $sent, 'failed' => $failed, 'errors' => $errors];
    }

    /**
     * Keep confidential application data out of native lock-screen payloads.
     *
     * The authenticated in-app notification retains its full localized content.
     * Native push is only a wake-up/tap surface, so ordinary notifications never
     * include the full bell body or arbitrary producer data. A dispatcher-curated
     * category title may be shown, and a validated non-sensitive internal route is
     * retained as data so a tap can open the relevant authenticated screen. Unsafe,
     * browser-only and credential-bearing routes fall back to the notification centre.
     * Paid promotional campaigns are the one explicit exception: their copy is the
     * notification's purpose and recipients have separately opted in.
     *
     * Apple App Review Guideline 4.5.4:
     * https://developer.apple.com/app-store/review/guidelines/#apple-sites-and-services
     *
     * @param array<string,mixed> $data
     * @return array{0:string,1:string,2:array<string,mixed>}
     */
    private static function lockScreenSafePresentation(string $title, string $body, array $data): array
    {
        if (($data['campaign_type'] ?? null) === 'paid_push') {
            $campaignId = is_scalar($data['campaign_id'] ?? null)
                ? (string) $data['campaign_id']
                : '';
            $ctaUrl = self::safePaidCampaignCta($data['cta_url'] ?? null);

            return [$title, $body, [
                'schema_version' => '1',
                'campaign_type' => 'paid_push',
                'campaign_id' => preg_match('/^[1-9][0-9]{0,18}$/', $campaignId) === 1 ? $campaignId : '',
                'cta_url' => $ctaUrl,
            ]];
        }

        $type = is_string($data['type'] ?? null) ? (string) $data['type'] : '';
        $mayDisplayCuratedTitle = ($data['display_title_safe'] ?? null) === '1'
            && !self::requiresCategoryOnlyTitle($type);
        // Never trust the caller-rendered title for ordinary pushes. A queued or
        // after-response producer may have rendered it in the actor's locale;
        // this method runs inside the recipient LocaleContext and can render the
        // same curated catalogue key correctly for this device token group.
        $safeTitle = $mayDisplayCuratedTitle
            ? NotificationDispatcher::recipientPushTitle($type)
            : self::privacySafeTitleForData($data);

        return [
            $safeTitle,
            __('notifications.push_private_body'),
            self::safeNavigationData($data),
        ];
    }

    /** @param array<string,mixed> $data */
    private static function privacySafeTitleForData(array $data): string
    {
        $type = $data['type'] ?? $data['alert_type'] ?? null;
        if (!is_string($type) || preg_match('/^[a-z0-9_:-]{1,80}$/i', $type) !== 1) {
            return __('notifications.push_default');
        }

        return NotificationDispatcher::privacySafePushTitle($type);
    }

    private static function requiresCategoryOnlyTitle(string $type): bool
    {
        $normalized = strtolower($type);
        foreach (['gdpr', 'safeguarding', 'emergency', 'support_action'] as $sensitiveMarker) {
            if (str_contains($normalized, $sensitiveMarker)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Reduce producer data to the versioned fields the native tap handler consumes.
     *
     * @param array<string,mixed> $data
     * @return array<string,string>
     */
    private static function safeNavigationData(array $data): array
    {
        $result = [
            'schema_version' => '1',
            'link' => self::safeInternalLink($data['link'] ?? $data['url'] ?? $data['cta_url'] ?? null),
        ];

        $type = $data['type'] ?? null;
        if (is_string($type) && preg_match('/^[a-z0-9_:-]{1,80}$/i', $type) === 1) {
            $result['type'] = $type;
        }

        return $result;
    }

    private static function safeInternalLink(mixed $candidate): string
    {
        if (!is_string($candidate)) {
            return '/notifications';
        }

        $link = trim($candidate);
        if ($link === '' || strlen($link) > 2048 || str_starts_with($link, '//')) {
            return '/notifications';
        }

        $parts = parse_url($link);
        if ($parts === false) {
            return '/notifications';
        }

        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = strtolower((string) ($parts['host'] ?? ''));
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])) {
            return '/notifications';
        }
        $fragment = (string) ($parts['fragment'] ?? '');
        if ($fragment !== '' && preg_match('/token|secret|password|signature|authorization|api[_-]?key/i', $fragment) === 1) {
            return '/notifications';
        }
        if ($scheme !== '') {
            $trustedWeb = $scheme === 'https' && $host === 'app.project-nexus.ie';
            if (!$trustedWeb && $scheme !== 'nexus') {
                return '/notifications';
            }
        } elseif (!str_starts_with($link, '/')) {
            return '/notifications';
        }

        $path = '/' . ltrim(rawurldecode((string) ($parts['path'] ?? '')), '/');
        foreach (['/admin', '/admin-legacy', '/broker', '/super-admin', '/support-actions/confirm', '/password/reset', '/marketplace/reports'] as $blockedPrefix) {
            if ($path === $blockedPrefix || str_starts_with($path, $blockedPrefix . '/')) {
                return '/notifications';
            }
            if (preg_match('#^/[^/]+'.preg_quote($blockedPrefix, '#').'(?:/|$)#', $path) === 1) {
                return '/notifications';
            }
        }

        parse_str((string) ($parts['query'] ?? ''), $query);
        foreach (array_keys($query) as $key) {
            if (preg_match('/token|secret|password|signature|authorization|api[_-]?key/i', (string) $key) === 1) {
                return '/notifications';
            }
        }

        // Web notification links sometimes use a harmless fragment to scroll to
        // a comment/discussion. Expo Router cannot reproduce that DOM anchor, but
        // the containing native entity is still the exact useful destination.
        return $fragment !== '' ? (string) preg_replace('/#.*$/', '', $link) : $link;
    }

    private static function safePaidCampaignCta(mixed $candidate): string
    {
        if (!is_string($candidate) || trim($candidate) === '') {
            return '/notifications';
        }
        $url = trim($candidate);
        $parts = parse_url($url);
        if (!is_array($parts)) {
            return '/notifications';
        }
        $host = strtolower(trim((string) ($parts['host'] ?? ''), '[]'));
        if (strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
            || $host === ''
            || isset($parts['user'])
            || isset($parts['pass'])
            || isset($parts['port'])
            || isset($parts['fragment'])
            || $host === 'localhost'
            || str_ends_with($host, '.localhost')
            || str_ends_with($host, '.local')
            || str_ends_with($host, '.internal')
            || filter_var($host, FILTER_VALIDATE_IP) !== false
            || !str_contains($host, '.')
        ) {
            return '/notifications';
        }
        parse_str((string) ($parts['query'] ?? ''), $query);
        foreach (array_keys($query) as $key) {
            if (preg_match('/token|secret|password|signature|authorization|api[_-]?key/i', (string) $key) === 1) {
                return '/notifications';
            }
        }

        return $url;
    }

    /** @param array<string,mixed> $data */
    private static function shouldSuppressNativePush(array $data): bool
    {
        if (($data['campaign_type'] ?? null) === 'paid_push') {
            return false;
        }
        $type = strtolower(is_string($data['type'] ?? null) ? $data['type'] : '');
        if (str_starts_with($type, 'caring_') && $type !== 'caring_emergency') {
            return true;
        }
        // Native has no story viewer yet. Opening the general feed does not expose
        // the referenced story, so keep these in the in-app inbox until an exact
        // native destination exists instead of sending a misleading device alert.
        if (str_contains($type, 'story') || $type === 'group_chatroom_message') {
            return true;
        }

        $candidate = $data['link'] ?? $data['url'] ?? $data['cta_url'] ?? null;
        if (!is_string($candidate) || trim($candidate) === '') {
            return false;
        }
        $parts = parse_url(trim($candidate));
        if (!is_array($parts)) {
            return false;
        }
        $segments = array_values(array_filter(explode('/', rawurldecode((string) ($parts['path'] ?? '')))));
        $blocked = ['admin', 'admin-legacy', 'broker', 'super-admin', 'auth'];
        foreach ($segments as $index => $segment) {
            if ($index > 1) {
                break;
            }
            if (in_array(strtolower($segment), $blocked, true)) {
                return true;
            }
        }
        $path = '/' . implode('/', $segments);

        return $path === '/verify-identity/callback'
            || str_starts_with($path, '/join/')
            || str_starts_with($path, '/support-actions/confirm/');
    }

    /** @param array<string,mixed> $data */
    private static function shouldUseHighPriority(array $data): bool
    {
        if (($data['campaign_type'] ?? null) === 'paid_push') {
            return false;
        }

        $type = strtolower(is_string($data['type'] ?? null) ? $data['type'] : '');

        return str_contains($type, 'emergency');
    }

    /**
     * Get the Firebase project ID from service account or env.
     */
    private static function getProjectId(): ?string
    {
        $projectId = config('services.fcm.project_id');
        if (!empty($projectId)) {
            return $projectId;
        }

        $saPath = config('services.fcm.service_account_path', base_path('firebase-service-account.json'));
        if (file_exists($saPath)) {
            $sa = json_decode(file_get_contents($saPath), true);
            return $sa['project_id'] ?? null;
        }

        return null;
    }

    /**
     * Get an OAuth2 access token for the FCM HTTP v1 API.
     *
     * Uses the Firebase service account JSON to generate a JWT, then exchanges
     * it for a short-lived access token. Caches the token in-memory until expiry.
     */
    private static function getAccessToken(): ?string
    {
        // Return cached token if still valid (with 60s safety margin)
        if (self::$accessToken && self::$tokenExpiry && time() < (self::$tokenExpiry - 60)) {
            return self::$accessToken;
        }

        try {
            $saPath = config('services.fcm.service_account_path', base_path('firebase-service-account.json'));
            if (!file_exists($saPath)) {
                return null;
            }

            $sa = json_decode(file_get_contents($saPath), true);
            if (empty($sa['client_email']) || empty($sa['private_key'])) {
                return null;
            }

            $now = time();
            $header = self::base64UrlEncode(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
            $claims = self::base64UrlEncode(json_encode([
                'iss' => $sa['client_email'],
                'scope' => 'https://www.googleapis.com/auth/firebase.messaging',
                'aud' => 'https://oauth2.googleapis.com/token',
                'iat' => $now,
                'exp' => $now + 3600,
            ]));

            $signatureInput = "{$header}.{$claims}";
            $privateKey = openssl_pkey_get_private($sa['private_key']);
            if (!$privateKey) {
                Log::error('FCMPushService: Invalid private key in service account');
                return null;
            }

            openssl_sign($signatureInput, $signature, $privateKey, OPENSSL_ALGO_SHA256);
            $jwt = $signatureInput . '.' . self::base64UrlEncode($signature);

            $response = Http::asForm()->post('https://oauth2.googleapis.com/token', [
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion' => $jwt,
            ]);

            if ($response->successful()) {
                $tokenData = $response->json();
                self::$accessToken = $tokenData['access_token'] ?? null;
                self::$tokenExpiry = $now + ($tokenData['expires_in'] ?? 3600);
                return self::$accessToken;
            }

            Log::error('FCMPushService: Token exchange failed', ['status' => $response->status()]);
            return null;
        } catch (\Throwable $e) {
            Log::error('FCMPushService::getAccessToken failed', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Base64url-encode (no padding) for JWT.
     */
    private static function base64UrlEncode(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function isExpoPushToken(string $token): bool
    {
        return str_starts_with($token, 'ExponentPushToken[')
            || str_starts_with($token, 'ExpoPushToken[');
    }

    /**
     * Send Expo-managed push tokens through Expo Push Service.
     *
     * @return array{sent: int, failed: int, errors: string[]}
     */
    private static function sendToExpoTokens(
        array $tokens,
        string $title,
        string $body,
        array $data,
        bool $highPriority = false,
    ): array
    {
        $messages = array_map(static function (string $token) use ($title, $body, $data, $highPriority): array {
            $message = [
                'to' => $token,
                'title' => $title,
                'body' => $body,
                'sound' => 'default',
                'channelId' => $highPriority ? 'emergency' : 'default',
                'data' => array_map('strval', $data),
            ];
            if ($highPriority) {
                $message['priority'] = 'high';
            }

            return $message;
        }, $tokens);

        try {
            $response = Http::acceptJson()
                ->asJson()
                ->timeout(10)
                ->post(self::EXPO_PUSH_URL, count($messages) === 1 ? $messages[0] : $messages);

            if (!$response->successful()) {
                return [
                    'sent' => 0,
                    'failed' => count($tokens),
                    'errors' => ['Expo push HTTP ' . $response->status()],
                ];
            }

            $payload = $response->json();
            $tickets = $payload['data'] ?? [];
            if (isset($tickets['status'])) {
                $tickets = [$tickets];
            }

            $sent = 0;
            $failed = 0;
            $errors = [];
            $ticketTokens = [];

            foreach ($tokens as $index => $token) {
                $ticket = $tickets[$index] ?? null;
                if (($ticket['status'] ?? null) === 'ok') {
                    $sent++;
                    if (is_string($ticket['id'] ?? null) && $ticket['id'] !== '') {
                        $ticketTokens[$ticket['id']] = $token;
                    }
                    continue;
                }

                $failed++;
                $message = $ticket['message'] ?? 'Unknown Expo push error';
                $detailsError = $ticket['details']['error'] ?? null;
                $errors[] = "Token {$token}: {$message}";

                if ($detailsError === 'DeviceNotRegistered') {
                    DB::table('fcm_device_tokens')->where('token', $token)->delete();
                }
            }

            if (! empty($ticketTokens)) {
                CheckExpoPushReceipts::dispatch($ticketTokens)->delay(now()->addMinutes(15));
            }

            return ['sent' => $sent, 'failed' => $failed, 'errors' => $errors];
        } catch (\Throwable $e) {
            return [
                'sent' => 0,
                'failed' => count($tokens),
                'errors' => ['Expo push failed: ' . $e->getMessage()],
            ];
        }
    }
}
