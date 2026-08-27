<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

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

        return self::sendToTokens($tokens, $title, $body, $data);
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
        $tokens = DB::table('fcm_device_tokens')
            ->where('tenant_id', $tenantId)
            ->whereIn('user_id', $userIds)
            ->pluck('token')
            ->toArray();

        if (empty($tokens)) {
            return ['sent' => 0, 'failed' => 0, 'errors' => []];
        }

        return self::sendToTokens($tokens, $title, $body, $data);
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
            $expoResult = self::sendToExpoTokens($expoTokens, $title, $body, $data);
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
                    ],
                ];

                if (!empty($data)) {
                    $payload['data'] = $data;
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
     * Native push is only a wake-up/tap surface, so ordinary notifications use
     * generic presentation text and a single generic notification-centre link.
     * The original destination can itself reveal the category of a confidential
     * event (for example an emergency or GDPR request), so it is not forwarded.
     * Paid
     * promotional campaigns are the one explicit exception: their copy is the
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
            return [$title, $body, $data];
        }

        return [
            __('notifications.push_default'),
            __('notifications.push_private_body'),
            ['link' => '/notifications'],
        ];
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
    private static function sendToExpoTokens(array $tokens, string $title, string $body, array $data): array
    {
        $messages = array_map(static fn (string $token): array => [
            'to' => $token,
            'title' => $title,
            'body' => $body,
            'sound' => 'default',
            'data' => array_map('strval', $data),
        ], $tokens);

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
