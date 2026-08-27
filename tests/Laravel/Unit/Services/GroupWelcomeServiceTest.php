<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Enums\GroupStatus;
use App\Models\Group;
use App\Models\User;
use App\Services\GroupWelcomeService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class GroupWelcomeServiceTest extends TestCase
{
    use DatabaseTransactions;

    /** @return array{group: Group, owner: User, member: User} */
    private function welcomeFixture(): array
    {
        // Set the NAME PARTS, not `name`: UserObserver::saving() recomputes the
        // stored `name` column from first_name/last_name, so a `name` passed to
        // the factory is overwritten by the faker-generated parts beside it.
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Admin',
            'last_name' => 'Bob',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $member = User::factory()->forTenant($this->testTenantId)->create([
            'first_name' => 'Alice',
            'last_name' => '',
            'status' => 'active',
            'is_approved' => true,
        ]);
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'name' => 'Timebank',
            'status' => GroupStatus::Active->value,
            'is_active' => true,
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $group->id,
            'user_id' => $member->id,
            'role' => 'member',
            'status' => 'active',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return compact('group', 'owner', 'member');
    }

    // ── getConfig ────────────────────────────────────────────────────

    public function test_getConfig_returns_default_disabled_when_no_policies(): void
    {
        DB::shouldReceive('table')->with('group_policies')->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', $this->testTenantId)->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturnSelf();
        DB::shouldReceive('toArray')->andReturn([]);

        $result = GroupWelcomeService::getConfig(1);
        $this->assertFalse($result['enabled']);
        $this->assertSame('', $result['message']);
    }

    public function test_getConfig_returns_enabled_and_message_from_policies(): void
    {
        DB::shouldReceive('table')->with('group_policies')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('whereIn')->andReturnSelf();
        DB::shouldReceive('pluck')->andReturnSelf();
        DB::shouldReceive('toArray')->andReturn([
            'welcome_message_enabled_5' => json_encode(true),
            'welcome_message_5' => json_encode('Hello {member_name}!'),
        ]);

        $result = GroupWelcomeService::getConfig(5);
        $this->assertTrue($result['enabled']);
        $this->assertSame('Hello {member_name}!', $result['message']);
    }

    // ── setConfig ────────────────────────────────────────────────────

    public function test_setConfig_upserts_both_enabled_and_message_rows(): void
    {
        DB::shouldReceive('table')->with('group_policies')->twice()->andReturnSelf();
        DB::shouldReceive('updateOrInsert')->twice();

        GroupWelcomeService::setConfig(1, true, 'Welcome!');
        $this->assertTrue(true);
    }

    // ── sendWelcome: disabled / missing config ───────────────────────

    public function test_sendWelcome_returns_false_when_disabled(): void
    {
        ['group' => $group, 'member' => $member] = $this->welcomeFixture();

        $this->assertFalse(GroupWelcomeService::sendWelcome((int) $group->id, (int) $member->id));
        $this->assertDatabaseMissing('notifications', [
            'tenant_id' => $this->testTenantId,
            'user_id' => $member->id,
            'type' => 'group_welcome',
        ]);
    }

    public function test_sendWelcome_returns_false_when_user_or_group_missing(): void
    {
        ['group' => $group, 'member' => $member] = $this->welcomeFixture();
        GroupWelcomeService::setConfig((int) $group->id, true, 'Hi');

        $this->assertFalse(GroupWelcomeService::sendWelcome((int) $group->id, 99999999));
        $this->assertFalse(GroupWelcomeService::sendWelcome(99999999, (int) $member->id));
    }

    public function test_sendWelcome_inserts_notification_and_substitutes_vars(): void
    {
        ['group' => $group, 'member' => $member] = $this->welcomeFixture();
        GroupWelcomeService::setConfig(
            (int) $group->id,
            true,
            'Hi {member_name}, welcome to {group_name} from {admin_name}',
        );

        $this->assertTrue(GroupWelcomeService::sendWelcome((int) $group->id, (int) $member->id));
        $notification = DB::table('notifications')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', $member->id)
            ->where('type', 'group_welcome')
            ->first();
        $this->assertNotNull($notification);
        $this->assertSame(
            'Hi Alice, welcome to Timebank from Admin Bob',
            (string) $notification->message,
        );
        $this->assertSame('/groups/' . $group->id, (string) $notification->link);
    }
}
