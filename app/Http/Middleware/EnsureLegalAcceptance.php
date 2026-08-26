<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use App\Core\ApiErrorCodes;
use App\Core\TenantContext;
use App\Services\LegalEnforcementService;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

/**
 * Require the authenticated member to have accepted the community's current legal
 * documents before letting them act.
 *
 * Modelled deliberately on `EnsureOnboardingComplete` — the existing precedent for
 * "authenticated user fails a precondition → 403 with a machine code" — and it
 * reuses that response envelope verbatim so clients need no new error handling
 * shape.
 *
 * Two things here diverge from `EnsureOnboardingComplete`, both on purpose:
 *
 * 🔴 1. It FAILS OPEN. `EnsureOnboardingComplete` enforces when its config lookup
 *       throws; this lets the request through. A legal gate sits on ordinary
 *       member writes, so if Redis blinks or a query fails, enforcing would stop
 *       members using the platform — a self-inflicted outage in the name of
 *       compliance. One extra write getting through before someone accepts is the
 *       far smaller harm.
 *
 * 🔴 2. It has MODES (`config/legal.php`), and the shipped default is `write`.
 *       An unrecognised value ALSO falls back to `write` — see `mode()`. That is
 *       an owner decision of 2026-08-11: acceptance is a legal obligation, not an
 *       option, so nobody may soften it back to `off` by accident or by typo.
 *
 *       `report` never blocks: it logs `legal.gate.would_block` with the calling
 *       client and sets `X-Legal-Acceptance-Pending: 1`, so the blast radius can
 *       be measured per client in production before anything is enforced. It is
 *       the mode to choose for a measurement week, NOT the default.
 *
 *       🔴 All three clients now have an acceptance screen (React, web-uk and
 *       mobile — see `config/legal.php`). An earlier version of this docblock said
 *       the mobile app had none and would be bricked by enforcement; that was
 *       falsified the same day the screen shipped.
 *
 * Attach PER ROUTE, never to a group, following `onboarding-required`'s precedent
 * in `routes/api.php`.
 */
class EnsureLegalAcceptance
{
    /**
     * Paths that must NEVER be gated, matched as prefixes after the leading slash
     * is normalised.
     *
     * 🔴 This list is what stops the gate locking the door with the key inside. It
     * lives in the middleware rather than relying on careful route attachment,
     * because a future attachment to a broader group must not be able to make the
     * acceptance flow itself unreachable.
     *
     * Four groups, and the last is the non-obvious one:
     *
     *  - reading the documents, and accepting them;
     *  - the whole auth lifecycle, so a member can always sign in and out;
     *  - health, webhooks, contact and cookie consent — nothing a pending
     *    acceptance should stand in the way of;
     *  - 🔴 SHELL CHROME. `web-uk/src/server.js` calls `/v2/users/me`, the
     *    notification and message unread counts, and the tenant bootstrap on
     *    EVERY render — including the acceptance interstitial itself. Gate those
     *    and the interstitial cannot render, so the member can never reach the
     *    button that would clear the gate.
     */
    private const EXEMPT_PREFIXES = [
        // Reading and accepting
        'api/v2/legal',
        'api/legal',
        // Auth lifecycle
        'api/auth',
        'api/v2/auth',
        'api/totp',
        'api/webauthn',
        'api/v2/webauthn',
        // Platform plumbing
        'api/health',
        'api/v2/health',
        'api/webhooks',
        'api/v2/webhooks',
        'api/contact',
        'api/v2/contact',
        'api/cookie-consent',
        'api/v2/cookie-consent',
        // Shell chrome — see the note above. Without these the interstitial
        // cannot render.
        //
        // 🔴 `api/v2/users/me` is NOT here. It is an EXACT match in
        // EXEMPT_EXACT_PATHS below, because as a prefix it silently exempted four
        // of the routes this gate is attached to. See that constant.
        'api/v2/notifications/counts',
        'api/v2/notifications/unread-count',
        'api/v2/messages/unread-count',
        'api/v2/tenant/bootstrap',
        'api/v2/tenants',
    ];

