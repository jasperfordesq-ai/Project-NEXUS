<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\PusherService;
use App\Core\TenantContext;
use Mockery;

class PusherServiceTest extends TestCase
{
    private PusherService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new PusherService();
        // Reset the static instance between tests
        $ref = new \ReflectionClass(PusherService::class);
        $prop = $ref->getProperty('instance');
        $prop->setAccessible(true);
        $prop->setValue(null, null);
    }

    public function test_getInstance_returns_null_when_not_configured(): void
    {
        config(['broadcasting.connections.pusher.key' => '']);
        config(['broadcasting.connections.pusher.secret' => '']);
        config(['broadcasting.connections.pusher.app_id' => '']);

        $result = PusherService::getInstance();
        $this->assertNull($result);
    }

    public function test_getConfig_returns_expected_keys(): void
    {
        config(['broadcasting.connections.pusher.key' => 'test-key']);
        config(['broadcasting.connections.pusher.secret' => 'test-secret']);
        config(['broadcasting.connections.pusher.app_id' => '12345']);
        config(['broadcasting.connections.pusher.options.cluster' => 'eu']);

        $result = $this->service->getConfig();
        $this->assertEquals('test-key', $result['key']);
        $this->assertEquals('test-secret', $result['secret']);
        $this->assertEquals('12345', $result['app_id']);
        $this->assertEquals('eu', $result['cluster']);
        $this->assertTrue($result['encrypted']);
    }

    public function test_getPublicKey_returns_key(): void
    {
        config(['broadcasting.connections.pusher.key' => 'pub-key-123']);
        $this->assertEquals('pub-key-123', $this->service->getPublicKey());
    }

    public function test_getCluster_defaults_to_eu(): void
    {
        // config/broadcasting.php resolves the cluster from
        // PUSHER_CLUSTER / PUSHER_APP_CLUSTER with a documented 'eu' fallback.
        // With no app-side override the test environment yields that default.
        // (The prior version forced a literal null, which is not the same as
        // an absent key and crashed getCluster()'s string return type.)
        $this->assertEquals('eu', $this->service->getCluster());
    }

    public function test_isConfigured_returns_false_when_empty(): void
    {
        config(['broadcasting.connections.pusher.key' => '']);
        $this->assertFalse($this->service->isConfigured());
    }

    public function test_isConfigured_returns_true_when_all_set(): void
    {
        config(['broadcasting.connections.pusher.key' => 'k']);
        config(['broadcasting.connections.pusher.secret' => 's']);
        config(['broadcasting.connections.pusher.app_id' => 'a']);
        $this->assertTrue($this->service->isConfigured());
    }

    public function test_getUserChannel_returns_correct_format(): void
    {
        // Convention is private-tenant.{tenantId}.user.{userId} to match the
        // React PusherContext subscription format. Base TestCase pins tenant 2.
        $tenantId = TenantContext::getId();
        $this->assertEquals(
            "private-tenant.{$tenantId}.user.42",
            $this->service->getUserChannel(42)
        );
    }

    public function test_getPresenceChannel_includes_tenant_id(): void
    {
        $result = $this->service->getPresenceChannel();
        $this->assertStringStartsWith('presence-tenant.', $result);
    }

    public function test_authPrivateChannel_returns_null_when_not_configured(): void
    {
        config(['broadcasting.connections.pusher.key' => '']);
        config(['broadcasting.connections.pusher.secret' => '']);
        config(['broadcasting.connections.pusher.app_id' => '']);

        $result = $this->service->authPrivateChannel('private-user.1', 'socket123', 1);
        $this->assertNull($result);
    }

    /**
     * The chat channel is where the live `new-message` event is echoed for a
     * pair of members. authorizeChannel() is a local HMAC over the socket id,
     * so these run with dummy keys and no network.
     */
    private function configurePusher(): void
    {
        config(['broadcasting.connections.pusher.key' => 'k']);
        config(['broadcasting.connections.pusher.secret' => 's']);
        config(['broadcasting.connections.pusher.app_id' => 'a']);
    }

    public function test_authPrivateChannel_allows_both_chat_channel_participants(): void
    {
        $this->configurePusher();
        $tenantId = TenantContext::getId();

        $forFive = $this->service->authPrivateChannel("private-tenant.{$tenantId}.chat.5-9", '1234.5678', 5);
        $forNine = $this->service->authPrivateChannel("private-tenant.{$tenantId}.chat.5-9", '1234.5678', 9);

        $this->assertNotNull($forFive);
        $this->assertNotNull($forNine);
        $this->assertArrayHasKey('auth', json_decode($forFive, true));
    }

    public function test_authPrivateChannel_denies_chat_channel_to_a_non_participant(): void
    {
        $this->configurePusher();
        $tenantId = TenantContext::getId();

        $this->assertNull($this->service->authPrivateChannel("private-tenant.{$tenantId}.chat.5-9", '1234.5678', 7));
    }

    public function test_authPrivateChannel_denies_chat_channel_of_another_tenant(): void
    {
        $this->configurePusher();
        $otherTenant = TenantContext::getId() + 1;

        $this->assertNull($this->service->authPrivateChannel("private-tenant.{$otherTenant}.chat.5-9", '1234.5678', 5));
    }

    public function test_authPrivateChannel_denies_another_users_user_channel(): void
    {
        $this->configurePusher();
        $tenantId = TenantContext::getId();

        $this->assertNotNull($this->service->authPrivateChannel("private-tenant.{$tenantId}.user.5", '1234.5678', 5));
        $this->assertNull($this->service->authPrivateChannel("private-tenant.{$tenantId}.user.5", '1234.5678', 9));
    }

    public function test_authPrivateChannel_denies_conversation_channel_without_a_participant_row(): void
    {
        // Documents why the pre-2026-10-17 contract was unreachable: one-to-one
        // chats never write conversation_participants rows, so this channel is
        // refused for everyone. Live one-to-one delivery uses user + chat channels.
        $this->configurePusher();
        $tenantId = TenantContext::getId();

        $this->assertNull($this->service->authPrivateChannel("private-tenant.{$tenantId}.conversation.123456789", '1234.5678', 5));
    }

    public function test_authPresenceChannel_returns_null_when_not_configured(): void
    {
        config(['broadcasting.connections.pusher.key' => '']);
        $result = $this->service->authPresenceChannel('presence-tenant.2', 'socket123', 1);
        $this->assertNull($result);
    }
}
