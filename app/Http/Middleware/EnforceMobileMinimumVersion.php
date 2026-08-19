<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

/**
 * Refuses API requests from an Expo mobile build that is too old to be trusted.
 *
 * 🔴 This is the half of the force-update lever that CANNOT be retrofitted, and the
 * reason it had to be built before the first distribution rather than after. A binary
 * already sitting on someone's phone can only be told "you must update" if the copy
 * already knows how to ask — so the client half (sending `X-Nexus-Mobile-Version` on
 * every request, and rendering a blocking screen on 426) must be present in the FIRST
 * release. Ship one build without it and those copies can never be forced forward; a
 * serious bug in them becomes permanent.
 *
 * Push, not pull. `/api/app/check-version` already existed, but it is a pull model: it
 * only works if the app remembers to ask, which an old build might not do, might do
 * badly, or might do and then ignore. This middleware makes the answer unavoidable —
 * every request carries the version, so the server can refuse on any of them.
 *
 * Deliberate design decisions, each of which is a trap if reversed:
 *
 *  * **An absent header is ALLOWED.** Anything without `X-Nexus-Mobile-Version` is
 *    either the web app, the Capacitor wrapper (which polls instead and does not send
 *    the header), a server-to-server caller, or an Expo build from before the header
 *    existed. Refusing unknown callers would take the whole API down for the web
 *    frontend. Enforcement applies only to a client that has *told us* what it is.
 *  * **It fails OPEN.** Any error while deciding is logged and the request proceeds.
 *    A version comparison must never be able to take the platform offline. This is a
 *    deliberate instance of the swallow-and-continue idiom, and the one shape of it
 *    that is defensible: the failure mode is "we did not enforce", not "we returned a
 *    success-shaped lie".
 *  * **`/api/app/*` is exempt** (config `mobile.version_gate_exempt_paths`). Without
 *    it a locked-out copy could not even ask what version it needs, turning a
 *    recoverable "please update" into a dead end — precisely the defect class this
 *    lever exists to prevent.
 *  * **426 Upgrade Required**, not 403. A 403 is indistinguishable from a permissions
 *    problem, and the mobile client already treats 401/403 as a session decision — it
 *    would sign the member out instead of asking them to update.
 */
class EnforceMobileMinimumVersion
{
    /** Set by the Expo client on every request. Absent from every other caller. */
    public const VERSION_HEADER = 'X-Nexus-Mobile-Version';

    /** Stable code the client matches on, so wording can change freely. */
    public const ERROR_CODE = 'APP_UPDATE_REQUIRED';

    public function handle(Request $request, Closure $next): Response
    {
        try {
            $refusal = $this->refusalFor($request);
        } catch (Throwable $e) {
            // Fail open, loudly in the log. Never let this decision break the API.
            Log::warning('[MobileVersionGate] skipped: ' . $e->getMessage());

            return $next($request);
        }

        return $refusal ?? $next($request);
    }

    /**
     * The 426 response this request deserves, or null to let it through.
     */
    private function refusalFor(Request $request): ?Response
    {
        $clientVersion = trim((string) $request->headers->get(self::VERSION_HEADER, ''));

        // Not an Expo client, or an Expo build from before the header existed.
        if ($clientVersion === '') {
            return null;
        }

        // Anything that is not a plain dotted version is not something to act on.
        // Refusing on a malformed value would let a garbled header lock a member out.
        if (preg_match('/^\d+(\.\d+){0,3}$/', $clientVersion) !== 1) {
            return null;
        }

        if ($this->isExempt($request)) {
            return null;
        }

        $minimum = (string) config('mobile.expo.minimum_version', '');
        if ($minimum === '' || version_compare($clientVersion, $minimum, '>=')) {
            return null;
        }

        return response()->json([
            'success' => false,
            'error' => [
                'code' => self::ERROR_CODE,
                // The client shows its own translated wording; this is for logs and
                // for anyone reading the response by hand.
                'message' => 'This version of the app is no longer supported. Please update to continue.',
            ],
            'client_version' => $clientVersion,
            'minimum_version' => $minimum,
            'current_version' => (string) config('mobile.expo.current_version', ''),
            'update_url' => (string) config('mobile.expo.update_url', ''),
        ], Response::HTTP_UPGRADE_REQUIRED);
    }

    /**
     * Whether the path is one the gate must never block.
     */
    private function isExempt(Request $request): bool
    {
        /** @var array<int, string> $patterns */
        $patterns = (array) config('mobile.version_gate_exempt_paths', []);

        foreach ($patterns as $pattern) {
            if ($request->is($pattern)) {
                return true;
            }
        }

        return false;
    }
}
