<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\JobVacancyCreated;
use App\Listeners\NotifyJobAlertSubscribers;
use App\Models\JobAlert;
use App\Models\JobVacancy;
use App\Models\Notification;
use App\Models\User;
use App\Services\JobAlertEmailService;
use App\Services\NotificationDispatcher;
use App\Services\RealtimeService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * Tests for NotifyJobAlertSubscribers listener.
 *
 * Strategy: use real DB rows (JobAlert, JobVacancy, User) inside a database
 * transaction that rolls back after each test. The three static-class side
 * effects (Notification::createNotification, NotificationDispatcher::fanOutPush,
 * RealtimeService::broadcastOnly, JobAlertEmailService::sendImmediateAlert)
 * are alias-mocked so the test never touches email/push infra.
 *
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class NotifyJobAlertSubscribersTest extends TestCase
{
    use \Illuminate\Foundation\Testing\DatabaseTransactions;

    // Alias mocks — created before parent::setUp() so they survive autoload.
    private $notificationAlias;
    private $dispatcherAlias;
    private $realtimeAlias;
    private $emailServiceAlias;

    protected function setUp(): void
    {
        $this->notificationAlias  = Mockery::mock('alias:' . Notification::class)->shouldIgnoreMissing();
        $this->dispatcherAlias    = Mockery::mock('alias:' . NotificationDispatcher::class)->shouldIgnoreMissing();
        $this->realtimeAlias      = Mockery::mock('alias:' . RealtimeService::class)->shouldIgnoreMissing();
        $this->emailServiceAlias  = Mockery::mock('alias:' . JobAlertEmailService::class)->shouldIgnoreMissing();

        parent::setUp();

        // Array cache store persists across methods in the same process; flush so
        // no prior done/claim/sent key short-circuits handle().
        Cache::flush();
    }

    // -------------------------------------------------------------------------
    // Contract
    // -------------------------------------------------------------------------

    public function test_implements_should_queue(): void
    {
        $this->assertTrue(
            in_array(ShouldQueue::class, class_implements(NotifyJobAlertSubscribers::class)),
            'NotifyJobAlertSubscribers must implement ShouldQueue'
        );
    }

    public function test_tries_is_one_and_timeout_is_sixty(): void
    {
        $listener = new NotifyJobAlertSubscribers();
        $this->assertSame(1, $listener->tries);
        $this->assertSame(60, $listener->timeout);
    }

    // -------------------------------------------------------------------------
    // Happy path — keyword match
    // -------------------------------------------------------------------------

    public function test_handle_notifies_subscriber_when_vacancy_matches_keyword(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'PHP Developer Role']);

        // Alert whose keyword matches the vacancy title.
        $this->seedAlert($subscriber, [
            'keywords'  => 'php',
            'is_active' => 1,
        ]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias
            ->shouldReceive('createNotification')
            ->once()
            ->with(
                $subscriber->id,
                Mockery::type('string'),
                "/jobs/{$vacancy->id}",
                'job_application'
            );

        $this->emailServiceAlias
            ->shouldReceive('sendImmediateAlert')
            ->once()
            ->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Non-matching keyword — subscriber NOT notified
    // -------------------------------------------------------------------------

    public function test_handle_skips_subscriber_when_keyword_does_not_match(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'Graphic Designer']);

        // Alert keyword 'php' cannot match 'Graphic Designer'.
        $this->seedAlert($subscriber, ['keywords' => 'php', 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // No alerts → no notifications
    // -------------------------------------------------------------------------

    public function test_handle_sends_no_notifications_when_no_alerts_exist(): void
    {
        $creator = $this->seedUser();
        $vacancy = $this->seedVacancy($creator, ['title' => 'Developer']);

        // Intentionally seed NO job alerts.

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Inactive alerts are skipped
    // -------------------------------------------------------------------------

    public function test_handle_skips_inactive_alerts(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'PHP Developer']);

        $this->seedAlert($subscriber, ['keywords' => 'php', 'is_active' => 0]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Type filter — mismatch
    // -------------------------------------------------------------------------

    public function test_handle_skips_alert_when_type_does_not_match(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['type' => 'paid']);

        // Alert wants volunteer only.
        $this->seedAlert($subscriber, ['type' => 'volunteer', 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Commitment filter — mismatch
    // -------------------------------------------------------------------------

    public function test_handle_skips_alert_when_commitment_does_not_match(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['commitment' => 'full_time']);

        $this->seedAlert($subscriber, ['commitment' => 'part_time', 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Remote-only filter — vacancy not remote
    // -------------------------------------------------------------------------

    public function test_handle_skips_alert_when_remote_only_but_vacancy_not_remote(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['is_remote' => 0]);

        $this->seedAlert($subscriber, ['is_remote_only' => 1, 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Remote-only filter — vacancy IS remote → match
    // -------------------------------------------------------------------------

    public function test_handle_notifies_when_remote_only_and_vacancy_is_remote(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['is_remote' => 1]);

        $this->seedAlert($subscriber, ['is_remote_only' => 1, 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias
            ->shouldReceive('createNotification')
            ->once();

        $this->emailServiceAlias
            ->shouldReceive('sendImmediateAlert')
            ->once()
            ->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Alerts from a different tenant are NOT triggered
    // -------------------------------------------------------------------------

    public function test_handle_does_not_notify_alerts_from_other_tenant(): void
    {
        $subscriber = $this->seedUser([], 999);   // other tenant
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'PHP Developer']);

        // Alert belongs to tenant 999 — should never match tenant 2's vacancy.
        \Illuminate\Support\Facades\DB::table('job_alerts')->insert([
            'tenant_id'  => 999,
            'user_id'    => $subscriber->id,
            'keywords'   => 'php',
            'is_active'  => 1,
            'created_at' => now(),
        ]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Idempotency — duplicate vacancy delivery suppressed
    // -------------------------------------------------------------------------

    public function test_handle_suppresses_duplicate_vacancy_delivery(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'PHP Dev']);
        $this->seedAlert($subscriber, ['keywords' => 'php', 'is_active' => 1]);

        $handledKey = 'notify_job_alert_subscribers:done:' . $this->testTenantId . ':' . $vacancy->id;
        Cache::put($handledKey, 1, now()->addHour());

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->never();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->never();

        Log::shouldReceive('info')
            ->once()
            ->with('NotifyJobAlertSubscribers: duplicate delivery suppressed', Mockery::type('array'));

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(Cache::has($handledKey));
    }

    // -------------------------------------------------------------------------
    // Done-cache is written after successful fanout
    // -------------------------------------------------------------------------

    public function test_handle_writes_done_cache_key_after_fanout(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'PHP Dev']);
        $this->seedAlert($subscriber, ['keywords' => 'php', 'is_active' => 1]);

        $handledKey = 'notify_job_alert_subscribers:done:' . $this->testTenantId . ':' . $vacancy->id;

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias->shouldReceive('createNotification')->once();
        $this->emailServiceAlias->shouldReceive('sendImmediateAlert')->once()->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(Cache::has($handledKey), 'Done cache key must exist after successful fanout');
    }

    // -------------------------------------------------------------------------
    // Keywords in description match
    // -------------------------------------------------------------------------

    public function test_handle_matches_keyword_in_vacancy_description(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, [
            'title'       => 'Software Engineer',
            'description' => 'We are looking for a Laravel expert to join our team.',
        ]);

        $this->seedAlert($subscriber, ['keywords' => 'laravel', 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias
            ->shouldReceive('createNotification')
            ->once();

        $this->emailServiceAlias
            ->shouldReceive('sendImmediateAlert')
            ->once()
            ->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Multiple matching alerts — each notified once
    // -------------------------------------------------------------------------

    public function test_handle_notifies_multiple_matching_subscribers(): void
    {
        $sub1    = $this->seedUser();
        $sub2    = $this->seedUser();
        $creator = $this->seedUser();
        $vacancy = $this->seedVacancy($creator, ['title' => 'PHP Developer']);

        $this->seedAlert($sub1, ['keywords' => 'php', 'is_active' => 1]);
        $this->seedAlert($sub2, ['keywords' => 'developer', 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias
            ->shouldReceive('createNotification')
            ->times(2);

        $this->emailServiceAlias
            ->shouldReceive('sendImmediateAlert')
            ->times(2)
            ->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Alert with null keywords matches any vacancy (wildcard)
    // -------------------------------------------------------------------------

    public function test_handle_alert_with_null_keywords_matches_any_vacancy(): void
    {
        $subscriber = $this->seedUser();
        $creator    = $this->seedUser();
        $vacancy    = $this->seedVacancy($creator, ['title' => 'Anything At All']);

        $this->seedAlert($subscriber, ['keywords' => null, 'is_active' => 1]);

        $event = $this->makeEvent($vacancy, $creator);

        $this->notificationAlias
            ->shouldReceive('createNotification')
            ->once();

        $this->emailServiceAlias
            ->shouldReceive('sendImmediateAlert')
            ->once()
            ->andReturn(true);

        $listener = new NotifyJobAlertSubscribers();
        $listener->handle($event);

        $this->assertTrue(true);
    }

    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    /**
     * Seed a user row and return an Eloquent User model.
     */
    private function seedUser(array $overrides = [], ?int $tenantId = null): User
    {
        $tenantId = $tenantId ?? $this->testTenantId;
        $unique   = uniqid('u_', true);

        $id = \Illuminate\Support\Facades\DB::table('users')->insertGetId(array_merge([
            'tenant_id'          => $tenantId,
            'name'               => 'Test User ' . $unique,
            'first_name'         => 'Test',
            'last_name'          => 'User',
            'email'              => $unique . '@example.com',
            'role'               => 'member',
            'status'             => 'active',
            'preferred_language' => 'en',
            'is_approved'        => 1,
            'created_at'         => now(),
            'updated_at'         => now(),
        ], $overrides));

        return User::withoutGlobalScopes()->find($id);
    }

    /**
     * Seed a job vacancy and return an Eloquent JobVacancy model.
     */
    private function seedVacancy(User $creator, array $overrides = []): JobVacancy
    {
        $id = \Illuminate\Support\Facades\DB::table('job_vacancies')->insertGetId(array_merge([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $creator->id,
            'title'       => 'Test Vacancy ' . uniqid(),
            'description' => 'Test description for matching.',
            'status'      => 'open',
            'type'        => 'paid',
            'commitment'  => 'full_time',
            'is_remote'   => 0,
            'created_at'  => now(),
        ], $overrides));

        return JobVacancy::withoutGlobalScopes()->find($id);
    }

    /**
     * Seed a job alert row and return a JobAlert model.
     */
    private function seedAlert(User $user, array $overrides = []): JobAlert
    {
        $id = \Illuminate\Support\Facades\DB::table('job_alerts')->insertGetId(array_merge([
            'tenant_id'  => $this->testTenantId,
            'user_id'    => $user->id,
            'is_active'  => 1,
            'created_at' => now(),
        ], $overrides));

        return JobAlert::withoutGlobalScopes()->find($id);
    }

    /**
     * Build a JobVacancyCreated event from real Eloquent models.
     */
    private function makeEvent(JobVacancy $vacancy, User $creator): JobVacancyCreated
    {
        return new JobVacancyCreated($vacancy, $creator, $this->testTenantId);
    }
}
