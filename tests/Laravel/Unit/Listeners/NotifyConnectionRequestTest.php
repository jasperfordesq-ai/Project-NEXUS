<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\ConnectionRequested;
use App\Listeners\NotifyConnectionRequest;
use App\Models\Connection;
use App\Models\User;
use App\Services\NotificationDispatcher;
use Illuminate\Contracts\Queue\ShouldQueue;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class NotifyConnectionRequestTest extends TestCase
{
    private $dispatcherAlias;

    protected function setUp(): void
    {
        // App\Services\NotificationDispatcher may already be autoloaded by app
        // boot or an earlier test in the combined run, so the alias mock MUST be
        // created before parent::setUp() and tolerate the class already existing.
        // shouldIgnoreMissing() makes boot-time/static calls no-ops; per-test
        // expectations are layered on the shared instance in each test.
        $this->dispatcherAlias = Mockery::mock('alias:' . NotificationDispatcher::class)->shouldIgnoreMissing();
        parent::setUp();
    }

    public function test_implements_should_queue(): void
    {
        $this->assertTrue(
            in_array(ShouldQueue::class, class_implements(NotifyConnectionRequest::class))
        );
    }

    public function test_handle_dispatches_notification_to_target_user(): void
    {
        $requester = new User();
        $requester->id = 10;
        $requester->first_name = 'Alice';

        $target = new User();
        $target->id = 20;

        $connection = new Connection();

        $event = new ConnectionRequested($connection, $requester, $target, 2);

        // Mock the static NotificationDispatcher::dispatch call
        $this->dispatcherAlias
            ->shouldReceive('dispatch')
            ->once()
            ->with(
                20,
                'global',
                null,
                'connection_request',
                'Alice sent you a connection request',
                '/connections',
                null,
                false,
                null,
                null,
                null,
                // Lock-screen copy names the requester.
                ['actor' => 'Alice']
            );

        $listener = new NotifyConnectionRequest();
        $listener->handle($event);
    }

    public function test_handle_uses_fallback_name_when_first_name_is_null(): void
    {
        $requester = new User();
        $requester->id = 10;
        // first_name and name both null

        $target = new User();
        $target->id = 20;

        $connection = new Connection();

        $event = new ConnectionRequested($connection, $requester, $target, 2);

        $this->dispatcherAlias
            ->shouldReceive('dispatch')
            ->once()
            ->with(
                20,
                'global',
                null,
                'connection_request',
                'Someone sent you a connection request',
                '/connections',
                null,
                false,
                null,
                null,
                null,
                ['actor' => 'Someone']
            );

        $listener = new NotifyConnectionRequest();
        $listener->handle($event);
    }

    public function test_handle_catches_exceptions_and_logs_error(): void
    {
        $requester = new User();
        $requester->id = 10;
        $requester->first_name = 'Alice';

        $target = new User();
        $target->id = 20;

        $connection = new Connection();
        $event = new ConnectionRequested($connection, $requester, $target, 2);

        $this->dispatcherAlias
            ->shouldReceive('dispatch')
            ->once()
            ->andThrow(new \RuntimeException('Test failure'));

        \Illuminate\Support\Facades\Log::shouldReceive('error')
            ->once()
            ->with('NotifyConnectionRequest listener failed', Mockery::type('array'));

        $listener = new NotifyConnectionRequest();
        // Should not throw
        $listener->handle($event);
    }
}
