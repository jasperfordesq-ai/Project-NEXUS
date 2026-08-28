<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Console;

use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for gdpr:check-overdue-requests (OverdueGdprRequestCheck).
 *
 * Uses a unique tenant id 99703 to avoid cross-test contamination.
 * Uses DatabaseTransactions to roll back all inserts after each test.
 *
 * The command is platform-wide (cross-tenant by design) but we seed our
 * isolated tenant and assert on the rows we control.
 *
 * Exit codes:
 *   0 (SUCCESS) = no pending requests past the --days threshold
 *   1 (FAILURE) = at least one request is past the threshold (overdue alert raised)
 */
class OverdueGdprRequestCheckTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99703;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Seed the isolated test tenant.
        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'             => 'GDPR Test Tenant 99703',
                'slug'             => 'gdpr-test-99703',
                'domain'           => null,
                'is_active'        => true,
                'depth'            => 0,
                'allows_subtenants'=> false,
                'created_at'       => now(),
                'updated_at'       => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Insert a gdpr_requests row for our test tenant.
     * $requestedAt: an explicit datetime string so tests are not wall-clock dependent.
     */
    private function seedGdprRequest(string $requestedAt, string $status = 'pending', string $type = 'access'): int
    {
        // user_id FK — create a minimal user row owned by this tenant
        $userId = DB::table('users')->insertGetId([
            'name'       => 'GDPR Test User',
            'email'      => 'gdpr-test-' . uniqid() . '@example-test.invalid',
            'tenant_id'  => self::TENANT_ID,
            'role'       => 'member',
            'created_at' => now(),
            'status'     => 'active',
        ]);

        return DB::table('gdpr_requests')->insertGetId([
            'user_id'      => $userId,
            'tenant_id'    => self::TENANT_ID,
            'request_type' => $type,
            'status'       => $status,
            'requested_at' => $requestedAt,
            'created_at'   => $requestedAt,
            'updated_at'   => $requestedAt,
        ]);
    }

    // -------------------------------------------------------------------------
    // No-overdue: command should succeed and print healthy message
    // -------------------------------------------------------------------------

    public function test_succeeds_with_no_pending_requests_in_db(): void
    {
        // No rows seeded for this run → clean slate for this tenant.
        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(0);
    }

    public function test_succeeds_when_only_completed_requests_exist(): void
    {
        // A completed request past the warn threshold should NOT trigger an alert.
        $this->seedGdprRequest(
            now()->subDays(40)->toDateTimeString(),
            status: 'completed',
            type: 'access'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(0);
    }

    public function test_succeeds_when_pending_request_is_within_threshold(): void
    {
        // 10 days old, threshold 25 → should be fine.
        $this->seedGdprRequest(
            now()->subDays(10)->toDateTimeString(),
            status: 'pending'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(0);
    }

    public function test_succeeds_when_processing_request_is_within_threshold(): void
    {
        $this->seedGdprRequest(
            now()->subDays(20)->toDateTimeString(),
            status: 'processing'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Overdue detection: command should FAIL and surface the alert
    // -------------------------------------------------------------------------

    public function test_fails_when_pending_request_is_past_threshold(): void
    {
        // 35 days old, threshold 25 → overdue.
        $this->seedGdprRequest(
            now()->subDays(35)->toDateTimeString(),
            status: 'pending'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(1);
    }

    public function test_fails_when_processing_request_is_past_threshold(): void
    {
        $this->seedGdprRequest(
            now()->subDays(30)->toDateTimeString(),
            status: 'processing'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(1);
    }

    public function test_fails_for_erasure_request_past_statutory_deadline(): void
    {
        // Erasure request 45 days old — well past the 30-day statutory deadline.
        $this->seedGdprRequest(
            now()->subDays(45)->toDateTimeString(),
            status: 'pending',
            type: 'erasure'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(1);
    }

    // -------------------------------------------------------------------------
    // Mixed scenarios: healthy rows alongside overdue rows
    // -------------------------------------------------------------------------

    public function test_fails_when_one_overdue_row_mixed_with_healthy_rows(): void
    {
        // Recent (healthy)
        $this->seedGdprRequest(now()->subDays(5)->toDateTimeString(), 'pending');
        // Completed old (not overdue by status)
        $this->seedGdprRequest(now()->subDays(50)->toDateTimeString(), 'completed');
        // Overdue — this one should trigger FAILURE
        $this->seedGdprRequest(now()->subDays(35)->toDateTimeString(), 'pending', 'portability');

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(1);
    }

    // -------------------------------------------------------------------------
    // Boundary: exactly at threshold is not yet overdue (the query is strict <)
    // -------------------------------------------------------------------------

    public function test_succeeds_when_request_is_exactly_at_threshold_boundary(): void
    {
        // requested_at = exactly --days ago: the WHERE uses `<` so this is NOT caught.
        //
        // Freeze the clock so the seeded `requested_at` and the command's
        // `Carbon::now()->subDays(25)` cutoff resolve to the SAME instant. Without
        // this, real wall-clock time elapses between the seed and the command run,
        // so the row drifts just past the strict `<` cutoff and is flagged as
        // overdue → exit 1 (the intermittent CI flake). try/finally guarantees the
        // frozen clock is reset even if the assertion throws.
        Carbon::setTestNow(Carbon::now());

        try {
            $this->seedGdprRequest(
                now()->subDays(25)->toDateTimeString(),
                status: 'pending'
            );

            $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
                ->assertExitCode(0);
        } finally {
            Carbon::setTestNow();
        }
    }

    // -------------------------------------------------------------------------
    // Custom --days option
    // -------------------------------------------------------------------------

    public function test_custom_days_option_controls_threshold(): void
    {
        // 15 days old: overdue at --days=10, healthy at --days=20.
        $this->seedGdprRequest(
            now()->subDays(15)->toDateTimeString(),
            status: 'pending'
        );

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 10])
            ->assertExitCode(1);

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 20])
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Cancelled/rejected requests are not polled (only pending/processing)
    // -------------------------------------------------------------------------

    public function test_succeeds_when_only_rejected_and_cancelled_requests_exist(): void
    {
        $this->seedGdprRequest(now()->subDays(60)->toDateTimeString(), 'rejected');
        $this->seedGdprRequest(now()->subDays(60)->toDateTimeString(), 'cancelled');

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(0);
    }

    // -------------------------------------------------------------------------
    // Multiple overdue requests: still returns FAILURE once
    // -------------------------------------------------------------------------

    public function test_fails_once_for_multiple_overdue_requests(): void
    {
        $this->seedGdprRequest(now()->subDays(40)->toDateTimeString(), 'pending', 'access');
        $this->seedGdprRequest(now()->subDays(50)->toDateTimeString(), 'processing', 'erasure');
        $this->seedGdprRequest(now()->subDays(35)->toDateTimeString(), 'pending', 'objection');

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])
            ->assertExitCode(1);
    }

    // -------------------------------------------------------------------------
    // Alert-message invariance: the logged message is the Sentry grouping key
    // -------------------------------------------------------------------------

    /**
     * The ERROR-log message must be byte-identical night after night for the
     * SAME backlog. It used to embed each request's age in days, which
     * increments daily — so the `sentry` log channel (which groups by raw
     * message text; the explicit capture's fingerprint does not cover this
     * leg) minted a brand-new Sentry issue every night. Sixteen duplicates
     * accumulated between 2026-08-13 and 2026-08-28. Simulated here by running
     * the command on two consecutive "nights" against the same request.
     */
    public function test_error_log_message_is_identical_across_consecutive_nights(): void
    {
        $this->seedGdprRequest(now()->subDays(40)->toDateTimeString(), 'pending', 'access');

        $messages = [];
        \Illuminate\Support\Facades\Log::spy();
        \Illuminate\Support\Facades\Log::shouldReceive('error')
            ->andReturnUsing(function (string $message, array $context = []) use (&$messages): void {
                $messages[] = $message;
                // The human-readable detail must not be lost — it moves into
                // the context, which Sentry shows without grouping on it.
                $this->assertArrayHasKey('message', $context);
                $this->assertArrayHasKey('sample', $context);
            });

        $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])->assertExitCode(1);

        Carbon::setTestNow(now()->addDay());
        try {
            $this->artisan('gdpr:check-overdue-requests', ['--days' => 25])->assertExitCode(1);
        } finally {
            Carbon::setTestNow();
        }

        $this->assertCount(2, $messages, 'Expected exactly one ERROR log per nightly run.');
        $this->assertSame(
            $messages[0],
            $messages[1],
            'The alert log message changed between two nights with the same backlog — '
            . 'the sentry log channel groups by message text, so this mints a new issue nightly.',
        );
        $this->assertDoesNotMatchRegularExpression(
            '/\d+d\b/',
            $messages[0],
            'The log message must not embed ages in days — that is the volatile part that goes in context.',
        );
    }
}
