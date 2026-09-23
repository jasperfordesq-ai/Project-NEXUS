<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\Tools\SearchEventsTool;
use App\Services\AI\Tools\SemanticSearchTool;
use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * F-079 (E-027): the AI assistant's event tools and group audiences.
 *
 * search_events and semantic_search applied EventSearchVisibility's lifecycle
 * rule but not the event's group audience (the F-078 root cause), so the
 * assistant listed events belonging to private and secret groups to members
 * who are not in them. Both tools now apply the viewer-aware audience filter
 * for the chatting member.
 */
final class AiEventToolGroupAudienceTest extends TestCase
{
    use DatabaseTransactions;

    private string $term;

    private User $owner;

    private User $member;

    private User $outsider;

    private int $privateGroupEventId;

    private int $secretGroupEventId;

    private int $publicGroupEventId;

    private int $openEventId;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        TenantContext::setById($this->testTenantId);

        $this->term = 'AiAudience' . bin2hex(random_bytes(4));

        $this->owner = $this->user();
        $this->member = $this->user();
        $this->outsider = $this->user();

        $privateGroupId = $this->group('private');
        $secretGroupId = $this->group('secret');
        $publicGroupId = $this->group('public');
        $this->addMember($privateGroupId, $this->member);

        $this->privateGroupEventId = $this->event('private circle meeting', $privateGroupId);
        $this->secretGroupEventId = $this->event('secret circle meeting', $secretGroupId);
        $this->publicGroupEventId = $this->event('public group meeting', $publicGroupId);
        $this->openEventId = $this->event('community meeting', null);
    }

    public function test_search_events_hides_private_and_secret_group_events_from_non_members(): void
    {
        $result = (new SearchEventsTool())->execute(['query' => $this->term, 'limit' => 8], (int) $this->outsider->id);

        $this->assertEqualsCanonicalizing(
            [$this->publicGroupEventId, $this->openEventId],
            $this->ids($result),
        );
    }

    public function test_search_events_still_shows_group_events_to_their_members_and_owner(): void
    {
        $member = (new SearchEventsTool())->execute(['query' => $this->term, 'limit' => 8], (int) $this->member->id);
        $this->assertEqualsCanonicalizing(
            [$this->privateGroupEventId, $this->publicGroupEventId, $this->openEventId],
            $this->ids($member),
        );

        $owner = (new SearchEventsTool())->execute(['query' => $this->term, 'limit' => 8], (int) $this->owner->id);
        $this->assertEqualsCanonicalizing(
            [$this->privateGroupEventId, $this->secretGroupEventId, $this->publicGroupEventId, $this->openEventId],
            $this->ids($owner),
        );
    }

    public function test_semantic_search_hides_private_and_secret_group_events_from_non_members(): void
    {
        $result = $this->semanticTool()->execute(['query' => 'meeting', 'types' => ['event'], 'limit' => 8], (int) $this->outsider->id);

        $this->assertEqualsCanonicalizing(
            [$this->publicGroupEventId, $this->openEventId],
            $this->ids($result),
        );
    }

    public function test_semantic_search_still_shows_group_events_to_their_members(): void
    {
        $result = $this->semanticTool()->execute(['query' => 'meeting', 'types' => ['event'], 'limit' => 8], (int) $this->member->id);

        $this->assertEqualsCanonicalizing(
            [$this->privateGroupEventId, $this->publicGroupEventId, $this->openEventId],
            $this->ids($result),
        );
    }

    private function semanticTool(): SemanticSearchTool
    {
        $hits = array_map(static fn (int $id): array => [
            'content_type' => 'event',
            'content_id' => $id,
            'score' => 0.9,
        ], [$this->privateGroupEventId, $this->secretGroupEventId, $this->publicGroupEventId, $this->openEventId]);

        $service = $this->createMock(EmbeddingService::class);
        $service->method('semanticSearch')->willReturn($hits);

        return new SemanticSearchTool($service);
    }

    /** @return list<int> */
    private function ids(array $result): array
    {
        $this->assertTrue((bool) ($result['ok'] ?? $result['success'] ?? true), json_encode($result) ?: '');
        $items = $result['items'] ?? $result['results'] ?? $result['data'] ?? [];

        return array_values(array_map(static fn (array $item): int => (int) $item['id'], $items));
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'email_verified_at' => now(),
        ]);
    }

    private function group(string $visibility): int
    {
        $groupId = (int) DB::table('groups')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'owner_id' => $this->owner->id,
            'name' => ucfirst($visibility) . ' circle for ' . $this->term,
            'description' => 'Circle ' . $this->term,
            'visibility' => $visibility,
            'status' => 'active',
            'is_active' => 1,
            'created_at' => now(),
        ]);
        $this->addMember($groupId, $this->owner, 'owner');

        return $groupId;
    }

    private function addMember(int $groupId, User $user, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => 'active',
        ]);
    }

    private function event(string $title, ?int $groupId): int
    {
        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $this->owner->id,
            'group_id' => $groupId,
            'title' => $this->term . ' ' . $title,
            'description' => $this->term . ' ' . $title . ' description',
            'location' => 'Online',
            'is_online' => 1,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'is_recurring_template' => 0,
            'start_time' => now()->addWeek(),
            'end_time' => now()->addWeek()->addHour(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
