<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Jobs;

use App\Services\TenantProvisioning\TenantPurgeService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Asynchronously purge a tenant so the god-admin's HTTP request returns
 * immediately — a full purge can delete millions of rows and call external APIs,
 * which would time out a synchronous request.
 *
 * The destructive guards (not Master, must be deactivated, no children) are
 * enforced inside TenantPurgeService, so they hold even if this job is replayed.
 * $tries = 1: a purge must never auto-retry — it is idempotent but re-running on
 * a transient failure would double-log and re-hit external APIs needlessly.
 *
 * 🔴 F-353: the job carries the ACTOR as well as the tenant id. The audit row
 * for a purge is written where the work happens — here, in a worker process
 * that has no HTTP session and no resolved super-panel access — so without
 * this payload the most destructive action the platform offers was recorded
 * against actor_user_id = 0, actor_name = 'System'. Production runs
 * QUEUE_CONNECTION=redis, so that was the only branch that ever ran live.
 */
class PurgeTenantJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    public int $tries = 1;
    public int $timeout = 1800; // 30 min — large tenants have millions of rows.

    public function __construct(
        public readonly int $tenantId,
        public readonly ?int $actorUserId = null,
        public readonly ?int $actorTenantId = null,
        public readonly ?string $actorIpAddress = null,
        public readonly ?string $actorUserAgent = null,
    ) {}

    public function handle(): void
    {
        try {
            $report = TenantPurgeService::purge($this->tenantId, [
                'dry_run' => false,
                'actor'   => [
                    'user_id'    => $this->actorUserId,
                    'tenant_id'  => $this->actorTenantId,
                    'ip_address' => $this->actorIpAddress,
                    'user_agent' => $this->actorUserAgent,
                ],
            ]);

            if (!($report['success'] ?? false)) {
                Log::error('PurgeTenantJob: purge refused', [
                    'tenant_id' => $this->tenantId,
                    'error'     => $report['error'] ?? 'unknown',
                ]);
                return;
            }

            Log::warning('PurgeTenantJob: tenant purged', [
                'tenant_id'      => $this->tenantId,
                'actor_user_id'  => $this->actorUserId,
                'totals'         => $report['totals'] ?? null,
                'warnings'       => $report['warnings'] ?? [],
            ]);
        } catch (Throwable $e) {
            Log::error('PurgeTenantJob failed', [
                'tenant_id' => $this->tenantId,
                'error'     => $e->getMessage(),
            ]);
            // Don't rethrow — a purge is idempotent and can be re-triggered manually
            // via `php artisan tenant:purge`. Auto-retry is disabled ($tries = 1).
        }
    }
}