    /**
     * Paths exempt ONLY as an exact match — never as a prefix.
     *
     * 🔴 WHY THIS CONSTANT EXISTS. `api/v2/users/me` was in EXEMPT_PREFIXES, so
     * `str_starts_with($path, 'api/v2/users/me/')` also exempted everything
     * beneath it — including four routes this very middleware is attached to in
     * `routes/api.php`:
     *
     *   POST /v2/users/me/sub-accounts/{childId}/listings
     *   POST /v2/users/me/sub-accounts/{childId}/transfer
     *   POST /v2/users/me/sub-accounts/{childId}/listings/{listingId}/image
     *   POST /v2/users/me/support-actions
     *
     * So a member with a pending acceptance could still create listings for and
     * transfer credits on behalf of a supported child, while the gate reported
     * itself as enforcing. Four of fourteen attachment points were inert from
     * 2026-08-11 until this was found the same day.
     *
     * The shell only ever calls `/api/v2/users/me` itself (`web-uk/src/lib/api.js`),
     * so the exact match is sufficient and the sub-paths gate correctly.
     *
     * `EnsureLegalAcceptanceRouteCoverageTest` walks every route carrying this
     * middleware and fails if any of them is exempt, so this cannot regress
     * silently — including for a route added under some other prefix later.
     */
    private const EXEMPT_EXACT_PATHS = [
        'api/v2/users/me',
    ];

    public function handle(Request $request, Closure $next): Response
    {
        $mode = self::mode();
        if ($mode === 'off') {
            return $next($request);
        }

        if (self::isExemptPath($request)) {
            return $next($request);
        }

        $user = $request->user();
        if (!$user) {
            // Not this middleware's job. `auth:sanctum` runs first on every route
            // the gate is attached to, so reaching here unauthenticated means the
            // route is public — and a public route has nobody to gate.
            return $next($request);
        }

        // Machine callers have no member to ask. A partner integration cannot
        // click "I accept", and blocking it would break an integration to enforce
        // a consent that does not apply to it.
        if ($request->attributes->has('partner') || $request->attributes->has('federation_partner')) {
            return $next($request);
        }

        if (self::isAdminUser($user)) {
            return $next($request);
        }

        try {
            $tenantId = TenantContext::getId();
            if (!$tenantId) {
                return $next($request);
            }

            $blocked = LegalEnforcementService::isBlocked((int) $user->id, (int) $tenantId);
        } catch (\Throwable $e) {
            // Fail OPEN — see the class docblock.
            Log::warning('[LegalGate] check failed, allowing request: ' . $e->getMessage());
            return $next($request);
        }

        if (!$blocked) {
            return $next($request);
        }

        if ($mode === 'report') {
            // 🔴 `warning`, NOT `info`. `config/logging.php` defaults every channel
            // to `level => env('LOG_LEVEL', 'warning')`, so an `info` line is
            // dropped on any environment that has not deliberately lowered the
            // threshold — which includes production and this dev machine. Report
            // mode exists ONLY to produce this record; logging it below the
            // threshold makes the whole mode silently useless while still looking
            // like it works, because the response header is set either way.
            //
            // `warning` is also the honest level: "this request would have been
            // refused" is a thing an operator should see, and report mode is a
            // deliberate, temporary diagnostic state, not steady-state noise.
            Log::warning('legal.gate.would_block', [
                'user_id' => (int) $user->id,
                'tenant_id' => (int) TenantContext::getId(),
                'path' => $request->path(),
                'method' => $request->method(),
                // Which client this member is using is the whole point of report
                // mode: it says who would be bricked by enforcing.
                'user_agent' => (string) $request->userAgent(),
                'client' => (string) $request->header('X-Client-Platform', ''),
            ]);

            $response = $next($request);
            $response->headers->set('X-Legal-Acceptance-Pending', '1');
            return $response;
        }

        return response()->json([
            'errors' => [[
                'code'    => ApiErrorCodes::LEGAL_ACCEPTANCE_REQUIRED,
                'message' => __('api.legal.acceptance_required'),
            ]],
            'success' => false,
        ], 403, ['API-Version' => '2.0']);
    }

