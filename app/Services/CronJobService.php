<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * CronJobService — Laravel DI-based service for cron job monitoring.
 *
 * Tracks scheduled job execution status and history for admin dashboards.
 */
class CronJobService
{
    /**
     * Get the status of all registered cron jobs.
     */
    public function getStatus(int $tenantId): array
    {
        $jobs = DB::table('cron_jobs')
            ->where(fn ($q) => $q->where('tenant_id', $tenantId)->orWhereNull('tenant_id'))
            ->orderBy('name')
            ->get()
            ->map(fn ($j) => (array) $j)
            ->all();

        return $jobs;
    }

    // run() and getHistory() — REMOVED 2026-08-28
    //
    // Both wrote to or read a `cron_job_runs` table that exists in no
    // migration, no schema dump and no live database. Nothing called either
    // method; the class is referenced only by its container registration. Cron
    // monitoring actually in use is App\Services\CronJobRunner.
}
