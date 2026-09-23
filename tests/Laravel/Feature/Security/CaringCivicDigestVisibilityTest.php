<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\CaringCommunity\CivicDigestService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * F-129 — the civic digest (in-app and email) must apply the same audience
 * rules as the source surfaces: events from private/secret groups only reach
 * that group's members, and targeted safety alerts only reach their targets.
 */
class CaringCivicDigestVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        TenantContext::setById($this->testTenantId);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    private function group(int $ownerId, string $visibility): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $ownerId,
            'name' => 'Digest group ' . $visibility . ' ' . uniqid(),
            'visibility' => $visibility,
            'status' => 'active',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function event(int $ownerId, ?int $groupId, string $title): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'group_id' => $groupId,
            'title' => $title,
            'description' => 'Digest visibility test event.',
            'start_time' => now()->addDays(3)->format('Y-m-d H:i:s'),
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @return list<string> */
    private function digestIds(int $userId): array
    {
        $items = app(CivicDigestService::class)->digestForMember($this->testTenantId, $userId, 200);

        return array_map(static fn (array $item): string => (string) $item['id'], $items);
    }

    public function test_private_and_secret_group_events_reach_only_group_members(): void
    {
        if (! Schema::hasTable('events') || ! Schema::hasTable('groups')) {
            $this->markTestSkipped('events/groups tables missing');
        }

        $owner = $this->member();
        $groupMember = $this->member();
        $outsider = $this->member();

        $privateGroup = $this->group($owner->id, 'private');
        $secretGroup = $this->group($owner->id, 'secret');
        $publicGroup = $this->group($owner->id, 'public');
        DB::table('group_members')->insert([
            ['tenant_id' => $this->testTenantId, 'group_id' => $privateGroup, 'user_id' => $groupMember->id, 'status' => 'active', 'role' => 'member', 'created_at' => now()],
            ['tenant_id' => $this->testTenantId, 'group_id' => $secretGroup, 'user_id' => $groupMember->id, 'status' => 'active', 'role' => 'member', 'created_at' => now()],
        ]);

        $openEvent = $this->event($owner->id, null, 'Open community event');
        $publicGroupEvent = $this->event($owner->id, $publicGroup, 'Public group event');
        $privateEvent = $this->event($owner->id, $privateGroup, 'Private group event');
        $secretEvent = $this->event($owner->id, $secretGroup, 'Secret group event');

        $outsiderIds = $this->digestIds($outsider->id);
        // Controls: events without a group, and public-group events, reach everyone.
        $this->assertContains('event:' . $openEvent, $outsiderIds);
        $this->assertContains('event:' . $publicGroupEvent, $outsiderIds);
        // Private/secret group events do not reach non-members.
        $this->assertNotContains('event:' . $privateEvent, $outsiderIds);
        $this->assertNotContains('event:' . $secretEvent, $outsiderIds);

        // Control: an active member of those groups still receives them.
        $memberIds = $this->digestIds($groupMember->id);
        $this->assertContains('event:' . $privateEvent, $memberIds);
        $this->assertContains('event:' . $secretEvent, $memberIds);
    }

    public function test_targeted_safety_alerts_reach_only_their_targets(): void
    {
        if (! Schema::hasTable('caring_emergency_alerts')) {
            $this->markTestSkipped('caring_emergency_alerts table missing');
        }

        $target = $this->member();
        $bystander = $this->member();

        $insert = fn (string $title, ?array $targets): int => (int) DB::table('caring_emergency_alerts')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'title' => $title,
            'body' => 'Body of ' . $title,
            'severity' => 'warning',
            'target_user_ids' => $targets === null ? null : json_encode($targets),
            'is_active' => 1,
            'push_sent' => 1,
            'sent_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $tenantWide = $insert('Tenant-wide alert', null);
        $targeted = $insert('Targeted welfare alert', [$target->id]);

        $bystanderIds = $this->digestIds($bystander->id);
        $this->assertContains('safety_alert:' . $tenantWide, $bystanderIds, 'Control: untargeted alerts reach everyone.');
        $this->assertNotContains('safety_alert:' . $targeted, $bystanderIds);

        $targetIds = $this->digestIds($target->id);
        $this->assertContains('safety_alert:' . $targeted, $targetIds, 'Control: the target still receives it.');
        $this->assertContains('safety_alert:' . $tenantWide, $targetIds);
    }
}
