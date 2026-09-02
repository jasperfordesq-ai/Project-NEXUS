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
 * SLO checker / alerter — turns the SLOs documented in docs/SLO.md into a
 * *wired* alert instead of a number nobody watches.
 *
 * PRIMARY SLO (the money path): exchange-completion success rate. Of all
 * exchanges that reached a terminal completion-or-dispute outcome inside the
 * window, what fraction completed without ending in dispute. A dispute is the
 * money-path failure signal (a confirm / credit step that went wrong);
 * `cancelled` and `expired` are user choices, not failures, so they are
 * excluded from the denominator. Below the target → the SLO is BREACHED and we
 * ALERT.
 *
 * "Alert" means, in priority order (cheapest-to-wire first so this works with
 * zero extra setup):
 *   1. ERROR-level application log (always) — visible in the daily/stderr logs
 *      and, if LOG_STACK includes the `sentry` channel, in Sentry too.
 *   2. An explicit Sentry capture (when the SDK + DSN are configured) so the
 *      breach is visible in Sentry regardless of LOG_STACK.
 *   3. Slack (when SLACK_SLO_ALERTS_WEBHOOK is configured).
 * On breach the command also exits non-zero so the scheduler / a cron monitor
 * sees the failure.
 *
 * A secondary, INFORMATIONAL login-success rate is logged for context but does
 * NOT gate the alert: `login_attempts.success` cannot distinguish a
 * wrong-password (user error) from a 5xx (system failure), so the authoritative
 * login SLO lives in Sentry (5xx rate on the login transaction), not here.
 *
 * Scheduled daily via bootstrap/app.php. Safe to schedule before any webhook
 * exists — it degrades to log-only. Pass --tenant=<id> to scope to one tenant
 * (e.g. for a per-community SLO); the default is a platform-wide ops aggregate
 * (intentionally cross-tenant — this is operator-facing health, never exposed
 * to any tenant).
 */
class SloCheck extends Command
{
    protected $signature = 'slo:check
                            {--days=28 : Rolling measurement window in days}
                            {--target=99.5 : Exchange-completion success target (percent) below which the SLO is breached}
                            {--min-sample=20 : Minimum terminal exchanges in the window before a breach can fire (avoids low-volume noise)}
                            {--tenant= : Scope to a single tenant id (default: platform-wide aggregate)}';

    protected $description = 'Evaluate the exchange-completion SLO and alert (log/Sentry/Slack) when breached';

    public function handle(): int
    {
        $days = max(1, (int) $this->option('days'));
        $target = (float) $this->option('target');
        $minSample = max(1, (int) $this->option('min-sample'));
        $tenantId = $this->option('tenant') !== null ? (int) $this->option('tenant') : null;
        $cutoff = Carbon::now()->subDays($days);

        if (! Schema::hasTable('exchange_requests')) {
            $this->warn('exchange_requests table absent — cannot evaluate the exchange SLO.');
            return self::SUCCESS;
        }

        $completed = $this->countExchanges('completed', 'completed_at', $cutoff, $tenantId);
        $disputed = $this->countExchanges('disputed', 'updated_at', $cutoff, $tenantId);
        $total = $completed + $disputed;

        $scopeLabel = $tenantId !== null ? "tenant {$tenantId}" : 'platform-wide';
        $loginInfo = $tenantId === null
            ? $this->loginSuccessInfo($cutoff)
            : ['attempts' => 0, 'pct' => null, 'suffix' => ''];

        if ($total < $minSample) {
            $this->info(sprintf(
                'Exchange SLO (%s): insufficient data (%d completed + %d disputed < min-sample %d over %dd) — no alert.%s',
                $scopeLabel, $completed, $disputed, $minSample, $days, $loginInfo['suffix']
            ));
            return self::SUCCESS;
        }

        $successPct = round($completed / $total * 100, 3);
        $context = [
            'scope' => $scopeLabel,
            'tenant_id' => $tenantId,
            'window_days' => $days,
            'completed' => $completed,
            'disputed' => $disputed,
            'total_terminal' => $total,
            'success_pct' => $successPct,
            'target_pct' => $target,
            'login_attempts' => $loginInfo['attempts'],
            'login_success_pct' => $loginInfo['pct'],
        ];

        if ($successPct < $target) {
            $message = sprintf(
                'SLO BREACH: exchange-completion success %.3f%% < target %.3f%% over %dd (%s — %d completed / %d disputed).',
                $successPct, $target, $days, $scopeLabel, $completed, $disputed
            );
            $this->error($message);
            $this->raiseAlert($message, $context);
            return self::FAILURE;
        }

        $this->info(sprintf(
            'Exchange SLO OK (%s): %.3f%% >= %.3f%% over %dd (%d completed / %d disputed).%s',
            $scopeLabel, $successPct, $target, $days, $completed, $disputed, $loginInfo['suffix']
        ));
        Log::info('slo:check healthy', $context);
        return self::SUCCESS;
    }

