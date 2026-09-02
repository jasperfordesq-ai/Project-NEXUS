<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use PHPUnit\Framework\TestCase;

/**
 * 🔴 EVERY OPS ALARM MUST PIN ITS OWN SENTRY GROUPING.
 *
 * Sentry groups a `captureMessage()` by its message TEXT. Every alarm here
 * builds its message with `sprintf()` and interpolates values that move between
 * runs — a count, an age in days, a percentage to three decimal places, a
 * filename, a hostname, a timestamp. So without an explicit fingerprint, the
 * SAME unresolved condition opens a BRAND-NEW Sentry issue on every scheduled
 * run.
 *
 * Measured, not theorised: the overdue-GDPR alarm reported the same four
 * requests as six separate issues between 2026-08-08 and 2026-08-13
 * (NEXUS-PHP-44, -45, -46, -48, -49, -4A). A daily-respawning issue cannot be
 * snoozed, shows no history, resets its priority every night, and pushes real
 * errors off the unresolved list.
 *
 * This is a SOURCE test on purpose. The Sentry leg of each command is guarded by
 * `config('sentry.dsn')`, which is unset in the test environment, so a runtime
 * test would assert on a branch that never executes and pass vacuously.
 */
class AlarmSentryFingerprintTest extends TestCase
{
    private string $root;

    protected function setUp(): void
    {
        parent::setUp();
        $this->root = dirname(__DIR__, 4);
    }

    /**
     * The alarm commands known to push to Sentry, listed explicitly so that
     * DELETING a fingerprint fails here even if the broader sweep below is ever
     * loosened.
     *
     * @return list<string>
     */
    private static function alarmCommands(): array
    {
        return [
            'AlarmSelftest.php',
            'BackupVerify.php',
            'OverdueGdprRequestCheck.php',
            'SafeguardingPolicyHealthCheck.php',
            'SloCheck.php',
            'StuckStripeWebhookCheck.php',
        ];
    }

    public function test_every_alarm_command_sets_a_sentry_fingerprint(): void
    {
        foreach (self::alarmCommands() as $file) {
            $source = (string) file_get_contents($this->root . '/app/Console/Commands/' . $file);

            self::assertStringContainsString(
                'captureMessage',
                $source,
                $file . ' is listed as a Sentry alarm but no longer captures a message — update this test.'
            );
            self::assertStringContainsString(
                '$scope->setFingerprint(',
                $source,
                $file . ' captures a Sentry message built from run-varying values but does not pin its grouping, '
                    . 'so each scheduled run will open a new issue.'
            );
        }
    }

    public function test_no_alarm_command_captures_a_message_without_a_fingerprint(): void
    {
        // Catches a NEW alarm command added later without a fingerprint, which
        // the fixed list above cannot see.
        $missing = [];

        foreach (glob($this->root . '/app/Console/Commands/*.php') ?: [] as $path) {
            $source = (string) file_get_contents($path);
            if (! str_contains($source, 'Sentry\\captureMessage')) {
                continue;
            }
            if (! str_contains($source, '$scope->setFingerprint(')) {
                $missing[] = basename($path);
            }
        }

        self::assertSame(
            [],
            $missing,
            'These console commands send a Sentry message without pinning its grouping. A message built with '
                . 'sprintf() and any run-varying value will open a new Sentry issue per run: '
                . implode(', ', $missing)
        );
    }

    public function test_no_alarm_command_double_reports_its_alarm_line_into_sentry(): void
    {
        // 🔴 A fingerprint on the explicit capture is only half the job.
        //
        // Production's LOG_STACK includes the `sentry` channel, so ANY
        // `Log::error()` inside a command that also calls captureMessage()
        // becomes a SECOND Sentry event — and a log line cannot carry a
        // fingerprint, so it groups by message text as its own issue.
        //
        // Measured: the safeguarding contact-gate alarm fired once on
        // 2026-08-30 and opened both NEXUS-PHP-65 (the log leg, tagged
        // logger=production with a `log_context` extra) and NEXUS-PHP-66 (the
        // capture leg) in the same second. All five alarm commands shared it,
        // so each spent two of the ten-event budget in postdeploy-watch.mjs.
        //
        // The fix is App\Support\Sentry\OperatorLog::withoutSentry(), which
        // logs through the configured stack minus the sentry channel.
        $offenders = [];

        foreach (glob($this->root . '/app/Console/Commands/*.php') ?: [] as $path) {
            $source = (string) file_get_contents($path);
            if (! str_contains($source, 'Sentry\\captureMessage')) {
                continue;
            }
            if (str_contains($source, 'Log::error(')) {
                $offenders[] = basename($path);
            }
        }

        self::assertSame(
            [],
            $offenders,
            'These alarm commands call Log::error() alongside an explicit Sentry capture, so every occurrence '
                . 'opens TWO Sentry issues — the fingerprinted capture and an unfingerprinted log leg. Use '
                . 'App\\Support\\Sentry\\OperatorLog::withoutSentry()->error(...) for the alarm line instead: '
                . implode(', ', $offenders)
        );
    }

    public function test_alarm_commands_route_their_alarm_line_through_the_non_sentry_logger(): void
    {
        // The negative test above passes vacuously if someone deletes the log
        // line entirely, which would lose local visibility of the alarm. Every
        // alarm command that captures to Sentry must still log locally.
        foreach (self::alarmCommands() as $file) {
            $source = (string) file_get_contents($this->root . '/app/Console/Commands/' . $file);

            // AlarmSelftest is a heartbeat at info level and has no error line.
            if ($file === 'AlarmSelftest.php') {
                continue;
            }

            self::assertStringContainsString(
                'OperatorLog::withoutSentry()',
                $source,
                $file . ' no longer logs its alarm locally through OperatorLog::withoutSentry(). The alarm must '
                    . 'stay visible in docker logs and the daily file, just not as a second Sentry group.'
            );
        }
    }

    public function test_fingerprints_are_literal_and_do_not_vary_per_run(): void
    {
        // A fingerprint interpolating a timestamp, count or percentage would
        // defeat the entire point, so the leading element must be a literal.
        // Later elements MAY be dynamic — SloCheck deliberately separates by
        // tenant, because one community breaching is a different fact from
        // another one breaching.
        foreach (self::alarmCommands() as $file) {
            $source = (string) file_get_contents($this->root . '/app/Console/Commands/' . $file);

            preg_match_all('/setFingerprint\(\s*\[\s*([^,\]]+)/', $source, $matches);
            self::assertNotEmpty($matches[1], $file . ' has no parsable setFingerprint([...]) call.');

            foreach ($matches[1] as $firstElement) {
                $firstElement = trim($firstElement);
                self::assertMatchesRegularExpression(
                    "/^'[a-z0-9_]+'$/",
                    $firstElement,
                    $file . " has a non-literal leading fingerprint element ({$firstElement}); it must not vary per run."
                );
            }
        }
    }
}
