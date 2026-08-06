<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Middleware;

use App\Support\Performance\PerformanceRecorder;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Writes the request's performance sample — after the response has been sent.
 *
 * handle() deliberately does nothing. All the work is in terminate(), which
 * Laravel calls once the response has left, so a recorded request is no slower
 * for the user than an unrecorded one. Timing does not come from here either:
 * the recorder measures from the moment the request reached PHP, so the figure
 * covers the whole request including framework boot, not just the part inside
 * this middleware.
 *
 * Because of that, this middleware's position in the stack does not matter.
 */
final class RecordPerformanceSample
{
    public function __construct(
        private readonly PerformanceRecorder $recorder,
    ) {}

    public function handle(Request $request, Closure $next): Response
    {
        // The one thing that cannot wait until terminate(): establishing the
        // memory baseline. See PerformanceRecorder::beginRequest() for why the
        // raw PHP peak figure is worthless on a long-lived worker.
        $this->recorder->beginRequest();

        return $next($request);
    }

    public function terminate(Request $request, Response $response): void
    {
        $this->recorder->flush($request, $response);
    }
}