    private function countExchanges(string $status, string $tsColumn, Carbon $cutoff, ?int $tenantId): int
    {
        $q = DB::table('exchange_requests')
            ->where('status', $status)
            ->where($tsColumn, '>=', $cutoff);
        if ($tenantId !== null) {
            $q->where('tenant_id', $tenantId);
        }
        return (int) $q->count();
    }

    /**
     * Fan a breach out to log + Sentry + Slack. Each leg is guarded and
     * non-fatal — an alert-channel failure must never mask the breach itself.
     *
     * @param array<string,mixed> $context
     */
    private function raiseAlert(string $message, array $context): void
    {
        // 1. Always: ERROR log (operators + log aggregation) — STABLE message
        // string. The `sentry` log channel in the production LOG_STACK groups
        // by raw message text, and the fingerprint below covers only the
        // explicit capture. $message carries percentages to three decimal
        // places, so consecutive breaches would mint a new Sentry issue per
        // run through this leg (the OverdueGdprRequestCheck defect). Volatile
        // detail travels in the context.
        // Local log ONLY — the explicit capture below is the single Sentry
        // event. See OperatorLog.
        OperatorLog::withoutSentry()->error(
            'SLO BREACH: exchange-completion success rate below target',
            $context + ['message' => $message],
        );

        // 2. Explicit Sentry capture — visible regardless of LOG_STACK.
        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('slo', 'exchange_completion');
                    if (! empty($context['tenant_id'])) {
                        $scope->setTag('tenant_id', (string) $context['tenant_id']);
                    }
                    // Stable across runs — see the note in
                    // OverdueGdprRequestCheck. The message carries percentages
                    // to three decimal places, so consecutive breaches of the
                    // SAME SLO would otherwise never group. Kept per tenant:
                    // one community breaching is a different operational fact
                    // from another one breaching, and the platform-wide run
                    // (no tenant) is a third.
                    $scope->setFingerprint([
                        'slo_breach',
                        'exchange_completion',
                        empty($context['tenant_id']) ? 'platform' : (string) $context['tenant_id'],
                    ]);
                    $scope->setContext('slo', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('slo:check Sentry capture failed: ' . $e->getMessage());
        }

        // 3. Slack (when configured).
        $this->pushToSlack($message, $context);
    }

    /**
     * @param array<string,mixed> $context
     */
    private function pushToSlack(string $message, array $context): void
    {
        $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
        if ($webhook === '') {
            $this->warn('SLACK_SLO_ALERTS_WEBHOOK not configured — breach logged only, no Slack push.');
            return;
        }

        $login = $context['login_success_pct'] === null ? 'n/a' : ((string) $context['login_success_pct'] . '%');
        $text = ":rotating_light: *Project NEXUS SLO breach*\n" . $message
            . sprintf(
                "\nWindow %dd · completed %d · disputed %d · login success %s (%d attempts, informational)",
                (int) $context['window_days'],
                (int) $context['completed'],
                (int) $context['disputed'],
                $login,
                (int) $context['login_attempts']
            );

        try {
            $resp = Http::timeout(10)->post($webhook, ['text' => $text]);
            if (! $resp->successful()) {
                Log::warning('slo:check Slack post failed', ['status' => $resp->status()]);
            }
        } catch (\Throwable $e) {
            Log::warning('slo:check Slack exception', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Coarse, INFORMATIONAL login-success rate (NOT gating). Skipped cleanly
     * when the table is absent or the window is empty.
     *
     * @return array{attempts:int,pct:float|null,suffix:string}
     */
    private function loginSuccessInfo(Carbon $cutoff): array
    {
        if (! Schema::hasTable('login_attempts')) {
            return ['attempts' => 0, 'pct' => null, 'suffix' => ''];
        }

        $attempts = (int) DB::table('login_attempts')->where('attempted_at', '>=', $cutoff)->count();
        if ($attempts === 0) {
            return ['attempts' => 0, 'pct' => null, 'suffix' => ''];
        }

        $ok = (int) DB::table('login_attempts')
            ->where('attempted_at', '>=', $cutoff)
            ->where('success', 1)
            ->count();
        $pct = round($ok / $attempts * 100, 3);

        return [
            'attempts' => $attempts,
            'pct' => $pct,
            'suffix' => sprintf(' Login success (coarse, incl. user error): %.3f%% of %d attempts.', $pct, $attempts),
        ];
    }
}
