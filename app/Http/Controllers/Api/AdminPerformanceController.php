<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Controllers\Api;

use App\Services\PerformanceInsightsService;
use Illuminate\Http\JsonResponse;

/**
 * AdminPerformanceController — request timings, slow queries and memory use.
 *
 * 🔴 This is what /admin/performance reads. It used to read
 * /v2/metrics/summary, which is the unrelated event-counter endpoint; the page
 * crashed on the first key that endpoint does not return. Do not point it back
 * there, and do not add profiling keys to MetricsController — the two answer
 * different questions.
 */
class AdminPerformanceController extends BaseApiController
{
    protected bool $isV2Api = true;

    public function __construct(
        private readonly PerformanceInsightsService $insights,
    ) {}

    /**
     * GET /api/v2/admin/performance/summary
     *
     * Query params: hours (1–720, default 24).
     */
    public function summary(): JsonResponse
    {
        $this->requireAdmin();
        $tenantId = $this->getTenantId();

        $maxHours = max(1, (int) config('performance.limits.max_window_hours', 720));
        $hours = $this->queryInt('hours', 24, 1, $maxHours) ?? 24;

        $data = $this->insights->summary($tenantId, $hours);

        return $this->respondWithData($data, [
            // Stated rather than implied: an empty report on a platform where
            // recording is switched off means something different from an empty
            // report on a quiet day, and the page should be able to say which.
            'recording_enabled' => (bool) config('performance.enabled', false),
            'retention_days' => (int) config('performance.retention_days', 14),
        ]);
    }
}
