<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class AuthenticateTwoFactorSetup
{
    public function handle(Request $request, Closure $next): Response
    {
        // The controller validates scope, identity, expiry and revocation under
        // its lock. A supplied invalid challenge never falls back to a bearer.
        if ($request->exists('two_factor_token')) {
            $response = $next($request);
            $response->headers->set('Cache-Control', 'private, no-store');
            $response->headers->set('Pragma', 'no-cache');
            return $response;
        }
        return app(Authenticate::class)->handle($request, $next, 'sanctum');
    }
}
