<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\CaringCommunity\SafeguardingService;
use App\Support\Sentry\OperatorLog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Escalates safeguarding reports that have breached their SLA window.
 *
 * The sweep is driven by the WORK, not by tenant configuration: it enumerates
 * the tenants that actually own an open, un-escalated, overdue report, sets
 * tenant context for each, and escalates every match via
 * `SafeguardingService::escalateReport()`, producing the same audit-log action
 * as a coordinator-driven escalation.
 *
 * 🔴 F-408 — it used to enumerate `tenants` filtered by `is_active = 1` and
 * then skip any community without the `caring_community` feature. Both
 * switches are reachable by an ordinary community administrator
 * (`PUT /v2/admin/config/features` calls `requireAdmin()`, not
 * `requireSuperAdmin()`), so one API call silenced the breach alert for every
 * concern that was ALREADY OPEN — no bell, no email, no Sentry event — while
 * the concern sat past its deadline still showing `status = submitted`.
 * Deactivating the community did the same thing by a second route.
 *
 * A concern that has breached its review deadline is escalated regardless of
 * the module switch and regardless of `is_active`. Turning a module off
 * governs what a community can do NEXT; it cannot retire a safeguarding
 * obligation the community already has. When the sweep escalates inside a
 * community whose module is off or which is deactivated, that mismatch is
 * raised as one fingerprinted alert rather than a console counter nobody reads.
 *
 * Idempotent — once a row is marked escalated=1 it is skipped on subsequent
 * runs, so the alert also quiets itself once the backlog is cleared. Designed
 * to run every 15 minutes.
 */
class SafeguardingSlaEscalateCommand extends Command
{
    protected $signature = 'safeguarding:sla-escalate {--dry-run : Report counts without writing changes}';
    protected $description = 'Escalates safeguarding reports that have breached their SLA window.';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');

        if (!Schema::hasTable('safeguarding_reports') || !Schema::hasTable('tenants')) {
            $this->info('Skipping — required tables missing.');
            return self::SUCCESS;
        }

        $service = app(SafeguardingService::class);

        // Enumerated from the reports themselves, so neither `tenants.is_active`
        // nor the `caring_community` feature can remove a community with an
        // overdue safeguarding concern from the sweep (F-408).
        $tenantIds = $this->overdueQuery()
            ->distinct()
            ->pluck('tenant_id')
            ->map(fn ($id): int => (int) $id)
            ->filter(fn (int $id): bool => $id > 0)
            ->values()
            ->all();

        $totalEscalated = 0;
        $totalChecked = 0;
        $tenantsProcessed = 0;

        /** @var list<array{tenant_id: int, module_enabled: bool, tenant_active: bool}> $suppressed */
        $suppressed = [];

        $previousTenantId = TenantContext::currentId();

        foreach ($tenantIds as $tenantId) {
            try {
                // A failed set leaves the PREVIOUS tenant in context, which
                // would escalate one community's reports under another's scope.
                if (!TenantContext::setById($tenantId)) {
                    Log::warning('[SafeguardingSlaEscalate] tenant context could not be set', [
                        'tenant_id' => $tenantId,
                    ]);
                    continue;
                }

                // Recorded, never acted on: the sweep proceeds either way.
                $moduleEnabled = TenantContext::hasFeature('caring_community');
                $tenantActive = (bool) (TenantContext::get()['is_active'] ?? false);

                $rows = $this->overdueQuery()
                    ->where('tenant_id', $tenantId)
                    ->get(['id']);

                $totalChecked += $rows->count();
                if ($rows->isEmpty()) {
                    $tenantsProcessed++;
                    continue;
                }

                if (!$moduleEnabled || !$tenantActive) {
                    $suppressed[] = [
                        'tenant_id' => $tenantId,
                        'module_enabled' => $moduleEnabled,
                        'tenant_active' => $tenantActive,
                    ];
                }

                foreach ($rows as $row) {
                    if ($dryRun) {
                        $totalEscalated++;
                        continue;
                    }

                    try {
                        // Actor 0 represents "system" — the audit row records
                        // the escalation as automated. The escalateReport()
                        // method only validates the report exists; it does
                        // not require the actor row to exist.
                        $service->escalateReport(
                            (int) $row->id,
                            0,
                            'Auto-escalated: SLA breached'
                        );
                        $totalEscalated++;
                    } catch (Throwable $e) {
                        Log::warning('[SafeguardingSlaEscalate] escalate failed', [
                            'tenant_id' => $tenantId,
                            'report_id' => (int) $row->id,
                            'error'     => $e->getMessage(),
                        ]);
                    }
                }

                $tenantsProcessed++;
            } catch (Throwable $e) {
                Log::error('[SafeguardingSlaEscalate] tenant failure', [
                    'tenant_id' => $tenantId,
                    'error'     => $e->getMessage(),
                ]);
                continue;
            }
        }

