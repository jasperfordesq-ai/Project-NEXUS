<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Services\EmailMonitorService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;

/**
 * Proactive email-deliverability pager.
 *
 * The platform already DETECTS delivery problems via
 * EmailMonitorService::getWarnings() (recent failures, critical-category
 * failures, queue stalls, and — crucially — new signups with no activation
 * email logged). Until now those warnings only surfaced if someone opened the
 * admin "Email Deliverability" dashboard, so the operator learned about
 * outages from user complaints instead of from the system.
 *
 * This command runs those same checks (globally + for tenants with recent
 * activity) and PUSHES any critical/warning issue to Slack, turning the
 * passive dashboard into an active alert. Scheduled hourly via
 * bootstrap/app.php. Identical issue sets are de-duplicated within a rolling
 * window so a persistent problem pages once, not every hour; a newly-appearing
 * problem type pages immediately.
 *
 * Slack is configured via SLACK_EMAIL_ALERTS_WEBHOOK. When unset the command
 * still logs and prints a summary, so it is safe to schedule before the
 * webhook exists. Email is intentionally NOT an alert channel — email
 * deliverability is the very thing being watched.
 */
class EmailHealthAlert extends Command
{
    protected $signature = 'email:health-alert
                            {--force : Push to Slack even if an identical issue set was alerted recently}
                            {--dedupe-ttl=21600 : Seconds to suppress re-alerting an identical issue set (default 6h)}';

    protected $description = 'Run email-deliverability health checks and push critical/warning issues to Slack';

    private const CACHE_KEY = 'email_health_alert:last_signature';

    public function handle(EmailMonitorService $monitor): int
    {
        $issues = $this->collectIssues($monitor);

        if ($issues === []) {
            $this->info('Email health OK — no critical/warning issues.');
            return self::SUCCESS;
        }

        $this->renderConsole($issues);

        $signature = md5((string) json_encode($this->signaturePayload($issues)));
        $force = (bool) $this->option('force');
        $ttl = max(60, (int) $this->option('dedupe-ttl'));

        if (!$force && Cache::get(self::CACHE_KEY) === $signature) {
            $this->line('Identical issue set already alerted within the dedupe window — skipping Slack push.');
            Log::info('email:health-alert deduped', ['issue_count' => count($issues)]);
            return self::SUCCESS;
        }

        $sent = $this->pushToSlack($issues);

        // Always record the alert in the application log, Slack or not.
        Log::warning('Email health alert raised', [
            'issue_count' => count($issues),
            'slack_sent'  => $sent,
            'issues'      => $issues,
        ]);

        if ($sent) {
            try {
                Cache::put(self::CACHE_KEY, $signature, $ttl);
            } catch (\Throwable $e) {
                // Cache write failure must not fail the command.
            }
        }

        return self::SUCCESS;
    }

    /**
     * Collect critical/warning issues platform-wide and for each tenant that
     * had email activity or a new signup in the last 24h (bounds the per-tenant
     * loop so the hourly run stays cheap).
     *
     * @return list<array{scope:string,severity:string,code:string,params:array<string,mixed>}>
     */
    private function collectIssues(EmailMonitorService $monitor): array
    {
        $issues = [];

        foreach ($monitor->getWarnings(null) as $warning) {
            if (($warning['severity'] ?? 'info') === 'info') {
                continue;
            }
            $issues[] = $this->normalize('global', $warning);
        }

        foreach ($this->recentlyActiveTenantIds() as $tenantId) {
            foreach ($monitor->getWarnings($tenantId) as $warning) {
                if (($warning['severity'] ?? 'info') === 'info') {
                    continue;
                }
                $issues[] = $this->normalize("tenant:{$tenantId}", $warning);
            }
        }

        return $issues;
    }

    /**
     * Tenants worth checking individually: any with a signup or a logged email
     * in the last 24h. Deliverability problems can only surface where there is
     * recent activity, so this keeps the loop tiny on a normal day.
     *
     * @return list<int>
     */
    private function recentlyActiveTenantIds(): array
    {
        $ids = [];
        try {
            if (Schema::hasTable('users')) {
                $ids = array_merge($ids, DB::table('users')
                    ->where('created_at', '>=', now()->subDay())
                    ->whereNotNull('tenant_id')
                    ->distinct()
                    ->pluck('tenant_id')
                    ->all());
            }
            if (Schema::hasTable('email_log')) {
                $ids = array_merge($ids, DB::table('email_log')
                    ->where('created_at', '>=', now()->subDay())
                    ->whereNotNull('tenant_id')
                    ->distinct()
                    ->pluck('tenant_id')
                    ->all());
            }
        } catch (\Throwable $e) {
            Log::debug('email:health-alert recentlyActiveTenantIds failed: ' . $e->getMessage());
        }

        $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
        return array_slice($ids, 0, 200);
    }

    /**
     * @param array<string,mixed> $warning
     * @return array{scope:string,severity:string,code:string,params:array<string,mixed>}
     */
    private function normalize(string $scope, array $warning): array
    {
        return [
            'scope'    => $scope,
            'severity' => (string) ($warning['severity'] ?? 'warning'),
            'code'     => (string) ($warning['code'] ?? 'unknown'),
            'params'   => (array) ($warning['params'] ?? []),
        ];
    }