    /** The only values that mean anything. */
    private const VALID_MODES = ['off', 'report', 'write', 'all'];

    /**
     * The enforcement mode, with anything unrecognised falling back to `write`.
     *
     * 🔴 This fallback REVERSED on 2026-08-11, at the same time as the default.
     * While the default was `off`, the hazard was a typo silently starting to block
     * members, so an unrecognised value fell back to permissive. Now that
     * enforcement is the legal baseline, the hazard is the opposite: a typo
     * silently switching off an obligation. Failing toward the obligation is the
     * safer error.
     *
     * Either way it is not silent — an unrecognised value logs a warning naming the
     * value, once per process rather than per request, so a misconfigured
     * environment is visible without flooding the log from a hot path.
     */
    public static function mode(): string
    {
        $configured = strtolower(trim((string) config('legal.enforcement_mode', 'write')));

        if (in_array($configured, self::VALID_MODES, true)) {
            return $configured;
        }

        if (!self::$warnedAboutMode) {
            self::$warnedAboutMode = true;
            Log::warning('legal.gate.invalid_mode', [
                'configured' => $configured,
                'using' => 'write',
                'valid' => self::VALID_MODES,
            ]);
        }

        return 'write';
    }

    /** Guards the invalid-mode warning so it is logged once, not per request. */
    private static bool $warnedAboutMode = false;

    /**
     * Does the current mode actually REFUSE requests?
     *
     * 🔴 WHY THIS IS PUBLIC, and why clients must ask rather than decide.
     *
     * `web-uk/src/middleware/legal-gate.js` interposed an interstitial whenever a
     * document was pending, without ever asking whether enforcement was switched
     * on. Its docblock claimed the mode decided — no code read it. So an
     * installation deliberately running `report` ("log who WOULD be blocked, block
     * nobody, for a measurement week") still had every accessible-frontend member
     * redirected before any page. The measurement week would have measured a
     * frontend that was already enforcing, and `off` did not mean off.
     *
     * The fix is not to duplicate the mode table in JavaScript — a copy drifts, and
     * two gates disagreeing about who is blocked is worse than one being wrong.
     * `GET /v2/legal/acceptance/status` publishes THIS predicate as
     * `enforcement_blocking`, and every client obeys it.
     *
     * `off` never blocks. `report` never blocks — that is its entire purpose.
     * `write` and `all` block; they differ in WHICH routes carry the middleware,
     * which is a routing decision, not a client-visible one.
     */
    public static function modeBlocks(?string $mode = null): bool
    {
        return in_array($mode ?? self::mode(), ['write', 'all'], true);
    }

    private static function isExemptPath(Request $request): bool
    {
        $path = ltrim($request->path(), '/');

        if (in_array($path, self::EXEMPT_EXACT_PATHS, true)) {
            return true;
        }

        foreach (self::EXEMPT_PREFIXES as $prefix) {
            if ($path === $prefix || str_starts_with($path, $prefix . '/')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Admins pass through, so a community can always fix its own documents and
     * help a member who is stuck.
     *
     * 🔴 Checks the boolean flags, not only `users.role`. `super_admin`, `god`,
     * `tenant_admin` and `coordinator` are never written to `users.role` by the
     * API, so a role-string-only check under-authorises a real platform admin.
     */
    public static function isAdminUser(object $user): bool
    {
        $role = (string) ($user->role ?? '');

        return (bool) ($user->is_admin ?? false)
            || (bool) ($user->is_super_admin ?? false)
            || (bool) ($user->is_tenant_super_admin ?? false)
            || (bool) ($user->is_god ?? false)
            || in_array($role, ['admin', 'tenant_admin', 'super_admin'], true);
    }
}
