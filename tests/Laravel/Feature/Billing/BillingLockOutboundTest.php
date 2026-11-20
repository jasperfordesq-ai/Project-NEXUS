<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Billing;

use App\Core\TenantContext;
use App\Services\BillingStandingService;
use App\Services\EmailDispatchService;
use App\Services\FCMPushService;
use App\Services\WebPushService;
use App\Support\Billing\BillingLock;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\Laravel\TestCase;

/**
 * A community paused for non-payment sends nothing to its members.
 *
 * Its admin API stays open, so without this a paused community's admins could
 * still send a newsletter to everyone, and every scheduled digest and reminder
 * would keep going out. The stop is at the three entry points all of those
 * pass through, not in each job.
 *
 * "Reached the mailer" is observed the way EmailDispatchServiceTest observes
 * it: Mailer writes an email_log row for every attempt, sent or failed.
 */
final class BillingLockOutboundTest extends TestCase
{
    use DatabaseTransactions;

    private int $paused;
    private int $open;

    protected function setUp(): void
    {
        parent::setUp();
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=0');

        $this->paused = $this->makeCommunity('Outbound paused');
        $this->open = $this->makeCommunity('Outbound open');

        BillingLock::flush();
        BillingStandingService::suspend($this->paused, null, 'manual');
    }

    protected function tearDown(): void
    {
        putenv('MAILER_PER_RECIPIENT_HOURLY_LIMIT=30');

        // parent::tearDown() rolls the transaction back; it must always run.
        try {
            BillingLock::flush();
        } finally {
            parent::tearDown();
        }
    }

