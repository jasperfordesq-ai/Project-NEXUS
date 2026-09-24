<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Middleware\TenantFeatureMiddleware;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate the complete Caring Community API namespace, including public invites
 * and routes added later, after ResolveTenant has selected the community.
 */
final class EnsureCaringCommunityEnabled
{
    public function __construct(private readonly TenantFeatureMiddleware $featureGate) {}

    public function handle(Request $request, Closure $next): Response
    {
        if ($request->is('api/v2/caring-community', 'api/v2/caring-community/*',
            'api/v2/admin/caring-community', 'api/v2/admin/caring-community/*')) {
            return $this->featureGate->handle($request, $next, 'caring_community');
        }

        return $next($request);
    }
}
