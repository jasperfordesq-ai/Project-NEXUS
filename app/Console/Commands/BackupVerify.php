<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Console\Commands;

use App\Support\Sentry\OperatorLog;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Backup dead-man's switch.
 *
 * scripts/server-nightly-backup.sh dumps the DB nightly to
 * backups/nexus_db_YYYY-MM-DD.sql.gz, but it only writes to a local log — if
 * the cron is uninstalled, the container can't reach the DB, or the disk fills,
 * the backups silently stop and nobody finds out until a restore is needed and
 * there is nothing to restore. For an unattended real-money system, "the backup
 * stopped" must be DETECTED, not discovered during an incident.
 *
 * This command inspects the newest nexus_db_*.sql.gz and ALARMS (log -> Sentry
 * -> Slack + non-zero exit) when it is missing, zero-byte, or older than the
 * threshold (~26h, giving the nightly run + retries headroom). It does NOT take
 * a backup — it only verifies one exists and is fresh.
 *
 * Scheduled daily via bootstrap/app.php. Modelled on StuckStripeWebhookCheck /
 * SloCheck: each alert leg is guarded and non-fatal, degrading to log-only when
 * Sentry/Slack are unconfigured.
 *
 * The backup directory is resolved from --dir, then BACKUP_VERIFY_DIR, then
 * base_path('backups'). On production the nightly script writes to
 * /opt/nexus-php/backups — the scheduler container must be able to read that
 * path (volume mount) or BACKUP_VERIFY_DIR must point at the mounted location.
 * See docs/RUNBOOK-INCIDENTS.md for backup incident handling.
 */
class BackupVerify extends Command
{
    protected $signature = 'backup:verify
                            {--dir= : Directory holding nexus_db_*.sql.gz dumps (default: BACKUP_VERIFY_DIR or base_path("backups"))}
                            {--max-age-hours=26 : Alarm if the newest DB backup is older than this many hours}
                            {--glob=nexus_db_*.sql.gz : Filename pattern for the DB dumps}';

    protected $description = 'Verify a recent, non-empty database backup exists and alarm (log/Sentry/Slack) if not';

    public function handle(): int
    {
        $dir = (string) ($this->option('dir') ?: config('app.backup_verify_dir') ?: base_path('backups'));
        $dir = rtrim($dir, '/\\');
        $maxAgeHours = max(1, (int) $this->option('max-age-hours'));
        $pattern = (string) $this->option('glob');

        if (! is_dir($dir)) {
            return $this->alarm(
                sprintf('BACKUP ALARM: backup directory "%s" does not exist — no database backups are being written.', $dir),
                ['dir' => $dir, 'reason' => 'dir_missing']
            );
        }

        $matches = glob($dir . DIRECTORY_SEPARATOR . $pattern) ?: [];
        if ($matches === []) {
            return $this->alarm(
                sprintf('BACKUP ALARM: no database backup matching "%s" found in %s — the nightly backup is not running.', $pattern, $dir),
                ['dir' => $dir, 'glob' => $pattern, 'reason' => 'no_backup']
            );
        }

        // Newest by modification time — that is the freshness signal, not the
        // date in the filename (a stale file could be re-touched, but mtime is
        // what the nightly write actually advances).
        $newest = null;
        $newestMtime = -1;
        foreach ($matches as $file) {
            $mtime = @filemtime($file);
            if ($mtime !== false && $mtime > $newestMtime) {
                $newestMtime = $mtime;
                $newest = $file;
            }
        }

        if ($newest === null) {
            return $this->alarm(
                sprintf('BACKUP ALARM: found backup files in %s but none were readable (filemtime failed).', $dir),
                ['dir' => $dir, 'reason' => 'unreadable']
            );
        }

        $size = (int) (@filesize($newest) ?: 0);
        $name = basename($newest);

        if ($size === 0) {
            return $this->alarm(
                sprintf('BACKUP ALARM: newest database backup %s is zero bytes — the dump failed or was truncated.', $name),
                ['dir' => $dir, 'file' => $name, 'size' => 0, 'reason' => 'empty']
            );
        }

        $ageHours = (Carbon::now()->getTimestamp() - $newestMtime) / 3600;
        if ($ageHours > $maxAgeHours) {
            return $this->alarm(
                sprintf(
                    'BACKUP ALARM: newest database backup %s is %.1fh old (> %dh threshold) — the nightly backup has stopped running.',
                    $name,
                    $ageHours,
                    $maxAgeHours
                ),
                ['dir' => $dir, 'file' => $name, 'age_hours' => round($ageHours, 1), 'max_age_hours' => $maxAgeHours, 'reason' => 'stale']
            );
        }

        $this->info(sprintf(
            'Backup healthy: %s is %.1fh old and %s (<= %dh threshold).',
            $name,
            $ageHours,
            $this->humanSize($size),
            $maxAgeHours
        ));
        Log::info('backup:verify healthy', [
            'dir' => $dir,
            'file' => $name,
            'size' => $size,
            'age_hours' => round($ageHours, 1),
        ]);

        return self::SUCCESS;
    }

