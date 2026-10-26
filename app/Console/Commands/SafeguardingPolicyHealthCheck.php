<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Core\TenantContext;
use App\Services\MemberVettingAttestationService;
use App\Services\NotificationDispatcher;
use App\Services\SafeguardingJurisdictionService;
use App\Support\Sentry\OperatorLog;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Safeguarding policy-health pager.
 *
 * A member who ticks "only vetted people may contact me" in a tenant whose
 * safeguarding jurisdiction is unconfigured (or unusable) puts the contact
 * gate into permanent UNAVAILABLE: it fails closed, silently dropping that
 * member from everyone's matches and blocking contact — protection nobody can
 * satisfy and nobody is told about. That exact state ran unnoticed in
 * production for weeks (Sentry 134069538): the per-request logs were triaged
 * as noise while the underlying configuration gap sat unowned.
 *
 * This check moves the alarm to the right altitude: ONE daily, fingerprinted
 * alert naming the affected tenants, instead of hundreds of per-request log
 * lines. The fix is an admin action (broker panel → Vetting → Jurisdiction),
 * not a code change. Exits non-zero when any tenant is affected — scheduled
 * with runInBackground() like the other pagers so that intentional breach
 * exit is not re-reported by the scheduler (see
 * PagerCommandsRunInBackgroundTest).
 */
class SafeguardingPolicyHealthCheck extends Command
{
    protected $signature = 'safeguarding:check-policy-health';

    protected $description = 'Alert when a tenant has live vetted-interaction selections but an unusable safeguarding policy';

    public function handle(
        SafeguardingJurisdictionService $jurisdictions,
        MemberVettingAttestationService $attestations,
    ): int {
        if (! Schema::hasTable('user_safeguarding_preferences') || ! Schema::hasTable('tenant_safeguarding_options')) {
            $this->warn('Safeguarding tables absent — nothing to check.');

            return self::SUCCESS;
        }

        // Tenants with at least one live (non-revoked) member selection on an
        // active option whose triggers require vetted interaction. The
        // triggers column is JSON; decode in PHP rather than depending on
        // MariaDB JSON functions.
        $optionRows = DB::table('user_safeguarding_preferences as p')
            ->join('tenant_safeguarding_options as o', 'o.id', '=', 'p.option_id')
            ->whereNull('p.revoked_at')
            ->where('o.is_active', 1)
            ->distinct()
            ->get(['p.tenant_id', 'o.id as option_id', 'o.triggers']);

        $tenantIds = [];
        foreach ($optionRows as $row) {
            $triggers = json_decode((string) ($row->triggers ?? ''), true);
            if (is_array($triggers) && ! empty($triggers['requires_vetted_interaction'])) {
                $tenantIds[(int) $row->tenant_id] = true;
            }
        }

        $affected = [];
        $unreachable = [];
        foreach (array_keys($tenantIds) as $tenantId) {
            $policy = $jurisdictions->getPolicyUncached($tenantId);
            if (! SafeguardingJurisdictionService::isContactGateUsable($policy)) {
                $affected[] = [
                    'tenant_id' => $tenantId,
                    'jurisdiction' => $policy['jurisdiction'],
                    'configured' => (bool) $policy['configured'],
                ];
            } elseif ($attestations->stats($tenantId)['confirmed'] === 0) {
                // The gate works, but nobody can pass it: the community has
                // recorded no vetting at all, so these members can be reached by
                // no one. That was tenant 2 on 25 Oct 2026, unnoticed, because
                // a usable policy is all the check above asks for.
                $unreachable[] = ['tenant_id' => $tenantId, 'jurisdiction' => $policy['jurisdiction']];
            }
        }

        if ($unreachable !== []) {
            $this->reportUnreachable($unreachable);
        }

        // The fix is the community's to make, so its own staff are told too —
        // not only the platform's error tracker (26 Oct 2026). Once a week per
        // community and problem, so a daily check does not become daily noise.
        foreach ($affected as $row) {
            $this->tellCommunityStaff((int) $row['tenant_id'], 'unusable');
        }
        foreach ($unreachable as $row) {
            $this->tellCommunityStaff((int) $row['tenant_id'], 'unreachable');
        }

        if ($affected === [] && $unreachable !== []) {
            return self::FAILURE;
        }

        if ($affected === []) {
            $this->info(sprintf(
                'Safeguarding policy health OK: %d tenant(s) with live vetted-interaction selections, all with a usable policy.',
                count($tenantIds),
            ));

            return self::SUCCESS;
        }

        // The message is deliberately STABLE — no counts, no tenant ids, no
        // ages — because Sentry groups the capture below by its message text.
        // Everything volatile goes in the context (see the identical rule in
        // OverdueGdprRequestCheck).
        $message = 'Safeguarding contact gate unusable for tenants with live vetted-interaction selections';
        $context = [
            'affected_tenants' => $affected,
            'affected_count' => count($affected),
            'fix' => 'Configure the safeguarding jurisdiction in the broker panel (Vetting -> Jurisdiction) for each tenant.',
        ];

        // Local log ONLY — the explicit capture below is the single Sentry
        // event. Logging through the default stack would ALSO reach Sentry (the
        // `sentry` channel is in production's LOG_STACK) as a second,
        // unfingerprinted group. See OperatorLog.
        OperatorLog::withoutSentry()->error($message, $context);

        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'safeguarding_policy_health');
                    $scope->setFingerprint(['safeguarding_policy_health_unusable']);
                    $scope->setContext('safeguarding_policy_health', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('safeguarding:check-policy-health Sentry capture failed: ' . $e->getMessage());
        }

