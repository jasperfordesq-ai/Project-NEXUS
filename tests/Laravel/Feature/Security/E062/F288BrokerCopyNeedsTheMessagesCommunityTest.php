<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E062;

use App\Core\TenantContext;
use App\Events\MessageSent;
use App\Listeners\CopyMessageForBrokerReview;
use App\Models\Message;
use App\Models\User;
use App\Services\BrokerMessageVisibilityService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * F-288 (E-062) — CopyMessageForBrokerReview set the tenant context only when
 * the event carried a truthy tenant id, and ignored TenantContext::setById()'s
 * false return. When the message's community could not be established it went
 * on to run the broker-review rules under whatever community the worker was
 * last left in: the rule lookups (monitoring, first contact) read and wrote
 * that OTHER community's rows. Every sibling listener, and the group-message
 * job for the same feature, bails instead.
 *
 * Control: with the message's real community, the rules still run, under
 * that community.
 */
class F288BrokerCopyNeedsTheMessagesCommunityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Cache::flush();
    }

    public function test_the_rules_do_not_run_when_the_messages_community_no_longer_exists(): void
    {
        $missingTenantId = (int) DB::table('tenants')->max('id') + 1000;

        $service = \Mockery::mock(BrokerMessageVisibilityService::class);
        $service->shouldNotReceive('shouldCopyMessage');
        $service->shouldNotReceive('copyMessageForBroker');
        $this->app->instance(BrokerMessageVisibilityService::class, $service);

        // The worker was last left in another community.
        TenantContext::setById($this->testTenantId);

        (new CopyMessageForBrokerReview())->handle($this->event(77001, $missingTenantId));

        $this->addToAssertionCount(1);
    }

    public function test_the_rules_do_not_run_without_a_community_at_all(): void
    {
        $service = \Mockery::mock(BrokerMessageVisibilityService::class);
        $service->shouldNotReceive('shouldCopyMessage');
        $service->shouldNotReceive('copyMessageForBroker');
        $this->app->instance(BrokerMessageVisibilityService::class, $service);

        TenantContext::setById($this->testTenantId);

        (new CopyMessageForBrokerReview())->handle($this->event(77002, 0));

        $this->addToAssertionCount(1);
    }

    public function test_control_the_rules_still_run_under_the_messages_own_community(): void
    {
        $seenTenant = null;
        $service = \Mockery::mock(BrokerMessageVisibilityService::class);
        $service->shouldReceive('shouldCopyMessage')
            ->once()
            ->andReturnUsing(function () use (&$seenTenant) {
                $seenTenant = (int) TenantContext::getId();
                return 'first_contact';
            });
        $service->shouldReceive('copyMessageForBroker')->once()->with(77003, 'first_contact');
        $this->app->instance(BrokerMessageVisibilityService::class, $service);

        TenantContext::setById(1);

        (new CopyMessageForBrokerReview())->handle($this->event(77003, $this->testTenantId));

        $this->assertSame($this->testTenantId, $seenTenant);
    }

    private function event(int $messageId, int $tenantId): MessageSent
    {
        $sender = User::factory()->forTenant($this->testTenantId)->create();
        $receiver = User::factory()->forTenant($this->testTenantId)->create();

        $message = new Message([
            'sender_id' => $sender->id,
            'receiver_id' => $receiver->id,
            'body' => 'F288',
            'listing_id' => null,
        ]);
        $message->id = $messageId;
        $message->tenant_id = $tenantId;
        $message->exists = true;

        return new MessageSent($message, $sender, 1, $tenantId);
    }
}
