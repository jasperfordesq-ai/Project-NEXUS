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
 * Stuck-Stripe-webhook alerter (B3 — money failures must be visible).
 *
 * The Stripe webhook handler flips an event row to status='failed' and returns
 * 500 so Stripe retries. But Stripe abandons retries after ~3 days, so a row
 * that stays 'failed' means a payment/refund that was never applied — silent
 * money-state drift that nobody is watching. This turns that DB state into a
 * wired alert (log -> Sentry -> Slack) + a non-zero exit, scheduled daily.
 *
 * Modelled on SloCheck: each alert leg is guarded and non-fatal so a broken
 * alert channel can never mask the underlying problem. Degrades to log-only
 * when Sentry/Slack are unconfigured.
 */
class StuckStripeWebhookCheck extends Command
{
    protected $signature = 'stripe:check-stuck-webhooks
                            {--hours=6 : Age in hours after which a failed webhook event counts as stuck}
                            {--max=100 : Cap how many rows to surface per run}';

    protected $description = 'Alert (log/Sentry/Slack) on Stripe webhook events stuck in failed status';

    public function handle(): int
    {
        if (! Schema::hasTable('stripe_webhook_events')) {
            $this->warn('stripe_webhook_events table absent — nothing to check.');
            return self::SUCCESS;
        }

        $hours = max(1, (int) $this->option('hours'));
        $max = max(1, (int) $this->option('max'));
        $cutoff = Carbon::now()->subHours($hours);

        $stuck = DB::table('stripe_webhook_events')
            ->where('status', 'failed')
            ->where('processed_at', '<', $cutoff)
            ->orderBy('processed_at')
            ->limit($max)
            ->get();

        $count = $stuck->count();

        if ($count === 0) {
            $this->info(sprintf('Stripe webhooks healthy: no failed events older than %dh.', $hours));
            return self::SUCCESS;
        }

        $sample = $stuck->take(10)
            ->map(fn ($r) => $r->event_id . ' (' . $r->event_type . ')')
            ->all();

        $message = sprintf(
            'STRIPE WEBHOOK ALERT: %d webhook event(s) stuck in failed status > %dh. '
            . 'Stripe abandons retries after ~3 days, risking silent money-state drift. Sample: %s',
            $count,
            $hours,
            implode(', ', $sample)
        );

        $this->error($message);
        $this->raiseAlert($message, [
            'count' => $count,
            'threshold_hours' => $hours,
            'cutoff' => $cutoff->toIso8601String(),
            'sample' => $sample,
        ]);

        return self::FAILURE;
    }

    /**
     * Fan a stuck-webhook alert out to log + Sentry + Slack. Each leg is guarded
     * and non-fatal — an alert-channel failure must never mask the problem.
     *
     * @param array<string,mixed> $context
     */
    private function raiseAlert(string $message, array $context): void
    {
        // 1. Always: ERROR log — STABLE message string. The `sentry` log
        // channel in the production LOG_STACK groups by raw message text, and
        // the fingerprint below covers only the explicit capture. A message
        // embedding counts/samples mints a new Sentry issue whenever they
        // change (the exact defect OverdueGdprRequestCheck produced nightly,
        // sixteen times over). Volatile detail travels in the context.
        // Local log ONLY — the explicit capture below is the single Sentry
        // event. See OperatorLog.
        OperatorLog::withoutSentry()->error(
            'STRIPE WEBHOOK ALERT: webhook events stuck in failed status',
            $context + ['message' => $message],
        );

        // 2. Explicit Sentry capture — visible regardless of LOG_STACK.
        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'stripe_webhook_stuck');
                    // Stable across runs — see the note in
                    // OverdueGdprRequestCheck. The message carries a count and
                    // an age, so without this each nightly run opens a new
                    // Sentry issue instead of adding an event to this one.
                    $scope->setFingerprint(['stripe_webhook_stuck']);
                    $scope->setContext('stripe_webhooks', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('stripe:check-stuck-webhooks Sentry capture failed: ' . $e->getMessage());
        }

        // 3. Slack (when configured) — reuses the ops/SLO webhook.
        $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
        if ($webhook === '') {
            $this->warn('SLACK_SLO_ALERTS_WEBHOOK not configured — alert logged only, no Slack push.');
            return;
        }

        try {
            $resp = Http::timeout(10)->post($webhook, [
                'text' => ":rotating_light: *Project NEXUS — Stripe webhooks stuck*\n" . $message,
            ]);
            if (! $resp->successful()) {
                Log::warning('stripe:check-stuck-webhooks Slack post failed', ['status' => $resp->status()]);
            }
        } catch (\Throwable $e) {
            Log::warning('stripe:check-stuck-webhooks Slack exception', ['error' => $e->getMessage()]);
        }
    }
}
