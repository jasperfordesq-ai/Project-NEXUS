<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Listeners;

use App\Events\SafeguardingCoordinationRequested;
use App\Listeners\NotifySafeguardingCoordinationRequested;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Mockery;
use Tests\Laravel\TestCase;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class NotifySafeguardingCoordinationRequestedTest extends TestCase
{
    use DatabaseTransactions;

    protected int $testTenantId = 999;

    private $notificationAlias;
    private $emailAlias;

    protected function setUp(): void
    {
        $this->notificationAlias = Mockery::mock('alias:' . Notification::class)->shouldIgnoreMissing();
        $this->emailAlias = Mockery::mock('alias:' . EmailDispatchService::class)->shouldIgnoreMissing();

        parent::setUp();

        Cache::flush();
    }

    public function test_implements_should_queue(): void
    {
        $this->assertTrue(
            in_array(ShouldQueue::class, class_implements(NotifySafeguardingCoordinationRequested::class)),
            'NotifySafeguardingCoordinationRequested must implement ShouldQueue'
        );
    }

    public function test_handle_notifies_active_admin_tenant_admin_and_broker_roles(): void
    {
        $sender = $this->seedUser([
            'role' => 'member',
            'status' => 'active',
            'name' => 'Sarah Bird',
            'first_name' => 'Sarah',
            'last_name' => 'Bird',
        ]);
        $recipient = $this->seedUser([
            'role' => 'member',
            'status' => 'active',
            'name' => 'Funding Account',
            'first_name' => 'Funding',
            'last_name' => 'Account',
        ]);
        $this->seedUser(['role' => 'admin', 'status' => 'active']);
        $this->seedUser(['role' => 'tenant_admin', 'status' => 'active']);
        $this->seedUser(['role' => 'broker', 'status' => 'active']);
        $this->seedUser(['role' => 'admin', 'status' => 'inactive']);
        $this->seedUser(['role' => 'broker', 'status' => 'active'], 2);

        $event = new SafeguardingCoordinationRequested(
            tenantId: $this->testTenantId,
            senderId: $sender->id,
            recipientId: $recipient->id,
            reasonCode: 'SAFEGUARDING_CONTACT_RESTRICTED'
        );

        $notificationCount = 0;
        $this->notificationAlias
            ->shouldReceive('create')
            ->times(3)
            ->with(Mockery::on(function ($data) use (&$notificationCount, $recipient) {
                $notificationCount++;

                return (int) $data['tenant_id'] === $this->testTenantId
                    && $data['type'] === 'safeguarding_coordination_requested'
                    && str_contains((string) $data['link'], '/broker/safeguarding')
                    && str_contains((string) $data['link'], (string) $recipient->id);
            }));

        $this->emailAlias
            ->shouldReceive('sendRaw')
            ->times(3)
            ->with(
                Mockery::type('string'),
                Mockery::on(fn ($subject) => str_contains((string) $subject, 'Coordinator help requested')),
                Mockery::on(fn ($html) =>
                    str_contains((string) $html, 'Sarah Bird')
                    && str_contains((string) $html, 'Funding Account')
                    && str_contains((string) $html, 'coordinator')
                ),
                null, null, null,
                'safeguarding',
                Mockery::type('array')
            )
            ->andReturn(true);

        (new NotifySafeguardingCoordinationRequested())->handle($event);

        $this->assertSame(3, $notificationCount);
    }

    public function test_handle_also_notifies_coordinators_and_flag_only_admins(): void
    {
        // F-221: role=coordinator and admins expressed as flags on a member row
        // can open every Broker Panel page, so they must get the alert too.
        $sender = $this->seedUser(['role' => 'member', 'status' => 'active']);
        $recipient = $this->seedUser(['role' => 'member', 'status' => 'active']);
        $this->seedUser(['role' => 'coordinator', 'status' => 'active']);
        $this->seedUser(['role' => 'member', 'status' => 'active', 'is_tenant_super_admin' => 1]);
        $this->seedUser(['role' => 'member', 'status' => 'active', 'is_admin' => 1]);
        $this->seedUser(['role' => 'member', 'status' => 'active']); // ordinary member: not notified

        $event = new SafeguardingCoordinationRequested(
            tenantId: $this->testTenantId,
            senderId: $sender->id,
            recipientId: $recipient->id,
            reasonCode: 'SAFEGUARDING_CONTACT_RESTRICTED'
        );

        $this->notificationAlias->shouldReceive('create')->times(3);
        $this->emailAlias->shouldReceive('sendRaw')->times(3)->andReturn(true);

        (new NotifySafeguardingCoordinationRequested())->handle($event);

        $this->assertTrue(true);
    }

    private function seedUser(array $overrides = [], ?int $tenantId = null): object
    {
        $tenantId = $tenantId ?? $this->testTenantId;
        $unique = uniqid('u_', true);

        $data = array_merge([
            'tenant_id' => $tenantId,
            'name' => 'Test User ' . $unique,
            'first_name' => 'Test',
            'last_name' => 'User',
            'email' => $unique . '@example.com',
            'role' => 'member',
            'status' => 'active',
            'preferred_language' => 'en',
            'is_approved' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ], $overrides);

        $id = DB::table('users')->insertGetId($data);

        return (object) array_merge($data, ['id' => $id]);
    }
}