    private function makeCommunity(string $name): int
    {
        $id = (int) DB::table('tenants')->insertGetId([
            'name' => $name,
            'slug' => 'outbound-' . bin2hex(random_bytes(5)),
            'is_active' => 1,
            'parent_id' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        DB::table('tenants')->where('id', $id)->update(['path' => "/1/{$id}/"]);

        return $id;
    }

    /** @return array{0:int, 1:string} */
    private function memberOf(int $tenantId): array
    {
        $email = 'outbound.' . bin2hex(random_bytes(6)) . '@example.com';
        $id = (int) DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'name' => 'Outbound Member',
            'first_name' => 'Outbound',
            'email' => $email,
            'status' => 'active',
            'balance' => 0.00,
            'role' => 'member',
            'is_approved' => 1,
            'preferred_language' => 'en',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return [$id, $email];
    }

    private function reachedTheMailer(string $email): bool
    {
        return DB::table('email_log')->where('recipient_email', $email)->exists();
    }

    public function test_a_newsletter_to_a_paused_community_is_refused(): void
    {
        [, $email] = $this->memberOf($this->paused);

        $sent = EmailDispatchService::sendRaw($email, 'News', '<p>News</p>', null, null, null, 'newsletter', ['tenant_id' => $this->paused]);

        $this->assertFalse($sent);
        $this->assertFalse($this->reachedTheMailer($email));
    }

    public function test_a_billing_email_to_a_paused_community_is_sent(): void
    {
        [, $email] = $this->memberOf($this->paused);

        EmailDispatchService::sendRaw($email, 'Payment due', '<p>Due</p>', null, null, null, 'billing', ['tenant_id' => $this->paused]);

        $this->assertTrue($this->reachedTheMailer($email));
    }

    public function test_a_password_reset_to_a_paused_community_is_sent(): void
    {
        [, $email] = $this->memberOf($this->paused);

        EmailDispatchService::sendRaw($email, 'Reset your password', '<p>Reset</p>', null, null, null, 'password_reset', ['tenant_id' => $this->paused]);

        $this->assertTrue($this->reachedTheMailer($email));
    }

    public function test_a_safeguarding_email_to_a_paused_community_is_sent(): void
    {
        [, $email] = $this->memberOf($this->paused);

        EmailDispatchService::sendRaw($email, 'Concern raised', '<p>Concern</p>', null, null, null, 'safeguarding', ['tenant_id' => $this->paused]);

        $this->assertTrue($this->reachedTheMailer($email));
    }

    public function test_mail_without_a_category_is_refused_for_a_paused_community(): void
    {
        [, $email] = $this->memberOf($this->paused);

        $sent = EmailDispatchService::sendRaw($email, 'Hello', '<p>Hello</p>', null, null, null, null, ['tenant_id' => $this->paused]);

        $this->assertFalse($sent);
        $this->assertFalse($this->reachedTheMailer($email));
    }

    public function test_the_community_is_found_from_the_recipient_when_none_is_given(): void
    {
        [, $email] = $this->memberOf($this->paused);
        TenantContext::setById($this->open);

        $sent = EmailDispatchService::sendRaw($email, 'News', '<p>News</p>', null, null, null, 'newsletter');

        $this->assertFalse($sent);
        $this->assertFalse($this->reachedTheMailer($email));
    }

    public function test_mail_for_an_open_community_is_unaffected(): void
    {
        [, $email] = $this->memberOf($this->open);

        EmailDispatchService::sendRaw($email, 'News', '<p>News</p>', null, null, null, 'newsletter', ['tenant_id' => $this->open]);

        $this->assertTrue($this->reachedTheMailer($email));
    }

    public function test_refusal_is_logged_at_info_not_error(): void
    {
        [, $email] = $this->memberOf($this->paused);

        Log::shouldReceive('info')
            ->once()
            ->withArgs(static fn (string $message): bool => str_contains($message, 'paused for non-payment'));
        Log::shouldReceive('error')->never();
        Log::shouldReceive('warning')->never();

        $sent = EmailDispatchService::sendRaw($email, 'News', '<p>News</p>', null, null, null, 'newsletter', ['tenant_id' => $this->paused]);

        $this->assertFalse($sent);
    }

    public function test_which_categories_stay_open(): void
    {
        foreach (['billing', 'password_reset', 'email_verification', 'security_alert', 'security', 'verification', 'safeguarding', 'safeguarding_review'] as $open) {
            $this->assertTrue(BillingLock::mailAllowedWhileLocked($open), $open);
        }

        foreach (['newsletter', 'newsletters', 'notification_digest', 'social_notification', 'matching', 'welcome', '', null] as $closed) {
            $this->assertFalse(BillingLock::mailAllowedWhileLocked($closed), var_export($closed, true));
        }
    }

    public function test_phone_push_to_a_member_of_a_paused_community_is_not_sent(): void
    {
        [$userId] = $this->memberOf($this->paused);
        TenantContext::setById($this->paused);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $one = FCMPushService::sendToUser($userId, 'Title', 'Body');
        $many = FCMPushService::sendToUsers([$userId], 'Title', 'Body');
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertSame(0, $one['sent']);
        $this->assertTrue($one['suppressed'] ?? false);
        $this->assertSame(0, $many['sent']);
        $this->assertTrue($many['suppressed'] ?? false);
        $this->assertSame(
            [],
            array_values(array_filter($queries, static fn (array $q): bool => str_contains($q['query'], 'fcm_device_tokens'))),
            'A paused community must not even read its members\' device tokens.'
        );
    }

    public function test_browser_push_to_a_member_of_a_paused_community_is_not_sent(): void
    {
        [$userId] = $this->memberOf($this->paused);
        TenantContext::setById($this->paused);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $sent = WebPushService::sendToUserStatic($userId, 'Title', 'Body');
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertFalse($sent);
        $this->assertSame(
            [],
            array_values(array_filter($queries, static fn (array $q): bool => str_contains($q['query'], 'push_subscriptions'))),
            'A paused community must not even read its members\' browser subscriptions.'
        );
    }

    public function test_push_for_an_open_community_still_reads_its_devices(): void
    {
        [$userId] = $this->memberOf($this->open);
        TenantContext::setById($this->open);

        DB::flushQueryLog();
        DB::enableQueryLog();
        $result = FCMPushService::sendToUser($userId, 'Title', 'Body');
        $queries = DB::getQueryLog();
        DB::disableQueryLog();

        $this->assertArrayNotHasKey('suppressed', $result);
        $this->assertNotSame(
            [],
            array_filter($queries, static fn (array $q): bool => str_contains($q['query'], 'fcm_device_tokens'))
        );
    }
}
