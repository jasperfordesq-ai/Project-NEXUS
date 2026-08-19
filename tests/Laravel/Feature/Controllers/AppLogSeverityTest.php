<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * `POST /api/app/log` is where mobile crash reports arrive, and the LEVEL it logs at
 * decides whether anyone ever sees them.
 *
 * 🔴 The full picture, because one detail was doing all the damage. The mobile app's own
 * Sentry is disabled in all six build profiles, so this endpoint is the only route a
 * crash on a member's phone has. Everything arriving here used to be logged at
 * `warning` — and the `sentry` log channel captures at `error` (config/logging.php). So a
 * crash reached the log FILE and nothing else: no Sentry event, and therefore nothing in
 * the nightly triage. Invisible by two independent routes at once.
 *
 * A genuine crash (`mobile_error`) is now logged at `error`. Analytics and warning
 * traffic stays at `warning`, so raising the level does not flood the project.
 */
class AppLogSeverityTest extends TestCase
{
    /** @return array<string, mixed> */
    private function payload(string $event): array
    {
        return [
            'event' => $event,
            'version' => '1.2.0',
            'platform' => 'mobile',
            'data' => ['message' => 'something broke'],
        ];
    }

    public function test_a_mobile_crash_is_logged_at_error_so_it_reaches_the_nightly_triage(): void
    {
        Log::shouldReceive('error')->once()->withArgs(
            fn (string $line): bool => str_contains($line, 'mobile_error')
        );
        Log::shouldReceive('warning')->never();
        Log::shouldReceive('shareContext')->zeroOrMoreTimes();

        $this->postJson('/api/app/log', $this->payload('mobile_error'))->assertOk();
    }

    public function test_a_mobile_warning_stays_at_warning_so_the_project_is_not_flooded(): void
    {
        Log::shouldReceive('warning')->once()->withArgs(
            fn (string $line): bool => str_contains($line, 'mobile_warning')
        );
        Log::shouldReceive('error')->never();
        Log::shouldReceive('shareContext')->zeroOrMoreTimes();

        $this->postJson('/api/app/log', $this->payload('mobile_warning'))->assertOk();
    }

    public function test_ordinary_analytics_events_stay_at_warning(): void
    {
        // This endpoint carries more than crashes; only the crash event is escalated.
        Log::shouldReceive('warning')->once();
        Log::shouldReceive('error')->never();
        Log::shouldReceive('shareContext')->zeroOrMoreTimes();

        $this->postJson('/api/app/log', $this->payload('screen_view'))->assertOk();
    }

    public function test_the_event_name_is_still_sanitised(): void
    {
        // Pre-existing behaviour worth keeping pinned: the event name goes into a log
        // line, so log injection has to be impossible.
        //
        // 🔴 What sanitisation actually does, having got this wrong first time: it strips
        // every character outside [a-zA-Z0-9_.-], so a newline and the spaces vanish but
        // the LETTERS remain — "bad\nevent INJECTED" becomes "badeventINJECTED". That is
        // correct: forging a new log line is what matters, not the presence of a word.
        // Asserting the word was absent was a fault in this test, not in the code.
        Log::shouldReceive('warning')->once()->withArgs(
            fn (string $line): bool => ! str_contains($line, "\n")
                && ! str_contains($line, "\r")
                && str_contains($line, 'Event: badeventINJECTED')
        );
        Log::shouldReceive('error')->never();
        Log::shouldReceive('shareContext')->zeroOrMoreTimes();

        $this->postJson('/api/app/log', $this->payload("bad\nevent INJECTED"))->assertOk();
    }

    public function test_an_escalated_crash_report_cannot_forge_a_log_line_either(): void
    {
        // The escalation added a second path through the sanitiser; both must be safe.
        Log::shouldReceive('error')->once()->withArgs(
            fn (string $line): bool => ! str_contains($line, "\n") && ! str_contains($line, "\r")
        );
        Log::shouldReceive('warning')->never();
        Log::shouldReceive('shareContext')->zeroOrMoreTimes();

        $this->postJson('/api/app/log', [
            'event' => 'mobile_error',
            'version' => "1.2.0\nforged",
            'platform' => "mobile\nforged",
            'data' => ['message' => 'crash'],
        ])->assertOk();
    }
}
