<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use App\Services\FederationFeatureService;
use App\Services\FederationJwtService;
use App\Support\Federation\ExternalFederationResponse;

/**
 * Federation API authentication and authorization middleware.
 *
 * Supports:
 * - API Key: Simple Bearer token (internal/trusted partners)
 * - HMAC-SHA256: Request signing for external platform integrations
 * - JWT: Token-based authentication for user-level access
 */
class FederationApiMiddleware
{
    private static ?array $authenticatedPartner = null;
    private static ?string $authMethod = null;

    // Timestamp tolerance for replay attack prevention (5 minutes)
    private const TIMESTAMP_TOLERANCE = 300;

    /**
     * Authenticate an incoming API request.
     *
     * @return bool|JsonResponse Returns true on success, or a JsonResponse on auth failure.
     */
    public static function authenticate(?string $rawBody = null): bool|JsonResponse
    {
        if ($blocked = self::externalFederationGate()) {
            return $blocked;
        }

        if (self::hasHmacSignature()) {
            return self::authenticateWithHmac($rawBody);
        }

        if (self::hasJwtToken()) {
            return self::authenticateWithJwt();
        }

        return self::authenticateWithApiKey();
    }

    /**
     * Backstop for the external federation kill switch.
     *
     * Routes declare their protocol explicitly via the `federation.external`
     * middleware. This second check derives the protocol from the request path
     * so that a future route added under an existing external prefix — but
     * wired to this authenticator without that middleware — is still blocked.
     *
     * Returns null (allow) when the path is not an external surface, so
     * internal cross-tenant federation is untouched.
     */
    private static function externalFederationGate(): ?JsonResponse
    {
        try {
            $path = (string) (request()?->path() ?? '');
            if ($path === '') {
                return null;
            }

            $protocol = FederationFeatureService::protocolForInboundPath($path);
            if ($protocol === null) {
                return null;
            }

            if (app(FederationFeatureService::class)->isExternalProtocolEnabled($protocol)) {
                return null;
            }

            Log::warning('[ExternalFederation] Blocked inbound request for disabled protocol (authenticator backstop)', [
                'protocol' => $protocol,
                'path' => '/' . ltrim($path, '/'),
            ]);

            // Always the legacy envelope here: FederationApiAuth translates
            // this into the ingest errors[] contract by reading `code`.
            return ExternalFederationResponse::blockedLegacy();
        } catch (\Throwable $e) {
            // Never let the backstop itself break authentication; the route
            // middleware remains the primary enforcement point.
            Log::error('FederationApiMiddleware: external federation gate failed - ' . $e->getMessage());
            return null;
        }
    }