        foreach ($affected as $row) {
            $this->error(sprintf(
                'Tenant %d: live vetted-interaction selections but jurisdiction "%s" cannot operate the contact gate.',
                $row['tenant_id'],
                $row['jurisdiction'],
            ));
        }

        return self::FAILURE;
    }

    /**
     * Bell, push and email to the community's brokers, coordinators and admins,
     * each in their own language. Never fails the check.
     */
    private function tellCommunityStaff(int $tenantId, string $problem): void
    {
        $onceKey = 'safeguarding_policy_health:told:' . $tenantId . ':' . $problem;
        if (! Cache::add($onceKey, 1, now()->addDays(7))) {
            return;
        }

        $previousTenantId = TenantContext::currentId();
        try {
            TenantContext::setById($tenantId);
            NotificationDispatcher::notifyModerationAdmins(
                'safeguarding_policy_health',
                '/broker/vetting',
                'svc_notifications_2.safeguarding_health.' . $problem . '_alert',
                'emails_misc.moderation.safeguarding_health_' . $problem . '_subject',
                'emails_misc.moderation.safeguarding_health_' . $problem . '_body',
                [],
                'danger',
            );
        } catch (\Throwable $e) {
            Cache::forget($onceKey);
            Log::warning('safeguarding:check-policy-health staff alert failed', ['tenant_id' => $tenantId, 'error' => $e->getMessage()]);
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            }
        }
    }

    /** @param list<array{tenant_id: int, jurisdiction: string}> $unreachable */
    private function reportUnreachable(array $unreachable): void
    {
        $message = 'Members require vetted contact in communities that have recorded no vetting';
        $context = [
            'affected_tenants' => $unreachable,
            'affected_count' => count($unreachable),
            'fix' => 'Record vetting for members in the broker panel (Vetting), or ask the affected members to switch to coordinator introductions in their safeguarding settings.',
        ];

        OperatorLog::withoutSentry()->error($message, $context);

        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'safeguarding_policy_health');
                    $scope->setFingerprint(['safeguarding_vetted_contact_unreachable']);
                    $scope->setContext('safeguarding_policy_health', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('safeguarding:check-policy-health Sentry capture failed: ' . $e->getMessage());
        }

        foreach ($unreachable as $row) {
            $this->error(sprintf(
                'Tenant %d: members require vetted contact but no vetting is recorded, so nobody can reach them.',
                $row['tenant_id'],
            ));
        }
    }
}
