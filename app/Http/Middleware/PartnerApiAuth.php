<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Core\TenantContext;
use App\Services\PartnerApi\PartnerApiAuthService;
use App\Services\PartnerApi\PartnerApiRateLimiter;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * AG60 — Partner API authentication middleware.
 *
 * Pipeline (per request):
 *   1. Extract Bearer token from Authorization header
 *   2. Resolve token → partner row + scopes
 *   3. Push the partner's tenant_id into TenantContext (cross-tenant safe)
 *   4. Verify the partner's status is 'active'
 *   5. Verify caller IP is allowed (if allowed_ip_cidrs is set)
 *   6. Verify the route's required scope is granted
 *   7. Sandbox guard — block writes for sandbox partners
 *   8. Per-partner Redis rate limit
 *   9. Log the call to api_call_log
 *
 * Routes attach the required scope via middleware parameter, e.g.
 *   ->middleware('partner.api:users.read')
 */
class PartnerApiAuth
{
    public function handle(Request $request, Closure $next, ?string $requiredScope = null): Response
    {
        $startedAt = microtime(true);

        $auth = $request->header('Authorization', '');
        if (! is_string($auth) || ! preg_match('/^Bearer\s+(\S+)$/i', $auth, $m)) {
            return $this->reject(401, 'invalid_token', 'Missing or malformed bearer token.');
        }
        $token = $m[1];

        $resolved = PartnerApiAuthService::resolveAccessToken($token);
        if (! $resolved) {
            return $this->reject(401, 'invalid_token', 'The access token is invalid or expired.');
        }

        $partner = $resolved['partner'];
        $scopes = $resolved['scopes'];

        // Re-bind tenant context to the partner's tenant — partner API is
        // cross-tenant safe even when the host header doesn't carry a slug.
        TenantContext::setById((int) $partner['tenant_id']);

        // F-175: the Partner API is a per-community opt-in feature (default OFF).
        // Even with a valid token and the platform kill switch on, a partner whose
        // community has the `partner_api` feature turned off must be refused. The
        // platform kill switch (EnsurePartnerApiEnabled) is a separate, global gate.
        if (! TenantContext::hasFeature('partner_api')) {
            $this->log($request, $partner, 403, $startedAt);
            return $this->reject(403, 'partner_api_disabled', 'Partner API is not enabled for this community.');
        }

        // IP allowlist (CIDR list, optional)
        $allowedCidrs = $this->decodeJsonArray($partner['allowed_ip_cidrs'] ?? null);
        if (! empty($allowedCidrs) && ! $this->ipMatchesAny($request->ip() ?? '', $allowedCidrs)) {
            $this->log($request, $partner, 403, $startedAt);
            return $this->reject(403, 'ip_not_allowed', 'Caller IP is not in the partner allowlist.');
        }

        // Scope check
        if ($requiredScope !== null && ! in_array($requiredScope, $scopes, true)) {
            $this->log($request, $partner, 403, $startedAt);
            return $this->reject(403, 'insufficient_scope', "Required scope: {$requiredScope}");
        }

        // Sandbox writes are blocked. v1 sandbox is read-only.
        if ((int) ($partner['is_sandbox'] ?? 0) === 1
            && in_array(strtoupper($request->method()), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            $this->log($request, $partner, 403, $startedAt);
            return $this->reject(403, 'sandbox_write_disabled', 'Sandbox partners may only call read-only endpoints.');
        }

        // Rate limit
        $limit = (int) ($partner['rate_limit_per_minute'] ?? 60);
        $rl = PartnerApiRateLimiter::hit((int) $partner['id'], $limit > 0 ? $limit : 60);
        if (! $rl['allowed']) {
            $this->log($request, $partner, 429, $startedAt);
            return $this->reject(429, 'rate_limited', 'Rate limit exceeded.', [
                'Retry-After' => (string) $rl['retry_after'],
                'X-RateLimit-Limit' => (string) $rl['limit'],
                'X-RateLimit-Remaining' => '0',
            ]);
        }

        // Stash partner on the request for downstream controllers
        $request->attributes->set('partner', $partner);
        $request->attributes->set('partner_scopes', $scopes);

        /** @var Response $response */
        $response = $next($request);

        $response->headers->set('X-RateLimit-Limit', (string) $rl['limit']);
        $response->headers->set('X-RateLimit-Remaining', (string) $rl['remaining']);

        $this->log($request, $partner, $response->getStatusCode(), $startedAt);

        return $response;
    }

    private function reject(int $status, string $code, string $message, array $extraHeaders = []): Response
    {
        return response()->json([
            'success' => false,
            'errors' => [['code' => $code, 'message' => $message]],
        ], $status, array_merge(['API-Version' => '2.0'], $extraHeaders));
    }

    private function log(Request $request, array $partner, int $status, float $startedAt): void
    {
        try {
            DB::table('api_call_log')->insert([
                'partner_id' => (int) $partner['id'],
                'tenant_id' => (int) $partner['tenant_id'],
                'method' => strtoupper($request->method()),
                'path' => substr((string) $request->path(), 0, 255),
                'status_code' => $status,
                'response_time_ms' => (int) ((microtime(true) - $startedAt) * 1000),
                'ip' => $request->ip(),
                'user_agent' => substr((string) $request->userAgent(), 0, 255),
                'created_at' => now(),
            ]);
        } catch (\Throwable) {
            // Never let logging failures break the request.
        }
    }

    private function decodeJsonArray(mixed $value): array
    {
        if (is_string($value)) {
            $decoded = json_decode($value, true);
            return is_array($decoded) ? $decoded : [];
        }
        return is_array($value) ? $value : [];
    }

    private function ipMatchesAny(string $ip, array $cidrs): bool
    {
        foreach ($cidrs as $cidr) {
            if ($this->ipInCidr($ip, (string) $cidr)) {
                return true;
            }
        }
        return false;
    }

    private function ipInCidr(string $ip, string $cidr): bool
    {
        if (! str_contains($cidr, '/')) {
            return $ip === $cidr;
        }
        [$subnet, $bits] = explode('/', $cidr, 2);
        $bits = (int) $bits;

        if (filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)
            && filter_var($subnet, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4)) {
            $ipLong = ip2long($ip);
            $subLong = ip2long($subnet);
            if ($bits <= 0 || $bits > 32) {
                return false;
            }
            $mask = -1 << (32 - $bits);
            return ($ipLong & $mask) === ($subLong & $mask);
        }

        // IPv6 fallback (string compare on the masked binary)
        $ipBin = @inet_pton($ip);
        $subBin = @inet_pton($subnet);
        if ($ipBin === false || $subBin === false) {
            return false;
        }
        $bytes = intdiv($bits, 8);
        $remainder = $bits % 8;
        if (substr($ipBin, 0, $bytes) !== substr($subBin, 0, $bytes)) {
            return false;
        }
        if ($remainder === 0) {
            return true;
        }
        $mask = chr(0xff << (8 - $remainder) & 0xff);
        return (ord($ipBin[$bytes]) & ord($mask)) === (ord($subBin[$bytes]) & ord($mask));
    }
}