    /**
     * Emit the alarm to console + log + Sentry + Slack and return FAILURE.
     * Each remote leg is guarded and non-fatal — an alert-channel failure must
     * never mask the missing backup itself.
     *
     * @param array<string,mixed> $context
     */
    private function alarm(string $message, array $context): int
    {
        $this->error($message);
        $this->raiseAlert($message, $context);

        return self::FAILURE;
    }

    /**
     * @param array<string,mixed> $context
     */
    private function raiseAlert(string $message, array $context): void
    {
        // 1. Always: ERROR log — STABLE message string, mirroring the single
        // fingerprint below (one issue for missing/zero-byte/stale alike).
        // The `sentry` log channel groups by raw message text, and $message
        // embeds filenames and ages that change per run — the defect that
        // minted a new GDPR issue nightly. Volatile detail travels in the
        // context.
        // Local log ONLY — the explicit capture below is the single Sentry
        // event. The default stack also carries the `sentry` channel in
        // production, which would add a second, unfingerprinted group for the
        // same occurrence. See OperatorLog.
        OperatorLog::withoutSentry()->error(
            'BACKUP ALERT: newest database backup is missing, empty, or stale',
            $context + ['message' => $message],
        );

        // 2. Explicit Sentry capture — visible regardless of LOG_STACK.
        try {
            if (function_exists('Sentry\\captureMessage') && config('sentry.dsn')) {
                \Sentry\configureScope(function (\Sentry\State\Scope $scope) use ($context): void {
                    $scope->setTag('alert', 'backup_missing_or_stale');
                    // Stable across runs — see the note in
                    // OverdueGdprRequestCheck. The message names the newest
                    // backup file and its age, both of which change nightly.
                    $scope->setFingerprint(['backup_missing_or_stale']);
                    $scope->setContext('backup', $context);
                });
                \Sentry\captureMessage($message, \Sentry\Severity::error());
            }
        } catch (\Throwable $e) {
            Log::debug('backup:verify Sentry capture failed: ' . $e->getMessage());
        }

        // 3. Slack (when configured) — reuses the ops/SLO webhook.
        $webhook = (string) (config('services.slack.slo_alerts_webhook') ?? '');
        if ($webhook === '') {
            $this->warn('SLACK_SLO_ALERTS_WEBHOOK not configured — alert logged only, no Slack push.');
            return;
        }

        try {
            $resp = Http::timeout(10)->post($webhook, [
                'text' => ":rotating_light: *Project NEXUS — backup missing/stale*\n" . $message,
            ]);
            if (! $resp->successful()) {
                Log::warning('backup:verify Slack post failed', ['status' => $resp->status()]);
            }
        } catch (\Throwable $e) {
            Log::warning('backup:verify Slack exception', ['error' => $e->getMessage()]);
        }
    }

    private function humanSize(int $bytes): string
    {
        if ($bytes >= 1073741824) {
            return round($bytes / 1073741824, 2) . 'GB';
        }
        if ($bytes >= 1048576) {
            return round($bytes / 1048576, 2) . 'MB';
        }
        if ($bytes >= 1024) {
            return round($bytes / 1024, 2) . 'KB';
        }

        return $bytes . 'B';
    }
}
