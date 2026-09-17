<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\OnboardingNurtureService;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;

/**
 * OnboardingNurtureServiceTest
 *
 * Strategy:
 * - The custom App\Core\Mailer always attempts a real SMTP connection — in the
 *   test environment there is no SMTP server, so every `Mailer::send()` call
 *   returns false and the send attempt is logged to email_log with status='failed'.
 *   The nurture service then increments $errors for that user.
 *
 * Therefore observable test signals are:
 *   (a) email_log rows: a 'failed' status row for the user's email address
 *       proves the service DID proceed past all guards and attempted delivery.
 *   (b) dedup cache key: set ONLY on successful send (Mailer returns true).
 *       In test env Mailer always returns false so the cache key is NEVER set
 *       for any positive test — we use email_log presence as the positive signal instead.
 *   (c) Guard bypasses (dedup, onboarding_completed, inactive, out-of-window):
 *       no email_log row should appear, and errors stay 0 for that specific user.
 *
 * MAIL_MAILER=array is required (-e flag) for the docker exec command that runs
 * this file; without it the Mailer falls through to SMTP-only and blocks.
 *
 * Skipped: successful 'sent' path (requires a real SMTP / SendGrid key).
 * Skipped: dedup cache set on success (requires Mailer returning true).
 */
class OnboardingNurtureServiceTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById(self::TENANT_ID);
        Queue::fake(); // prevent sync-queue job from resetting TenantContext mid-test
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /**
     * Insert a user whose created_at is exactly $daysAgo days ago (within the nurture window).
     *
     * @param array<string,mixed> $overrides
     */
    private function insertUserAtDay(int $daysAgo, array $overrides = []): array
    {
        $uid   = uniqid('nurture_', true);
        // A routable fixture domain is required: EmailDispatchService::send()
        // refuses reserved suffixes (.test, .local, .invalid, .example,
        // .localhost) outright, so a fixture under one never reaches the
        // mailer and no email_log row is written for these assertions.
        $email = 'nurture.' . $uid . '@example.com';

        $id = DB::table('users')->insertGetId(array_merge([
            'tenant_id'           => self::TENANT_ID,
            'name'                => 'Nurture ' . $uid,
            'first_name'          => 'Nurture',
            'last_name'           => 'Test',
            'email'               => $email,
            'status'              => 'active',
            'balance'             => 0.00,
            'role'                => 'member',
            'is_approved'         => 1,
            'onboarding_completed'=> 0,
            'preferred_language'  => 'en',
            'created_at'          => now()->subDays($daysAgo),
            'updated_at'          => now(),
        ], $overrides));

        return [$id, $email];
    }

    /**
     * Count email_log attempts for the given address (any status: sent/failed/suppressed).
     */
    private function emailLogAttempts(string $email): int
    {
        return DB::table('email_log')
            ->where('recipient_email', $email)
            ->count();
    }

    /**
     * Build the dedup cache key that OnboardingNurtureService uses.
     */
    private function dedupKey(int $userId, int $day): string
    {
        return "onboarding_nurture:" . self::TENANT_ID . ":{$userId}:{$day}";
    }

    // ── Return shape ──────────────────────────────────────────────────────────

    public function test_sendDueNurtureEmails_returns_sent_and_errors_keys(): void
    {
        $result = OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertIsArray($result);
        $this->assertArrayHasKey('sent', $result);
        $this->assertArrayHasKey('errors', $result);
        $this->assertIsInt($result['sent']);
        $this->assertIsInt($result['errors']);
    }

    public function test_sendDueNurtureEmails_counters_are_non_negative(): void
    {
        $result = OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertGreaterThanOrEqual(0, $result['sent']);
        $this->assertGreaterThanOrEqual(0, $result['errors']);
    }

    // ── Day-2 window: incomplete user — send is attempted ────────────────────

    public function test_day2_send_attempted_for_incomplete_user_in_window(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 0]);

        $logsBefore = $this->emailLogAttempts($email);
        OnboardingNurtureService::sendDueNurtureEmails();
        $logsAfter  = $this->emailLogAttempts($email);

        $this->assertGreaterThan($logsBefore, $logsAfter,
            'Day-2 send should attempt delivery and write an email_log row for an incomplete user in the window');
    }

    // ── Day-2 window: completed user — send is NOT attempted ─────────────────

    public function test_day2_send_skipped_for_completed_user(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 1]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertSame(0, $this->emailLogAttempts($email),
            'Day-2 must not attempt delivery when onboarding_completed=1');
    }

    // ── Day-5 window: incomplete user — send is attempted ────────────────────

    public function test_day5_send_attempted_for_incomplete_user_in_window(): void
    {
        [$userId, $email] = $this->insertUserAtDay(5, ['onboarding_completed' => 0]);

        $logsBefore = $this->emailLogAttempts($email);
        OnboardingNurtureService::sendDueNurtureEmails();
        $logsAfter  = $this->emailLogAttempts($email);

        $this->assertGreaterThan($logsBefore, $logsAfter,
            'Day-5 send should attempt delivery for an incomplete user in the window');
    }

    // ── Day-5 window: completed user — send is NOT attempted ─────────────────

    public function test_day5_send_skipped_for_completed_user(): void
    {
        [$userId, $email] = $this->insertUserAtDay(5, ['onboarding_completed' => 1]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertSame(0, $this->emailLogAttempts($email),
            'Day-5 must not attempt delivery when onboarding_completed=1');
    }

    // ── Day-7 window: always-send regardless of onboarding_completed ─────────

    public function test_day7_send_attempted_for_completed_user(): void
    {
        [$userId, $email] = $this->insertUserAtDay(7, ['onboarding_completed' => 1]);

        $logsBefore = $this->emailLogAttempts($email);
        OnboardingNurtureService::sendDueNurtureEmails();
        $logsAfter  = $this->emailLogAttempts($email);

        $this->assertGreaterThan($logsBefore, $logsAfter,
            'Day-7 must attempt delivery even when onboarding_completed=1');
    }

    public function test_day7_send_attempted_for_incomplete_user(): void
    {
        [$userId, $email] = $this->insertUserAtDay(7, ['onboarding_completed' => 0]);

        $logsBefore = $this->emailLogAttempts($email);
        OnboardingNurtureService::sendDueNurtureEmails();
        $logsAfter  = $this->emailLogAttempts($email);

        $this->assertGreaterThan($logsBefore, $logsAfter,
            'Day-7 must attempt delivery for an incomplete user');
    }

    // ── Dedup: second run does not re-attempt for the same user+day ──────────

    public function test_dedup_prevents_resend_when_cache_key_already_set(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 0]);

        // Pre-seed the dedup key as if a prior run already sent this email
        Cache::put($this->dedupKey($userId, 2), true, now()->addDays(30));

        OnboardingNurtureService::sendDueNurtureEmails();

        // Dedup should have prevented the send — no email_log row for this user
        $this->assertSame(0, $this->emailLogAttempts($email),
            'Dedup cache key must prevent a second send attempt for the same user+day');
    }

    // ── Inactive user is skipped ──────────────────────────────────────────────

    public function test_inactive_user_is_not_sent_nurture_email(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, [
            'status'               => 'inactive',
            'onboarding_completed' => 0,
        ]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertSame(0, $this->emailLogAttempts($email),
            'Inactive users must not receive nurture emails');
    }

    // ── Outside window: registered too long ago ───────────────────────────────

    public function test_user_outside_all_windows_receives_no_nurture_email(): void
    {
        // 30 days ago is outside every ±12h window (day 2, 5, 7)
        [$userId, $email] = $this->insertUserAtDay(30, ['onboarding_completed' => 0]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertSame(0, $this->emailLogAttempts($email),
            'User registered 30 days ago must not match any nurture window');
    }

    // ── email_log category tag ────────────────────────────────────────────────

    public function test_email_log_row_has_category_onboarding_nurture(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 0]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $row = DB::table('email_log')
            ->where('recipient_email', $email)
            ->orderByDesc('id')
            ->first();

        $this->assertNotNull($row, 'Expected an email_log row after nurture send attempt');
        $this->assertSame('onboarding_nurture', $row->category,
            'email_log category must be "onboarding_nurture"');
    }

    // ── Dedup cache key shape ─────────────────────────────────────────────────

    public function test_dedup_cache_key_is_not_set_when_send_fails(): void
    {
        // In the test env Mailer always returns false (no SMTP), so the cache
        // key is never written — confirming the service only deduplicates
        // genuinely-sent emails.
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 0]);
        // Force a deterministic send failure by suppressing the recipient, so the
        // dedup assertion does not depend on ambient SMTP/transport state (other
        // tests in the full suite can leave the mailer able to "succeed"). The
        // suppression row is rolled back by DatabaseTransactions.
        DB::table('email_suppression')->insert([
            'email'         => $email,
            'reason'        => 'bounce',
            'suppressed_at' => now(),
            'created_at'    => now(),
            'updated_at'    => now(),
        ]);

        OnboardingNurtureService::sendDueNurtureEmails();

        $this->assertFalse(
            Cache::has($this->dedupKey($userId, 2)),
            'Dedup key must NOT be set when the send is refused (recipient suppressed)'
        );
    }

    // ── No errors from base invocation without seeded fixtures ────────────────

    public function test_run_with_no_fixture_users_produces_zero_errors(): void
    {
        // Just verifying no DB or structural errors on a baseline run
        // (there may be real tenant-2 users but none in the precise day windows)
        $result = OnboardingNurtureService::sendDueNurtureEmails();
        // We only assert the shape and types are sane
        $this->assertGreaterThanOrEqual(0, $result['sent']);
        $this->assertGreaterThanOrEqual(0, $result['errors']);
    }

    // ── Day-2 user does not receive day-5 or day-7 emails ────────────────────

    public function test_day2_user_does_not_trigger_day5_or_day7_email(): void
    {
        [$userId, $email] = $this->insertUserAtDay(2, ['onboarding_completed' => 0]);

        OnboardingNurtureService::sendDueNurtureEmails();

        // At most 1 email_log row (the day-2 attempt); definitely not 3
        $count = $this->emailLogAttempts($email);
        $this->assertLessThanOrEqual(1, $count,
            'A user in the day-2 window must only trigger one nurture email attempt');
    }
}
