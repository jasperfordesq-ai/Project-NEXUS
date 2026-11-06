<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\UserRegistered;
use App\Listeners\SendWelcomeNotification;
use App\Models\Notification;
use App\Models\User;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class SendWelcomeNotificationTest extends TestCase
{
    private $notificationAlias;

    protected function setUp(): void
    {
        // App\Models\Notification may already be autoloaded by app boot or an
        // earlier test in the combined run, so the alias mock MUST be created
        // before parent::setUp() and tolerate the class already existing.
        // shouldIgnoreMissing() makes boot-time/static calls no-ops; per-test
        // expectations are layered on the shared instance in each test.
        $this->notificationAlias = Mockery::mock('alias:' . Notification::class)->shouldIgnoreMissing();
        parent::setUp();
        // The listener has a Cache-backed idempotency guard keyed by
        // tenant_id:user_id. Without flushing between tests (the array cache
        // store persists across methods in the same process) a prior test's
        // "done" key would short-circuit handle() before any work runs.
        Cache::flush();
    }

    public function test_runs_inline_for_activation_delivery(): void
    {
        $this->assertFalse(
            in_array(ShouldQueue::class, class_implements(SendWelcomeNotification::class), true),
            'SendWelcomeNotification must not implement ShouldQueue; activation email delivery is registration-critical.'
        );
    }

    public function test_handle_creates_notification_and_sends_email(): void
    {
        // Active + verified user → generic welcome branch (no verification-token
        // DB writes). The welcome email goes out via the static
        // EmailDispatchService::sendRaw (not an injected EmailService instance).
        // TenantContext runs for real against the test tenant.
        $user = new User();
        $user->id = 42;
        $user->first_name = 'Alice';
        $user->email = 'alice@example.com';
        $user->status = 'active';
        $user->email_verified_at = now();

        $event = new UserRegistered($user, $this->testTenantId);

        $notificationMock = $this->notificationAlias;
        $notificationMock->shouldReceive('create')
            ->once()
            ->with(Mockery::on(function ($data) {
                return $data['tenant_id'] === $this->testTenantId
                    && $data['user_id'] === 42
                    && $data['type'] === 'welcome'
                    && $data['link'] === '/feed'
                    && $data['is_read'] === false;
            }));

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->with(
                'alice@example.com',
                Mockery::type('string'),
                Mockery::type('string'),
                null,
                null,
                null,
                'welcome',
                Mockery::type('array')
            )
            ->andReturn(true);

        $listener = new SendWelcomeNotification();
        $listener->handle($event);
    }

    public function test_a_confirmed_member_waiting_for_approval_gets_the_waiting_email_not_a_confirm_link(): void
    {
        // E-121: a Google sign-up has a confirmed email but may still be waiting
        // for the community to let them in. Every pending account used to get
        // "Verify your email" with a confirm link it did not need.
        $user = new User();
        $user->id = 44;
        $user->first_name = 'Gail';
        $user->email = 'gail@gmail.com';
        $user->status = 'pending';
        $user->email_verified_at = now();

        $event = new UserRegistered($user, $this->testTenantId, null, true);

        $this->notificationAlias->shouldReceive('create')->once();

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldReceive('sendRaw')
            ->once()
            ->with(
                'gail@gmail.com',
                Mockery::on(fn ($subject): bool => is_string($subject) && str_contains($subject, 'Thanks for joining')),
                // A short phrase: the template may join a paragraph's last words
                // with a non-breaking space.
                Mockery::on(fn ($html): bool => is_string($html)
                    && !str_contains($html, 'verify-email')
                    && str_contains($html, 'checks new members')),
                null,
                null,
                null,
                'welcome',
                Mockery::type('array')
            )
            ->andReturn(true);

        $listener = new SendWelcomeNotification();
        $listener->handle($event);
    }

    public function test_handle_skips_email_when_no_email_provided(): void
    {
        // No recipient email → the welcome closure returns right after the in-app
        // bell is created, before any EmailDispatchService::sendRaw call.
        $user = new User();
        $user->id = 43;
        $user->first_name = 'Alice';
        $user->email = null;
        $user->status = 'active';
        $user->email_verified_at = now();

        $event = new UserRegistered($user, $this->testTenantId);

        $notificationMock = $this->notificationAlias;
        $notificationMock->shouldReceive('create')->once();

        Mockery::mock('alias:' . EmailDispatchService::class)
            ->shouldNotReceive('sendRaw');

        $listener = new SendWelcomeNotification();
        $listener->handle($event);
    }

    public function test_handle_catches_exceptions_and_logs_error(): void
    {
        $user = new User();
        $user->id = 44;

        $event = new UserRegistered($user, $this->testTenantId);

        $notificationMock = $this->notificationAlias;
        $notificationMock->shouldReceive('create')
            ->andThrow(new \RuntimeException('DB error'));

        Log::shouldReceive('error')
            ->once()
            ->with('SendWelcomeNotification listener failed', Mockery::type('array'));

        $listener = new SendWelcomeNotification();
        $listener->handle($event);
    }

    /**
     * Regression guard for the 2026-04-02 email-bombing class: if a duplicate
     * event fires the listener again for the SAME registration, the
     * idempotency guard must short-circuit BEFORE any bell/email/token work.
     */
    public function test_handle_suppresses_duplicate_delivery_when_already_handled(): void
    {
        $user = new User();
        $user->id = 91;
        $user->first_name = 'Dup';
        $user->email = 'dup@example.com';
        $event = new UserRegistered($user, 2);

        // Simulate a prior successful delivery for tenant 2 / user 91.
        Cache::put('send_welcome:done:2:91', 1, now()->addHour());

        // The guard must log the suppression and return — never reaching the
        // welcome flow (which would otherwise log an error or touch the DB here).
        Log::shouldReceive('info')
            ->once()
            ->with('SendWelcomeNotification: duplicate delivery suppressed', Mockery::type('array'));
        Log::shouldReceive('error')->never();
        Log::shouldReceive('warning')->never();

        (new SendWelcomeNotification())->handle($event);

        // Reaching here without the welcome flow running proves the short-circuit.
        $this->assertTrue(Cache::has('send_welcome:done:2:91'));
    }
}
