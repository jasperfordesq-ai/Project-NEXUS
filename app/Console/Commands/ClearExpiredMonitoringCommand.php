<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\AuditLogService;
use App\Services\NotificationDispatcher;
use App\Services\SafeguardingTriggerService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * End broker monitoring whose period has run out.
 *
 * Runs daily. For each restriction whose monitoring_expires_at has passed it
 * clears BOTH under_monitoring and messaging_disabled: "Disable messaging while
 * monitored" is part of the monitoring decision, so it ends with it. It then
 * tells the member, as a broker's manual removal does, and writes
 * `user_monitoring_expired` to the community's activity log.
 *
 * F-217: this command used to clear only under_monitoring. messaging_disabled
 * stayed on, nothing else ever cleared it, and the broker list hides expired
 * rows — members were left unable to send messages indefinitely and unseen.
 * The same query also repairs rows that earlier runs left in that state.
 *
 * Why/when the monitoring was started (monitoring_reason, monitoring_started_at)
 * is kept for the record, matching manual removal.
 */
class ClearExpiredMonitoringCommand extends Command
{
    protected $signature = 'safeguarding:clear-expired-monitoring';
    protected $description = 'End expired safeguarding monitoring and switch messaging back on';

    public function handle(AuditLogService $auditLogService): int
    {
        $now = now();

        $rows = DB::table('user_messaging_restrictions as umr')
            ->join('users as u', function ($join) {
                $join->on('u.id', '=', 'umr.user_id')->on('u.tenant_id', '=', 'umr.tenant_id');
            })
            ->whereNotNull('umr.monitoring_expires_at')
            ->where('umr.monitoring_expires_at', '<', $now)
            ->where(function ($q) {
                $q->where('umr.under_monitoring', true)->orWhere('umr.messaging_disabled', true);
            })
            ->orderBy('umr.id')
            ->get([
                'umr.id', 'umr.user_id', 'umr.tenant_id', 'umr.monitoring_expires_at',
                'umr.messaging_disabled', 'umr.monitoring_reason', 'u.preferred_language',
            ]);

        $previousTenantId = TenantContext::currentId();
        $cleared = 0;

        try {
            foreach ($rows as $row) {
                // Conditional on the expiry we read, so a broker who extends the
                // period at the same moment is not overridden.
                $affected = DB::table('user_messaging_restrictions')
                    ->where('id', $row->id)
                    ->where('monitoring_expires_at', $row->monitoring_expires_at)
                    ->update([
                        'under_monitoring' => false,
                        'messaging_disabled' => false,
                        'monitoring_expires_at' => null,
                        'restriction_reason' => DB::raw("CONCAT(COALESCE(restriction_reason, ''), ' [Monitoring period ended]')"),
                    ]);

                if ($affected !== 1) {
                    continue;
                }
                $cleared++;

                TenantContext::setById((int) $row->tenant_id);

                $auditLogService->log('user_monitoring_expired', null, null, [
                    'user_id' => (int) $row->user_id,
                    'expired_at' => (string) $row->monitoring_expires_at,
                    'messaging_was_disabled' => (bool) $row->messaging_disabled,
                ], (int) $row->user_id);

                // A self-selected onboarding preference never told the member
                // they were restricted, so do not tell them it was lifted.
                if (($row->monitoring_reason ?? null) === SafeguardingTriggerService::MONITORING_REASON_ONBOARDING) {
                    continue;
                }

                try {
                    LocaleContext::withLocale($row->preferred_language ?? null, function () use ($row) {
                        $message = __('api_controllers_3.admin_bells.monitoring_lifted');
                        Notification::createNotification(
                            (int) $row->user_id,
                            $message,
                            '/messages',
                            'system',
                            true,
                            (int) $row->tenant_id,
                            'monitoring-expired:' . $row->id . ':' . $row->monitoring_expires_at,
                        );
                        NotificationDispatcher::fanOutPush((int) $row->user_id, 'system', $message, '/messages');
                    });
                } catch (\Throwable $e) {
                    Log::warning('[ClearExpiredMonitoring] restrictions-lifted notification failed', [
                        'user_id' => (int) $row->user_id,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }

        if ($cleared > 0) {
            Log::info('Cleared expired monitoring restrictions', ['count' => $cleared]);
            $this->info("Cleared {$cleared} expired monitoring restriction(s).");
        } else {
            $this->info('No expired monitoring restrictions found.');
        }

        return self::SUCCESS;
    }
}