        // Restore previous tenant context (best-effort).
        if ($previousTenantId !== null) {
            try {
                TenantContext::setById((int) $previousTenantId);
            } catch (Throwable) {
                // ignore
            }
        } else {
            TenantContext::reset();
        }

        $this->info(sprintf(
            '%s: tenants=%d/%d suppressed_module=%d checked=%d escalated=%d',
            $dryRun ? 'DRY RUN' : 'Done',
            $tenantsProcessed,
            count($tenantIds),
            count($suppressed),
            $totalChecked,
            $totalEscalated,
        ));

        Log::info('[SafeguardingSlaEscalate] run complete', [
            'dry_run'                     => $dryRun,
            'tenants_processed'           => $tenantsProcessed,
            'tenants_with_module_disabled' => count($suppressed),
            'reports_checked'             => $totalChecked,
            'reports_escalated'           => $totalEscalated,
        ]);

        $this->alertOnDisabledModules($suppressed);

        // Always SUCCESS: this command is scheduled every fifteen minutes and is
        // NOT runInBackground(), so a non-zero exit would be re-reported by the
        // scheduler on every run. The alarm is the fingerprinted capture above.
        return self::SUCCESS;
    }

    /**
     * Open, un-escalated, past its review deadline. The single definition, used
     * both to choose which tenants to sweep and to select the rows within one.
     */
    private function overdueQuery(): \Illuminate\Database\Query\Builder
    {
        return DB::table('safeguarding_reports')
            ->whereNotIn('status', ['resolved', 'dismissed'])
            ->where(function ($q): void {
                $q->where('escalated', 0)->orWhereNull('escalated');
            })
            ->whereNotNull('review_due_at')
            ->where('review_due_at', '<', now());
    }

    /**
     * One fingerprinted alert naming the communities whose safeguarding module
     * is off (or which are deactivated) while they still hold concerns past
     * their review deadline. The console counter this replaces was printed and
     * discarded, which is what let F-408 be silent.
     *
     * @param list<array{tenant_id: int, module_enabled: bool, tenant_active: bool}> $suppressed
     */
    private function alertOnDisabledModules(array $suppressed): void
    {
        if ($suppressed === []) {
            return;
        }

        // Deliberately STABLE message text — Sentry groups by it; everything
        // volatile goes in the context. Same rule as SafeguardingPolicyHealthCheck.
        $message = 'Safeguarding SLA escalation ran in a community whose caring_community module is disabled or which is deactivated';
        $context = [
            'affected_tenants' => $suppressed,
            'affected_count' => count($suppressed),
            'fix' => 'Re-enable the caring_community module (or reactivate the community), or resolve/dismiss the open safeguarding concerns through the coordinator dashboard.',
        ];

        // Local log ONLY — the explicit capture below is the single Sentry event.
        OperatorLog::withoutSentry()->error($message, $context);

        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'safeguarding_sla_module_disabled');
                    $scope->setFingerprint(['safeguarding_sla_escalation_module_disabled']);
                    $scope->setContext('safeguarding_sla_escalation', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (Throwable $e) {
            Log::debug('safeguarding:sla-escalate Sentry capture failed: ' . $e->getMessage());
        }

        foreach ($suppressed as $row) {
            $this->error(sprintf(
                'Tenant %d: overdue safeguarding concerns escalated although caring_community=%s and is_active=%s.',
                $row['tenant_id'],
                $row['module_enabled'] ? 'on' : 'OFF',
                $row['tenant_active'] ? '1' : '0',
            ));
        }
    }
}
