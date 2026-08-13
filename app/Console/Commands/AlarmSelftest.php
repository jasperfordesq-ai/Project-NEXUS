<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Alarm self-test heartbeat — the watcher-of-the-watcher.
 *
 * NEXUS already has three breach alarms (SloCheck, StuckStripeWebhookCheck,
 * OverdueGdprRequestCheck) that fan out log → Sentry → Slack. But those only
 * fire WHEN something is wrong. If the delivery path itself silently breaks
 * (DSN rotated, Slack webhook revoked, the `sentry` log channel dropped from
 * LOG_STACK), the alarms would go quiet and nobody would know — the most
 * dangerous failure mode for an unattended real-money system, because silence
 * reads as "all healthy".
 *
 * This command fires a benign weekly HEARTBEAT through the SAME three legs an
 * alarm would use. The operator's expectation is inverted: you should receive
 * this heartbeat every week. If it ever stops arriving (in Sentry or Slack),
 * the alarm delivery path is broken — which is the signal you could never get
 * from the alarms themselves. It is NOT an alarm: it always exits 0 and is
 * tagged `selftest=heartbeat` so it never pollutes the real-error dashboard.
 *
 * Scheduled weekly via bootstrap/app.php. Each leg is guarded and non-fatal,
 * degrading to log-only when Sentry/Slack are unconfigured — and the console
 * output reports exactly which legs were attempted, so an owner running it by
 * hand can see at a glance whether delivery is wired.
 *
 * Modelled on SloCheck::raiseAlert (log → Sentry → Slack, each leg guarded).
 */
class AlarmSelftest extends Command
{
    protected $signature = 'monitoring:alarm-selftest
                            {--quiet-slack : Skip the Slack leg (log + Sentry only)}';

    protected $description = 'Fire a heartbeat through the alarm delivery legs (log/Sentry/Slack) so silent delivery failure is itself detectable';

    public function handle(): int
    {
        $stamp = Carbon::now()->toIso8601String();
        $release = (string) (config('app.build_commit') ?: 'unknown');
        $host = (string) (gethostname() ?: 'unknown');

        $message = sprintf(
            'NEXUS alarm-selftest heartbeat — alarm delivery is wired (release %s, host %s, %s). '
            . 'If this stops arriving weekly, the Sentry/Slack alarm path is broken.',
            $release,
            $host,
            $stamp
        );

        $context = [
            'selftest' => 'heartbeat',
            'release' => $release,
            'host' => $host,
            'emitted_at' => $stamp,
        ];

        $legs = $this->emitHeartbeat($message, $context, ! $this->option('quiet-slack'));

        $this->info(sprintf(
            'Alarm self-test heartbeat emitted — legs: log=%s, sentry=%s, slack=%s.',
            $legs['log'],
            $legs['sentry'],
            $legs['slack']
        ));

        // A heartbeat is never an alarm — it must always succeed so the scheduler
        // does not treat a healthy delivery path as a failure.
        return self::SUCCESS;
    }

    /**
     * Fan the heartbeat out to log + Sentry + Slack, mirroring the breach-alarm
     * helper but at heartbeat severity. Each leg is guarded and non-fatal; the
     * return value reports the per-leg outcome for console visibility.
     *
     * @param array<string,mixed> $context
     * @return array{log:string,sentry:string,slack:string}
     */
    private function emitHeartbeat(string $message, array $context, bool $slackEnabled): array
    {
        $result = ['log' => 'ok', 'sentry' => 'skipped', 'slack' => 'skipped'];

        // 1. Always: an INFO log so the heartbeat is visible in local/aggregated
        //    logs. (Below the default warning threshold in prod LOG_LEVEL, which
        //    is fine — Sentry/Slack are the channels that prove remote delivery.)
        Log::info($message, $context);

        // 2. Sentry — visible regardless of LOG_STACK. Captured at INFO with an
        //    explicit selftest tag so it is filterable and never trips an error
        //    alert rule.
        if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
            try {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('selftest', 'heartbeat');
                    // 🔴 Stable across runs, and it matters MORE here than for
                    // the error alarms. This heartbeat's whole purpose is that
                    // its ABSENCE is the signal — but the message embeds the
                    // release, host and timestamp, so each weekly beat opened
                    // its own Sentry issue with a single event. There was no
                    // series to notice a gap in. One fingerprint makes it one
                    // issue whose event timeline is the thing you read.
                    $scope->setFingerprint(['alarm_selftest_heartbeat']);
                    $scope->setContext('alarm_selftest', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::info());
                $result['sentry'] = 'sent';
            } catch (\Throwable $e) {
                $result['sentry'] = 'error';
                Log::warning('monitoring:alarm-selftest Sentry capture failed: ' . $e->getMessage());
            }
        }

        // 3. Slack (when configured) — reuses the ops/SLO webhook.
        if ($slackEnabled) {
            $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
            if ($webhook === '') {
                $this->warn('SLACK_SLO_ALERTS_WEBHOOK not configured — heartbeat logged/Sentry only, no Slack push.');
            } else {
                try {
                    $resp = Http::timeout(10)->post($webhook, [
                        'text' => ":heartbeat: *Project NEXUS — alarm self-test*\n" . $message,
                    ]);
                    if ($resp->successful()) {
                        $result['slack'] = 'sent';
                    } else {
                        $result['slack'] = 'error';
                        Log::warning('monitoring:alarm-selftest Slack post failed', ['status' => $resp->status()]);
                    }
                } catch (\Throwable $e) {
                    $result['slack'] = 'error';
                    Log::warning('monitoring:alarm-selftest Slack exception', ['error' => $e->getMessage()]);
                }
            }
        }

        return $result;
    }
}
