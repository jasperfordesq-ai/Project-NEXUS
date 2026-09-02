<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Support\Sentry\OperatorLog;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Overdue-GDPR-request alerter (compliance failures must be visible).
 *
 * GDPR Art.12(3) requires a controller to respond to a data-subject request
 * (access / erasure / rectification / restriction / portability / objection)
 * within one month. NEXUS creates each request as a `pending` row in
 * gdpr_requests that an admin then actions manually — there is NO automated
 * processor, only an admin badge count. So a request nobody opens just rots:
 * a production read on 2026-06-21 found 8 pending requests, four of them ~3.5
 * months old (already past the statutory deadline) and one an erasure request.
 * That is a silent compliance breach with no alarm.
 *
 * This turns that DB state into a wired alert (log -> Sentry -> Slack) + a
 * non-zero exit, scheduled daily. It is platform-wide (cross-tenant) on
 * purpose — it is an operator alarm, not a tenant-scoped user query. It does
 * NOT process or modify any request (fulfilling a DSAR is a human/legal
 * decision); it only makes the backlog visible early enough to act.
 *
 * Modelled on StuckStripeWebhookCheck / SloCheck: each alert leg is guarded
 * and non-fatal, degrading to log-only when Sentry/Slack are unconfigured.
 */
class OverdueGdprRequestCheck extends Command
{
    /** GDPR Art.12(3) statutory response deadline, in days. */
    private const STATUTORY_DEADLINE_DAYS = 30;

    protected $signature = 'gdpr:check-overdue-requests
                            {--days=25 : Age in days after which an open request counts as overdue (warn before the 30-day deadline)}
                            {--max=100 : Cap how many rows to surface per run}';

    protected $description = 'Alert (log/Sentry/Slack) on GDPR data-subject requests pending past the response deadline';

    public function handle(): int
    {
        if (! Schema::hasTable('gdpr_requests')) {
            $this->warn('gdpr_requests table absent — nothing to check.');
            return self::SUCCESS;
        }

        $days = max(1, (int) $this->option('days'));
        $max = max(1, (int) $this->option('max'));
        $cutoff = Carbon::now()->subDays($days);
        $deadline = Carbon::now()->subDays(self::STATUTORY_DEADLINE_DAYS);

        $overdue = DB::table('gdpr_requests')
            ->whereIn('status', ['pending', 'processing'])
            ->where('requested_at', '<', $cutoff)
            ->orderBy('requested_at')
            ->limit($max)
            ->get(['id', 'tenant_id', 'request_type', 'requested_at']);

        $count = $overdue->count();

        if ($count === 0) {
            $this->info(sprintf('GDPR requests healthy: none pending past %d days.', $days));
            return self::SUCCESS;
        }

        // How many have already blown the 1-month statutory deadline (accurate
        // regardless of the --max sample cap).
        $pastDeadline = (int) DB::table('gdpr_requests')
            ->whereIn('status', ['pending', 'processing'])
            ->where('requested_at', '<', $deadline)
            ->count();

        $sample = $overdue->take(10)
            ->map(function ($r): string {
                $ageDays = (int) Carbon::parse($r->requested_at)->diffInDays(Carbon::now());
                return sprintf('#%d t%s %s %dd', $r->id, $r->tenant_id, $r->request_type, $ageDays);
            })
            ->all();

        $message = sprintf(
            'GDPR ALERT: %d data-subject request(s) pending past %d days '
            . '(GDPR Art.12(3) requires a response within 1 month). %d already exceed the %d-day '
            . 'statutory deadline. These need manual action in the admin GDPR queue — there is no '
            . 'automated processor. Sample: %s',
            $count,
            $days,
            $pastDeadline,
            self::STATUTORY_DEADLINE_DAYS,
            implode(', ', $sample)
        );

        $this->error($message);
        $this->raiseAlert($message, [
            'count' => $count,
            'past_statutory_deadline' => $pastDeadline,
            'threshold_days' => $days,
            'cutoff' => $cutoff->toIso8601String(),
            'sample' => $sample,
        ]);

        return self::FAILURE;
    }

    /**
     * Fan an overdue-GDPR alert out to log + Sentry + Slack. Each leg is guarded
     * and non-fatal — an alert-channel failure must never mask the problem.
     *
     * @param array<string,mixed> $context
     */
    private function raiseAlert(string $message, array $context): void
    {
        // 1. Always: ERROR log, LOCAL ONLY, with a STABLE message string.
        //
        // Two separate defects were fixed here, in this order:
        //
        // (a) The message string. It used to embed each request's age in days,
        //     which increments nightly, so this line minted a brand-new Sentry
        //     issue every night — sixteen duplicates (140426477…143159289)
        //     accumulated between 2026-08-13 and 2026-08-28 while the explicit
        //     capture was already fingerprinted. The full human sentence now
        //     travels in the context, where Sentry shows it without grouping
        //     on it.
        //
        // (b) The channel. Even with a stable string this line still reached
        //     Sentry on its own, because production's LOG_STACK contains the
        //     `sentry` channel and a log line cannot carry a fingerprint. So
        //     one occurrence produced TWO groups: this leg and the capture
        //     below. OperatorLog::withoutSentry() logs through the configured
        //     stack minus that channel, leaving the capture as the only Sentry
        //     event while keeping the local log intact.
        OperatorLog::withoutSentry()->error(
            'GDPR ALERT: data-subject requests pending past the response threshold',
            $context + ['message' => $message],
        );

        // 2. Explicit Sentry capture — visible regardless of LOG_STACK.
        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'gdpr_request_overdue');
                    // 🔴 STABLE FINGERPRINT, or this alarm cannot be triaged.
                    //
                    // Sentry groups a captureMessage() by its message text, and
                    // $message embeds each request's AGE IN DAYS ("#123 t2
                    // erasure 87d"). The age increments every night, so every
                    // nightly run reported the same four overdue requests as a
                    // BRAND-NEW issue: six of them accumulated between
                    // 2026-08-08 and 2026-08-13 (Sentry NEXUS-PHP-44/45/46/48/49/4A).
                    //
                    // That is not cosmetic. A new issue each day cannot be
                    // snoozed, shows no "still happening" history, resets its
                    // own priority daily, and pushes real errors down the
                    // unresolved list — an alarm that buries the queue it is
                    // meant to surface. One fingerprint means one issue whose
                    // event count IS the age of the breach.
                    $scope->setFingerprint(['gdpr_request_overdue']);
                    $scope->setContext('gdpr_requests', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('gdpr:check-overdue-requests Sentry capture failed: ' . $e->getMessage());
        }

        // 3. Slack (when configured) — reuses the ops/SLO webhook.
        $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
        if ($webhook === '') {
            $this->warn('SLACK_SLO_ALERTS_WEBHOOK not configured — alert logged only, no Slack push.');
            return;
        }

        try {
            $resp = Http::timeout(10)->post($webhook, [
                'text' => ":rotating_light: *Project NEXUS — GDPR requests overdue*\n" . $message,
            ]);
            if (! $resp->successful()) {
                Log::warning('gdpr:check-overdue-requests Slack post failed', ['status' => $resp->status()]);
            }
        } catch (\Throwable $e) {
            Log::warning('gdpr:check-overdue-requests Slack exception', ['error' => $e->getMessage()]);
        }
    }
}
