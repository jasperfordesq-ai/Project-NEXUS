<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\AI;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\Tools\SemanticSearchTool;
use App\Services\EmbeddingService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class SemanticSearchToolTest extends TestCase
{
    public function test_empty_query_returns_err(): void
    {
        $tool = new SemanticSearchTool();
        // Tenant scope is required for execute() to even reach the empty-query
        // guard. Stub it via TenantContext only if available; otherwise expect
        // a runtime exception that we still treat as a failure case.
        $this->markTestSkipped('Tenant context bootstrap required — covered by integration suite.');
    }

    public function test_describes_itself_with_function_schema(): void
    {
        $tool = new SemanticSearchTool();
        $schema = $tool->toOpenAiFunction();

        $this->assertSame('function', $schema['type']);
        $this->assertSame('semantic_search', $schema['function']['name']);
        $this->assertArrayHasKey('query', $schema['function']['parameters']['properties']);
        $this->assertContains('query', $schema['function']['parameters']['required']);
    }

    public function test_hydration_skips_hits_with_missing_source_rows(): void
    {
        // The hydrate step joins back to source tables. If a hit references a
        // row that no longer exists (e.g. deleted between embed and search),
        // the result must be silently dropped rather than producing a card
        // with null fields.
        $service = $this->createMock(EmbeddingService::class);
        $service->method('semanticSearch')->willReturn([
            ['content_type' => 'listing', 'content_id' => 999999, 'score' => 0.9],
        ]);

        $this->markTestSkipped('Tenant context bootstrap + DB fixtures required — covered by integration suite.');
    }

    public function test_semantic_search_filters_non_public_listing_hits(): void
    {
        TenantContext::setById($this->testTenantId);
        $this->assertSame($this->testTenantId, TenantContext::getId());
        $owner = null;
        $listingIds = [];

        try {
            $owner = User::factory()->forTenant($this->testTenantId)->create();

            $visibleId = DB::table('listings')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'user_id' => $owner->id,
                'title' => 'Visible gardening help',
                'description' => 'Raised beds and pruning',
                'type' => 'offer',
                'status' => 'active',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $hiddenId = DB::table('listings')->insertGetId([
                'tenant_id' => $this->testTenantId,
                'user_id' => $owner->id,
                'title' => 'Hidden draft listing',
                'description' => 'This draft should not be returned',
                'type' => 'offer',
                'status' => 'inactive',
                'moderation_status' => 'approved',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $listingIds = [$visibleId, $hiddenId];
            $this->assertSame(2, DB::table('listings')->whereIn('id', $listingIds)->count());

            $service = new class($hiddenId, $visibleId) extends EmbeddingService {
                public function __construct(private readonly int $hiddenId, private readonly int $visibleId) {}

                public function semanticSearch(string $query, int $tenantId, array $contentTypes = [], int $limit = 10, int $candidateCap = 2000, ?callable $beforeProviderCall = null): array
                {
                    return [
                        ['content_type' => 'listing', 'content_id' => $this->hiddenId, 'score' => 0.99],
                        ['content_type' => 'listing', 'content_id' => $this->visibleId, 'score' => 0.9],
                    ];
                }
            };
            $this->assertSame(
                [$hiddenId, $visibleId],
                array_column($service->semanticSearch('gardening', $this->testTenantId, ['listing']), 'content_id')
            );

            $tool = new SemanticSearchTool($service);
            TenantContext::setById($this->testTenantId);
            $result = $tool->execute([
                'query' => 'gardening',
                'types' => ['listing'],
            ], 42);

            $this->assertTrue($result['ok']);
            $this->assertSame([$visibleId], array_column($result['results'], 'id'));
        } finally {
            if ($listingIds !== []) {
                DB::table('listings')->whereIn('id', $listingIds)->delete();
            }
            if ($owner !== null) {
                DB::table('users')->where('id', $owner->id)->delete();
            }
        }
    }

    public function test_semantic_search_revalidates_event_lifecycle_and_template_visibility(): void
    {
        TenantContext::setById($this->testTenantId);
        $owner = User::factory()->forTenant($this->testTenantId)->create();
        $eventIds = [];

        try {
            $insert = function (string $title, array $overrides = []) use ($owner, &$eventIds): int {
                $id = (int) DB::table('events')->insertGetId(array_merge([
                    'tenant_id' => $this->testTenantId,
                    'user_id' => (int) $owner->id,
                    'title' => $title,
                    'description' => $title,
                    'status' => 'active',
                    'publication_status' => 'published',
                    'operational_status' => 'scheduled',
                    'lifecycle_version' => 1,
                    'is_recurring_template' => 0,
                    'start_time' => now()->addWeek(),
                    'end_time' => now()->addWeek()->addHour(),
                    'created_at' => now(),
                    'updated_at' => now(),
                ], $overrides));
                $eventIds[] = $id;

                return $id;
            };

            $scheduled = $insert('Semantic visible scheduled');
            $postponed = $insert('Semantic visible postponed', [
                'status' => 'cancelled',
                'operational_status' => 'postponed',
            ]);
            $draft = $insert('Semantic hidden draft', [
                'status' => 'draft',
                'publication_status' => 'draft',
            ]);
            $cancelled = $insert('Semantic hidden cancelled', [
                'status' => 'cancelled',
                'operational_status' => 'cancelled',
            ]);
            $template = $insert('Semantic hidden template', ['is_recurring_template' => 1]);

            $service = new class($draft, $scheduled, $cancelled, $postponed, $template) extends EmbeddingService {
                /** @var list<int> */
                private readonly array $ids;

                public function __construct(int ...$ids)
                {
                    $this->ids = $ids;
                }

                public function semanticSearch(string $query, int $tenantId, array $contentTypes = [], int $limit = 10, int $candidateCap = 2000, ?callable $beforeProviderCall = null): array
                {
                    return array_map(
                        static fn (int $id, int $rank): array => [
                            'content_type' => 'event',
                            'content_id' => $id,
                            'score' => 1 - ($rank / 10),
                        ],
                        $this->ids,
                        array_keys($this->ids),
                    );
                }
            };

            $result = (new SemanticSearchTool($service))->execute([
                'query' => 'community events',
                'types' => ['event'],
                'limit' => 8,
            ], (int) $owner->id);

            $this->assertTrue($result['ok']);
            $this->assertSame([$scheduled, $postponed], array_column($result['results'], 'id'));
        } finally {
            if ($eventIds !== []) {
                DB::table('events')->whereIn('id', $eventIds)->delete();
            }
            DB::table('users')->where('id', $owner->id)->delete();
        }
    }

    /**
     * The `user` arm of SemanticSearchTool::applyVisibilityFilters() is the
     * second AI path that returns members. It filtered only on `status` and
     * "not the caller", so a member who switched off `privacy_search` was
     * still hydrated into a member card — name, tagline, location and a direct
     * profile link — for anyone who asked the assistant. Every other arm of
     * that switch carries the real visibility rule for its type; this one now
     * does too.
     */
    public function test_semantic_search_excludes_members_who_opted_out_of_member_search(): void
    {
        TenantContext::setById($this->testTenantId);
        $listed = User::factory()->forTenant($this->testTenantId)->create(['privacy_search' => 1]);
        $optedOut = User::factory()->forTenant($this->testTenantId)->create(['privacy_search' => 0]);

        try {
            $service = new class((int) $optedOut->id, (int) $listed->id) extends EmbeddingService {
                public function __construct(private readonly int $optedOutId, private readonly int $listedId) {}

                public function semanticSearch(string $query, int $tenantId, array $contentTypes = [], int $limit = 10, int $candidateCap = 2000, ?callable $beforeProviderCall = null): array
                {
                    return [
                        ['content_type' => 'user', 'content_id' => $this->optedOutId, 'score' => 0.99],
                        ['content_type' => 'user', 'content_id' => $this->listedId, 'score' => 0.9],
                    ];
                }
            };

            $result = (new SemanticSearchTool($service))->execute([
                'query' => 'who can help with gardening',
                'types' => ['user'],
            ], 424242);

            $this->assertTrue($result['ok']);
            $this->assertSame(
                [(int) $listed->id],
                array_column($result['results'], 'id'),
                'A member with privacy_search = 0 must not be hydrated into a semantic-search member card.'
            );
        } finally {
            DB::table('users')->whereIn('id', [$listed->id, $optedOut->id])->delete();
        }
    }

    public function test_semantic_search_honours_connections_only_profile_visibility(): void
    {
        TenantContext::setById($this->testTenantId);
        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        $restricted = User::factory()->forTenant($this->testTenantId)->create([
            'privacy_profile' => 'connections',
            'privacy_search' => 1,
        ]);

        try {
            $service = new class((int) $restricted->id) extends EmbeddingService {
                public function __construct(private readonly int $restrictedId) {}

                public function semanticSearch(string $query, int $tenantId, array $contentTypes = [], int $limit = 10, int $candidateCap = 2000, ?callable $beforeProviderCall = null): array
                {
                    return [[
                        'content_type' => 'user',
                        'content_id' => $this->restrictedId,
                        'score' => 0.99,
                    ]];
                }
            };

            $tool = new SemanticSearchTool($service);
            $unrelated = $tool->execute([
                'query' => 'member profile',
                'types' => ['user'],
            ], (int) $viewer->id);

            $this->assertTrue($unrelated['ok']);
            $this->assertSame([], $unrelated['results']);

            DB::table('connections')->insert([
                'tenant_id' => $this->testTenantId,
                // Reverse orientation from SearchMembersToolTest: accepted
                // connections must work regardless of who sent the request.
                'requester_id' => (int) $restricted->id,
                'receiver_id' => (int) $viewer->id,
                'status' => 'accepted',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $connected = $tool->execute([
                'query' => 'member profile',
                'types' => ['user'],
            ], (int) $viewer->id);

            $this->assertTrue($connected['ok']);
            $this->assertSame([(int) $restricted->id], array_column($connected['results'], 'id'));
        } finally {
            DB::table('connections')
                ->where('tenant_id', $this->testTenantId)
                ->where(function ($query) use ($viewer, $restricted) {
                    $query->where(function ($pair) use ($viewer, $restricted) {
                        $pair->where('requester_id', $viewer->id)->where('receiver_id', $restricted->id);
                    })->orWhere(function ($pair) use ($viewer, $restricted) {
                        $pair->where('requester_id', $restricted->id)->where('receiver_id', $viewer->id);
                    });
                })
                ->delete();
            DB::table('users')->whereIn('id', [$viewer->id, $restricted->id])->delete();
        }
    }

    public function test_semantic_search_excludes_members_blocked_in_either_direction(): void
    {
        TenantContext::setById($this->testTenantId);
        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        $target = User::factory()->forTenant($this->testTenantId)->create([
            'privacy_profile' => 'public',
            'privacy_search' => 1,
        ]);

        try {
            DB::table('user_blocks')->insert([
                'tenant_id' => $this->testTenantId,
                'user_id' => (int) $viewer->id,
                'blocked_user_id' => (int) $target->id,
                'created_at' => now(),
            ]);

            $service = new class((int) $target->id) extends EmbeddingService {
                public function __construct(private readonly int $targetId) {}

                public function semanticSearch(string $query, int $tenantId, array $contentTypes = [], int $limit = 10, int $candidateCap = 2000, ?callable $beforeProviderCall = null): array
                {
                    return [[
                        'content_type' => 'user',
                        'content_id' => $this->targetId,
                        'score' => 0.99,
                    ]];
                }
            };

            $result = (new SemanticSearchTool($service))->execute([
                'query' => 'member profile',
                'types' => ['user'],
            ], (int) $viewer->id);

            $this->assertTrue($result['ok']);
            $this->assertSame([], $result['results']);
        } finally {
            DB::table('user_blocks')
                ->where('tenant_id', $this->testTenantId)
                ->where(function ($query) use ($viewer, $target) {
                    $query->where(function ($pair) use ($viewer, $target) {
                        $pair->where('user_id', $viewer->id)->where('blocked_user_id', $target->id);
                    })->orWhere(function ($pair) use ($viewer, $target) {
                        $pair->where('user_id', $target->id)->where('blocked_user_id', $viewer->id);
                    });
                })
                ->delete();
            DB::table('users')->whereIn('id', [$viewer->id, $target->id])->delete();
        }
    }
}