    /**
     * Dedupe signature: based on the SET of (scope, severity, code) — not the
     * numeric params — so a persistent problem pages once per window while a
     * brand-new problem type pages right away.
     *
     * @param list<array{scope:string,severity:string,code:string,params:array<string,mixed>}> $issues
     * @return list<string>
     */
    private function signaturePayload(array $issues): array
    {
        $sig = array_map(
            static fn (array $i): string => $i['scope'] . '|' . $i['severity'] . '|' . $i['code'],
            $issues
        );
        sort($sig);
        return array_values(array_unique($sig));
    }

    /**
     * @param list<array{scope:string,severity:string,code:string,params:array<string,mixed>}> $issues
     */
    private function renderConsole(array $issues): void
    {
        foreach ($issues as $i) {
            $line = strtoupper($i['severity']) . "  [{$i['scope']}]  {$i['code']}  — " . $this->describe($i['code'], $i['params']);
            if ($i['severity'] === 'critical') {
                $this->error($line);
            } else {
                $this->warn($line);
            }
        }
    }

    /**
     * @param list<array{scope:string,severity:string,code:string,params:array<string,mixed>}> $issues
     */
    private function pushToSlack(array $issues): bool
    {
        $webhook = (string) (config('services.slack.email_alerts_webhook') ?? '');
        if ($webhook === '') {
            $this->warn('SLACK_EMAIL_ALERTS_WEBHOOK not configured — logged only, no Slack push.');
            return false;
        }

        $criticalCount = count(array_filter($issues, static fn (array $i): bool => $i['severity'] === 'critical'));
        $warningCount = count($issues) - $criticalCount;

        $header = ($criticalCount > 0 ? ':rotating_light: ' : ':warning: ')
            . "*Project NEXUS email health* — {$criticalCount} critical, {$warningCount} warning";

        $lines = [];
        foreach ($issues as $i) {
            $emoji = $i['severity'] === 'critical' ? ':red_circle:' : ':large_orange_diamond:';
            $lines[] = "{$emoji} *" . strtoupper($i['severity']) . "* `{$i['code']}` ({$i['scope']}) — " . $this->describe($i['code'], $i['params']);
        }

        $base = rtrim((string) (config('services.slack.dashboard_url') ?? 'https://app.project-nexus.ie'), '/');
        $dashboard = "\n<{$base}/admin/email-deliverability|Open the Email Deliverability dashboard>";

        $text = $header . "\n" . implode("\n", $lines) . $dashboard;

        try {
            $response = Http::timeout(10)->post($webhook, ['text' => $text]);
            if ($response->successful()) {
                $this->info('Slack alert sent.');
                return true;
            }
            $this->error('Slack webhook returned HTTP ' . $response->status());
            Log::warning('email:health-alert Slack post failed', ['status' => $response->status()]);
            return false;
        } catch (\Throwable $e) {
            $this->error('Slack push error: ' . $e->getMessage());
            Log::warning('email:health-alert Slack exception', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Human-readable, operator-facing description for a warning code. These are
     * internal ops alerts (not end-user UI), so they are deliberately English.
     *
     * @param array<string,mixed> $params
     */
    private function describe(string $code, array $params): string
    {
        $p = static fn (string $k, mixed $default = ''): mixed => $params[$k] ?? $default;

        return match ($code) {
            'new_users_without_activation_email_log' =>
                $p('count') . ' new signup(s) in ' . $p('window_hours', 24) . 'h with NO activation email logged — verify the registration→email path',
            'new_users_without_admin_registration_alert' =>
                $p('count') . ' new signup(s) in ' . $p('window_hours', 24) . 'h with NO admin registration alert logged — verify admins are being notified',
            'critical_email_failures' =>
                $p('count') . ' critical-category email(s) failed/suppressed/bounced in ' . $p('window_hours', 24) . 'h (activation, password reset, etc.)',
            'recent_email_failures' =>
                $p('count') . ' failed/bounced send(s) (' . $p('rate') . '% of attempted) in ' . $p('window_hours', 24) . 'h',
            'recent_email_suppressions' =>
                $p('count') . ' send(s) skipped by the suppression list (' . $p('rate') . '% of all mail) in ' . $p('window_hours', 24) . 'h',
            'notification_queue_stale_processing' =>
                $p('count') . ' notification(s) stuck in "processing" for >' . $p('minutes', 15) . 'm — queue worker may be stalled',
            'instant_notifications_stuck_pending' =>
                $p('count') . ' instant notification(s) stuck "pending" for >' . $p('minutes', 5) . 'm — queue worker may be stalled',
            'notification_queue_failures' =>
                $p('count') . ' notification-queue failure(s) in ' . $p('window_hours', 24) . 'h',
            'notification_queue_suppressed' =>
                $p('count') . ' notification(s) suppressed in ' . $p('window_hours', 24) . 'h',
            'newsletter_queue_stale_processing' =>
                $p('count') . ' newsletter(s) stuck in "processing" for >' . $p('minutes', 15) . 'm',
            'newsletter_queue_failures' =>
                $p('count') . ' newsletter-queue failure(s) in ' . $p('window_hours', 24) . 'h',
            'email_log_missing' =>
                'email_log table is missing — email logging is disabled',
            'email_health_unavailable' =>
                'Email health check could not run: ' . $p('error'),
            default => $code . ' ' . (string) json_encode($params),
        };
    }
}