    /**
     * Check if request has a JWT Bearer token.
     */
    private static function hasJwtToken(): bool
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';
        return (bool) preg_match('/^Bearer\s+([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/i', $authHeader);
    }

    /**
     * Authenticate using JWT Bearer token.
     *
     * @return bool|JsonResponse
     */
    private static function authenticateWithJwt(): bool|JsonResponse
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

        if (!preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
            return self::sendError(401, 'Invalid authorization header', 'INVALID_AUTH_HEADER');
        }

        $token = $matches[1];
        if (!class_exists(FederationJwtService::class)) {
            return self::sendError(500, 'JWT service unavailable', 'SERVICE_UNAVAILABLE');
        }
        $payload = FederationJwtService::validateTokenStatic($token);

        if (!$payload) {
            return self::sendError(401, 'Invalid or expired token', 'INVALID_TOKEN');
        }

        $partnerId = $payload['sub'] ?? null;

        if (!$partnerId) {
            return self::sendError(401, 'Token missing partner information', 'INVALID_TOKEN');
        }

        // Verify partner is still active in DB (may have been revoked since token issuance)
        $dbPartner = DB::selectOne("
            SELECT id, name, tenant_id, status, permissions, platform_id FROM federation_api_keys
            WHERE id = ? AND status = 'active'
            AND (expires_at IS NULL OR expires_at > NOW())
        ", [$partnerId]);

        if (!$dbPartner) {
            Log::warning('[FederationApiMiddleware] JWT partner no longer active in DB', ['partner_id' => $partnerId]);
            return self::sendError(401, 'Partner account has been revoked or suspended', 'PARTNER_REVOKED');
        }

        $partner = [
            'id' => $partnerId,
            'tenant_id' => $payload['tenant_id'] ?? ($dbPartner->tenant_id ?? null),
            'name' => $payload['aud'] ?? ($dbPartner->name ?? 'JWT Partner'),
            'permissions' => json_encode($payload['scopes'] ?? []),
            'status' => 'active',
            'platform_id' => $dbPartner->platform_id ?? null,
            'auth_method' => 'jwt',
            'jwt_subject' => $payload['sub'],
            'jwt_issuer' => $payload['iss'] ?? null,
        ];

        if (!self::checkRateLimit($partnerId)) {
            return self::sendError(429, 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
        }

        self::$authenticatedPartner = $partner;
        self::$authMethod = 'jwt';

        self::logApiAccess($partnerId, $_SERVER['REQUEST_URI'], 'jwt', null);

        return true;
    }

    /**
     * Check if request has HMAC signature headers.
     */
    private static function hasHmacSignature(): bool
    {
        return !empty($_SERVER['HTTP_X_FEDERATION_SIGNATURE'])
            && !empty($_SERVER['HTTP_X_FEDERATION_TIMESTAMP'])
            && !empty($_SERVER['HTTP_X_FEDERATION_PLATFORM_ID']);
    }

    /**
     * Authenticate using HMAC-SHA256 request signing.
     *
     * @return bool|JsonResponse
     */
    private static function authenticateWithHmac(?string $rawBody = null): bool|JsonResponse
    {
        $platformId = $_SERVER['HTTP_X_FEDERATION_PLATFORM_ID'] ?? '';
        $timestamp = $_SERVER['HTTP_X_FEDERATION_TIMESTAMP'] ?? '';
        $signature = $_SERVER['HTTP_X_FEDERATION_SIGNATURE'] ?? '';

        if (!self::validateTimestamp($timestamp)) {
            return self::sendError(401, 'Request timestamp expired or invalid', 'TIMESTAMP_INVALID');
        }

        $partner = self::getPartnerByPlatformId($platformId);

        if (!$partner) {
            return self::sendError(401, 'Unknown platform', 'PLATFORM_NOT_FOUND');
        }

        if ($partner['status'] !== 'active') {
            return self::sendError(403, 'Partner account is not active', 'PARTNER_INACTIVE');
        }

        if (empty($partner['signing_secret'])) {
            return self::sendError(401, 'HMAC signing not configured for this platform', 'SIGNING_NOT_CONFIGURED');
        }

        if (!self::verifyHmacSignature(
            (int) $partner['id'],
            $signature,
            $partner['signing_secret'],
            $timestamp,
            $rawBody,
        )) {
            return self::sendError(401, 'Invalid request signature', 'SIGNATURE_INVALID');
        }

        if (!self::checkRateLimit($partner['id'])) {
            return self::sendError(429, 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
        }

        self::$authenticatedPartner = $partner;
        self::$authMethod = 'hmac';

        self::logApiAccess($partner['id'], $_SERVER['REQUEST_URI'], 'hmac', true);

        return true;
    }

    /**
     * Authenticate using simple API key.
     *
     * @return bool|JsonResponse
     */
    private static function authenticateWithApiKey(): bool|JsonResponse
    {
        $apiKey = self::extractApiKey();

        if (empty($apiKey)) {
            return self::sendError(401, 'API key required', 'MISSING_API_KEY');
        }

        $partner = self::validateApiKey($apiKey);

        if (!$partner) {
            return self::sendError(401, 'Invalid API key', 'INVALID_API_KEY');
        }

        if ($partner['status'] !== 'active') {
            return self::sendError(403, 'Partner account is not active', 'PARTNER_INACTIVE');
        }

        if (!empty($partner['signing_enabled'])) {
            return self::sendError(401, 'HMAC signing required for this API key', 'HMAC_REQUIRED');
        }

        if (!self::checkRateLimit($partner['id'])) {
            return self::sendError(429, 'Rate limit exceeded', 'RATE_LIMIT_EXCEEDED');
        }

        self::$authenticatedPartner = $partner;
        self::$authMethod = 'api_key';

        self::logApiAccess($partner['id'], $_SERVER['REQUEST_URI'], 'api_key', null);

        return true;
    }

    /**
     * Validate request timestamp for replay attack prevention.
     */
    private static function validateTimestamp(string $timestamp): bool
    {
        $requestTime = strtotime($timestamp);

        if ($requestTime === false) {
            if (is_numeric($timestamp)) {
                $requestTime = (int)$timestamp;
            } else {
                return false;
            }
        }

        $currentTime = time();
        $diff = abs($currentTime - $requestTime);

        return $diff <= self::TIMESTAMP_TOLERANCE;
    }

    /**
     * Verify HMAC-SHA256 signature.
     */
    private static function verifyHmacSignature(
        int $partnerId,
        string $signature,
        string $secret,
        string $timestamp,
        ?string $rawBody = null,
    ): bool
    {
        $method = strtoupper($_SERVER['REQUEST_METHOD']);
        $path = $_SERVER['REQUEST_URI'];
        $body = $rawBody ?? (file_get_contents('php://input') ?: '');

        // Replay attack prevention via nonce header.
        // Nonce is REQUIRED for HMAC-signed requests — without it, the only
        // protection is the 5-minute timestamp window, which is too wide.
        $nonce = $_SERVER['HTTP_X_FEDERATION_NONCE'] ?? null;
        if (empty($nonce)) {
            return false; // Nonce required for HMAC auth
        }

        // Fix #5: Use Cache::add() (atomic Redis SET NX) instead of the
        // non-atomic has() + put() pattern which has a TOCTOU race condition
        // where two concurrent requests with the same nonce both pass the
        // has() check before either calls put().
        $cacheKey = "federation_nonce:{$partnerId}:{$nonce}";

        $stringToSign = implode("\n", [$method, $path, $timestamp, $nonce, $body]);
        $expectedSignature = hash_hmac('sha256', $stringToSign, $secret);

        if (!hash_equals($expectedSignature, $signature)) {
            return false;
        }

        return Cache::add($cacheKey, true, self::TIMESTAMP_TOLERANCE);
    }

    /**
     * Get partner by platform ID.
     */
    private static function getPartnerByPlatformId(string $platformId): ?array
    {
        $results = DB::select("
            SELECT
                fak.id,
                fak.tenant_id,
                fak.name,
                fak.permissions,
                fak.rate_limit,
                fak.status,
                fak.signing_secret,
                fak.signing_enabled,
                fak.platform_id,
                fak.last_used_at,
                t.name as tenant_name,
                t.domain as tenant_domain
            FROM federation_api_keys fak
            JOIN tenants t ON t.id = fak.tenant_id
            WHERE fak.platform_id = ?
            AND fak.status = 'active'
            AND (fak.expires_at IS NULL OR fak.expires_at > NOW())
        ", [$platformId]);

        $row = $results[0] ?? null;

        if ($row) {
            // Convert stdClass to array
            $partner = (array) $row;

            // Update last used timestamp
            DB::update("
                UPDATE federation_api_keys
                SET last_used_at = NOW(), request_count = request_count + 1
                WHERE id = ?
            ", [$partner['id']]);

            return $partner;
        }

        return null;
    }

    /**
     * Get the authentication method used.
     */
    public static function getAuthMethod(): ?string
    {
        return self::$authMethod;
    }

    /**
     * Reset static authentication state.
     *
     * Call this in test setUp() to prevent state bleed between test cases,
     * and in any async context (queue workers, event handlers) that calls
     * authenticate() outside of a normal HTTP request lifecycle.
     */
    public static function reset(): void
    {
        self::$authenticatedPartner = null;
        self::$authMethod = null;
    }

    /**
     * Generate a new signing secret.
     */
    public static function generateSigningSecret(): string
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * Generate a signature for a request (for testing/client libraries).
     *
     * The nonce MUST be included in the signed payload to prevent replay attacks
     * where an attacker swaps the nonce within the timestamp window.
     */
    public static function generateSignature(string $secret, string $method, string $path, string $timestamp, string $body = '', string $nonce = ''): string
    {
        $stringToSign = implode("\n", [
            strtoupper($method),
            $path,
            $timestamp,
            $nonce,
            $body
        ]);

        return hash_hmac('sha256', $stringToSign, $secret);
    }

    /**
     * Get the authenticated partner info.
     */
    public static function getPartner(): ?array
    {
        return self::$authenticatedPartner;
    }

    /**
     * Get the partner's tenant ID.
     */
    public static function getPartnerTenantId(): ?int
    {
        return self::$authenticatedPartner['tenant_id'] ?? null;
    }

    /**
     * Check if authenticated partner has permission for a feature.
     */
    public static function hasPermission(string $feature): bool
    {
        if (!self::$authenticatedPartner) {
            return false;
        }

        $permissions = json_decode(self::$authenticatedPartner['permissions'] ?? '[]', true);
        if (!is_array($permissions)) {
            return false;
        }

        $family = explode(':', $feature, 2)[0];

        return in_array($feature, $permissions, true)
            || in_array('*', $permissions, true)
            || in_array("{$family}:*", $permissions, true)
            || in_array($family, $permissions, true);
    }

    /**
     * @param array<int, string> $features
     */
    public static function hasAnyPermission(array $features): bool
    {
        foreach ($features as $feature) {
            if (self::hasPermission($feature)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Require a specific permission, send error if not available.
     *
     * @return bool|JsonResponse Returns true if permitted, or a JsonResponse on denial.
     */
    public static function requirePermission(string $feature): bool|JsonResponse
    {
        if (!self::hasPermission($feature)) {
            return self::sendError(403, "Permission denied for: {$feature}", 'PERMISSION_DENIED');
        }
        return true;
    }

    /**
     * Extract API key from request headers.
     */
    private static function extractApiKey(): ?string
    {
        $authHeader = $_SERVER['HTTP_AUTHORIZATION'] ?? '';

        if (preg_match('/^Bearer\s+(.+)$/i', $authHeader, $matches)) {
            return $matches[1];
        }

        if (!empty($_SERVER['HTTP_X_API_KEY'])) {
            return $_SERVER['HTTP_X_API_KEY'];
        }

        return null;
    }

    /**
     * Validate API key and return partner info.
     */
    private static function validateApiKey(string $apiKey): ?array
    {
        $hashedKey = hash('sha256', $apiKey);

        $results = DB::select("
            SELECT
                fak.id,
                fak.tenant_id,
                fak.name,
                fak.permissions,
                fak.rate_limit,
                fak.status,
                fak.signing_enabled,
                fak.platform_id,
                fak.last_used_at,
                t.name as tenant_name,
                t.domain as tenant_domain
            FROM federation_api_keys fak
            JOIN tenants t ON t.id = fak.tenant_id
            WHERE fak.key_hash = ?
            AND fak.status = 'active'
            AND (fak.expires_at IS NULL OR fak.expires_at > NOW())
        ", [$hashedKey]);

        $row = $results[0] ?? null;

        if ($row) {
            $partner = (array) $row;

            DB::update("
                UPDATE federation_api_keys
                SET last_used_at = NOW(), request_count = request_count + 1
                WHERE id = ?
            ", [$partner['id']]);

            return $partner;
        }

        return null;
    }

    /**
     * Check rate limit for partner.
     */
    private static function checkRateLimit(int $keyId): bool
    {
        $currentHour = date('Y-m-d H:00:00');

        try {
            // First, handle hourly reset if needed (separate atomic operation)
            DB::update("
                UPDATE federation_api_keys
                SET hourly_request_count = 0,
                    rate_limit_hour = ?
                WHERE id = ? AND (rate_limit_hour IS NULL OR rate_limit_hour != ?)
            ", [$currentHour, $keyId, $currentHour]);

            // Atomic increment-and-check: only increments if under the rate limit.
            // Fix #9: COALESCE rate_limit to 1000 — if rate_limit IS NULL in MariaDB,
            // "x < NULL" evaluates to NULL (falsy), causing 0 rows updated and every
            // request to be treated as rate-limited. COALESCE ensures a sensible default.
            $updated = DB::update("
                UPDATE federation_api_keys
                SET hourly_request_count = hourly_request_count + 1
                WHERE id = ? AND hourly_request_count < COALESCE(rate_limit, 1000)
            ", [$keyId]);

            if ($updated === 0) {
                // Either key not found or rate limit exceeded — check which
                $results = DB::select("
                    SELECT rate_limit, hourly_request_count
                    FROM federation_api_keys
                    WHERE id = ?
                ", [$keyId]);

                $config = $results[0] ?? null;
                if (!$config) {
                    return false;
                }

                $rateLimit = (int) ($config->rate_limit ?? 1000);
                $requestCount = (int) $config->hourly_request_count;

                $resetTime = strtotime($currentHour) + 3600;
                $remaining = 0;

                header("X-RateLimit-Limit: {$rateLimit}");
                header("X-RateLimit-Remaining: {$remaining}");
                header("X-RateLimit-Reset: {$resetTime}");

                $retryAfter = max(1, $resetTime - time());
                header("Retry-After: {$retryAfter}");
                return false;
            }

            // Success — fetch current counts for headers
            $results = DB::select("
                SELECT rate_limit, hourly_request_count
                FROM federation_api_keys
                WHERE id = ?
            ", [$keyId]);

            $config = $results[0] ?? null;
            $rateLimit = (int) ($config->rate_limit ?? 1000);
            $requestCount = (int) ($config->hourly_request_count ?? 1);
        } catch (\PDOException $e) {
            // Fallback for pre-migration schemas
            $results = DB::select("
                SELECT rate_limit, request_count
                FROM federation_api_keys
                WHERE id = ?
            ", [$keyId]);

            $config = $results[0] ?? null;

            if (!$config) {
                return false;
            }

            $rateLimit = (int) ($config->rate_limit ?? 1000);
            $requestCount = (int) ($config->request_count ?? 0);

            \Illuminate\Support\Facades\Log::warning('FederationApiMiddleware: Using legacy rate limiting. Run migration for proper hourly reset.');
        }

        $resetTime = strtotime($currentHour) + 3600;
        $remaining = max(0, $rateLimit - $requestCount);

        header("X-RateLimit-Limit: {$rateLimit}");
        header("X-RateLimit-Remaining: {$remaining}");
        header("X-RateLimit-Reset: {$resetTime}");

        return true;
    }

    /**
     * Log API access for auditing.
     */
    private static function logApiAccess(int $keyId, string $endpoint, string $authMethod = 'api_key', ?bool $signatureValid = null): void
    {
        DB::insert("
            INSERT INTO federation_api_logs
            (api_key_id, endpoint, method, ip_address, user_agent, auth_method, signature_valid, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ", [
            $keyId,
            $endpoint,
            $_SERVER['REQUEST_METHOD'],
            ClientIp::get(),
            substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
            $authMethod,
            $signatureValid
        ]);
    }

    /**
     * Send JSON error response.
     */
    public static function sendError(int $statusCode, string $message, string $code): JsonResponse
    {
        return response()->json([
            'error' => true,
            'code' => $code,
            'message' => $message,
            'timestamp' => date('c'),
        ], $statusCode);
    }

    /**
     * Send JSON success response.
     */
    public static function sendSuccess(array $data, int $statusCode = 200): JsonResponse
    {
        return response()->json(array_merge([
            'success' => true,
            'timestamp' => date('c'),
        ], $data), $statusCode);
    }

    /**
     * Send paginated response.
     */
    public static function sendPaginated(array $items, int $total, int $page, int $perPage): JsonResponse
    {
        $totalPages = ceil($total / $perPage);

        return self::sendSuccess([
            'data' => $items,
            'pagination' => [
                'total' => $total,
                'page' => $page,
                'per_page' => $perPage,
                'total_pages' => $totalPages,
                'has_more' => $page < $totalPages
            ]
        ]);
    }
}
