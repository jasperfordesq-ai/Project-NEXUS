<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Core\TenantContext;
use App\Enums\GroupStatus;
use App\Models\User;
use App\Services\GroupConfigurationService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupWikiControllerTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $nonMember;
    private User $pendingMember;
    private User $member;
    private User $author;
    private User $otherAuthor;
    private User $groupAdmin;
    private User $tenantAdmin;
    private User $foreignOwner;
    private int $groupId;
    private int $otherGroupId;
    private int $dormantGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->owner = $this->user();
        $this->nonMember = $this->user();
        $this->pendingMember = $this->user();
        $this->member = $this->user();
        $this->author = $this->user();
        $this->otherAuthor = $this->user();
        $this->groupAdmin = $this->user();
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        $this->foreignOwner = User::factory()->forTenant(999)->create();

        $this->groupId = $this->group(GroupStatus::Active, $this->owner);
        $this->otherGroupId = $this->group(GroupStatus::Active, $this->owner);
        $this->dormantGroupId = $this->group(GroupStatus::Dormant, $this->owner);
        $this->archivedGroupId = $this->group(GroupStatus::Archived, $this->owner);
        $this->foreignGroupId = $this->group(GroupStatus::Active, $this->foreignOwner, 999);

        foreach ([$this->groupId, $this->otherGroupId, $this->dormantGroupId, $this->archivedGroupId] as $groupId) {
            $this->membership($groupId, $this->pendingMember, 'member', 'pending');
            $this->membership($groupId, $this->member);
            $this->membership($groupId, $this->author);
            $this->membership($groupId, $this->otherAuthor);
            $this->membership($groupId, $this->groupAdmin, 'admin');
        }

        $this->enableGroupRoutes(GroupConfigurationService::CONFIG_TAB_WIKI);
    }

    protected function tearDown(): void
    {
        Cache::forget('group_config:' . $this->testTenantId);
        parent::tearDown();
    }

    public function test_all_wiki_routes_require_authentication(): void
    {
        $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertUnauthorized();
        $this->apiPost("/v2/groups/{$this->groupId}/wiki", [])->assertUnauthorized();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/page")->assertUnauthorized();
        $this->apiPut("/v2/groups/{$this->groupId}/wiki/1", [])->assertUnauthorized();
        $this->apiDelete("/v2/groups/{$this->groupId}/wiki/1")->assertUnauthorized();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/1/revisions")->assertUnauthorized();
    }

    public function test_published_pages_require_active_membership_and_drafts_are_editor_or_admin_only(): void
    {
        $published = $this->page($this->groupId, $this->author, true, 'published');
        $authorDraft = $this->page($this->groupId, $this->author, false, 'author-draft');
        $otherDraft = $this->page($this->groupId, $this->otherAuthor, false, 'other-draft');

        $this->authenticate($this->nonMember);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertForbidden();

        $this->authenticate($this->pendingMember);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertForbidden();

        $this->authenticate($this->member);
        $memberList = $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertOk();
        self::assertSame([$published], $this->responseIds($memberList->json('data')));
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/published")->assertOk();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/author-draft")->assertNotFound();

        $this->authenticate($this->author);
        $authorIds = $this->responseIds(
            $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertOk()->json('data'),
        );
        self::assertEqualsCanonicalizing([$published, $authorDraft], $authorIds);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/author-draft")->assertOk();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/other-draft")->assertNotFound();

        foreach ([$this->groupAdmin, $this->owner, $this->tenantAdmin] as $manager) {
            $this->authenticate($manager);
            $ids = $this->responseIds(
                $this->apiGet("/v2/groups/{$this->groupId}/wiki")->assertOk()->json('data'),
            );
            self::assertEqualsCanonicalizing([$published, $authorDraft, $otherDraft], $ids);
        }
    }

    public function test_revision_history_is_editor_or_admin_only_and_draft_ids_are_concealed(): void
    {
        $published = $this->page($this->groupId, $this->author, true, 'published-history');
        $draft = $this->page($this->groupId, $this->author, false, 'draft-history');

        $this->authenticate($this->member);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$published}/revisions")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$draft}/revisions")->assertNotFound();

        $this->authenticate($this->author);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$published}/revisions")
            ->assertOk()
            ->assertJsonCount(1, 'data');
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$draft}/revisions")
            ->assertOk()
            ->assertJsonCount(1, 'data');

        $this->authenticate($this->groupAdmin);
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$draft}/revisions")->assertOk();
    }

    public function test_lifecycle_and_tenant_boundaries_apply_to_every_parent_and_child_lookup(): void
    {
        $otherPage = $this->page($this->otherGroupId, $this->author, true, 'other-group-page');
        $foreignPage = $this->page($this->foreignGroupId, $this->foreignOwner, true, 'foreign-page', null, 999);

        $this->authenticate($this->member);
        $this->apiGet("/v2/groups/{$this->dormantGroupId}/wiki")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/wiki")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->foreignGroupId}/wiki")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/other-group-page")->assertNotFound();
        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$otherPage}", ['title' => 'No'])->assertNotFound();
        $this->apiGet("/v2/groups/{$this->groupId}/wiki/{$foreignPage}/revisions")->assertNotFound();

        $this->authenticate($this->author);
        $this->apiPost("/v2/groups/{$this->archivedGroupId}/wiki", [
            'title' => 'Archived write',
            'content' => 'Must not persist.',
        ])->assertForbidden();

        $this->authenticate($this->tenantAdmin);
        $this->apiGet("/v2/groups/{$this->dormantGroupId}/wiki")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/wiki")->assertForbidden();
    }

    public function test_create_update_revision_and_optimistic_conflict_are_atomic(): void
    {
        $this->authenticate($this->nonMember);
        $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            'title' => 'No access',
            'content' => 'Denied.',
        ])->assertForbidden();

        $this->authenticate($this->author);
        $first = $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            'title' => 'Field Guide',
            'content' => 'Initial content',
            'is_published' => false,
        ])->assertCreated();
        $pageId = (int) $first->json('data.id');
        $initialTimestamp = (string) $first->json('data.updated_at');
        self::assertSame('field-guide', $first->json('data.slug'));

        $second = $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            'title' => 'Field Guide',
            'content' => 'Another page',
        ])->assertCreated();
        self::assertSame('field-guide-2', $second->json('data.slug'));

        $this->authenticate($this->member);
        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$pageId}", [
            'content' => 'Unauthorised edit',
        ])->assertForbidden();

        $this->authenticate($this->author);
        $updated = $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$pageId}", [
            'content' => 'Author revision',
            'change_summary' => 'Clarify the guide',
            'expected_updated_at' => $initialTimestamp,
        ])->assertOk();
        $updatedTimestamp = (string) $updated->json('data.updated_at');
        self::assertNotSame($initialTimestamp, $updatedTimestamp);
        self::assertSame(2, DB::table('group_wiki_revisions')->where('page_id', $pageId)->count());

        $this->authenticate($this->groupAdmin);
        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$pageId}", [
            'content' => 'Administrator revision',
            'is_published' => true,
            'expected_updated_at' => $updatedTimestamp,
        ])->assertOk();
        self::assertSame(3, DB::table('group_wiki_revisions')->where('page_id', $pageId)->count());

        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$pageId}", [
            'content' => 'Stale overwrite',
            'expected_updated_at' => $initialTimestamp,
        ])->assertConflict();
        self::assertSame(
            'Administrator revision',
            DB::table('group_wiki_pages')->where('id', $pageId)->value('content'),
        );
        self::assertSame(3, DB::table('group_wiki_revisions')->where('page_id', $pageId)->count());

        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$pageId}", ['title' => ''])
            ->assertUnprocessable();
    }

    public function test_page_creation_replays_one_page_and_initial_revision_after_response_loss(): void
    {
        $this->authenticate($this->author);
        $payload = [
            'title' => 'Durable field guide',
            'content' => 'This exact operation must create one page.',
            'idempotency_key' => 'group-wiki-page-replay-1',
        ];
        $headers = ['Idempotency-Key' => $payload['idempotency_key']];

        $first = $this->apiPost("/v2/groups/{$this->groupId}/wiki", $payload, $headers)->assertCreated();
        $replay = $this->apiPost("/v2/groups/{$this->groupId}/wiki", $payload, $headers)->assertCreated();

        self::assertSame($first->json('data.id'), $replay->json('data.id'));
        self::assertSame(1, DB::table('group_wiki_pages')->where('id', $first->json('data.id'))->count());
        self::assertSame(1, DB::table('group_wiki_revisions')->where('page_id', $first->json('data.id'))->count());

        $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            ...$payload,
            'content' => 'Changed content cannot reuse the operation.',
        ], $headers)->assertConflict();
    }

    public function test_parent_cycles_cross_group_parents_and_delete_children_resolve_to_safe_statuses(): void
    {
        $parent = $this->page($this->groupId, $this->author, true, 'parent');
        $child = $this->page($this->groupId, $this->author, true, 'child', $parent);
        $otherParent = $this->page($this->otherGroupId, $this->author, true, 'other-parent');
        $privateParent = $this->page($this->groupId, $this->otherAuthor, false, 'private-parent');

        $this->authenticate($this->author);
        $this->apiPut("/v2/groups/{$this->groupId}/wiki/{$parent}", ['parent_id' => $child])
            ->assertConflict();
        $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            'title' => 'Cross group child',
            'content' => 'Invalid parent.',
            'parent_id' => $otherParent,
        ])->assertNotFound();
        $this->apiPost("/v2/groups/{$this->groupId}/wiki", [
            'title' => 'Hidden parent child',
            'content' => 'Invalid parent.',
            'parent_id' => $privateParent,
        ])->assertNotFound();

        $this->authenticate($this->groupAdmin);
        $this->apiDelete("/v2/groups/{$this->groupId}/wiki/{$parent}")->assertConflict();

        $this->authenticate($this->member);
        $this->apiDelete("/v2/groups/{$this->groupId}/wiki/{$child}")->assertForbidden();

        $this->authenticate($this->groupAdmin);
        $this->apiDelete("/v2/groups/{$this->groupId}/wiki/{$child}")->assertOk();
        $this->apiDelete("/v2/groups/{$this->groupId}/wiki/{$parent}")->assertOk();
        self::assertFalse(DB::table('group_wiki_revisions')->whereIn('page_id', [$parent, $child])->exists());
    }

    private function authenticate(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function enableGroupRoutes(string $tabConfigKey): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('features');
        $features = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $features['groups'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode($features, JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
        GroupConfigurationService::set($tabConfigKey, true);
    }

    /** @param mixed $rows @return list<int> */
    private function responseIds(mixed $rows): array
    {
        if (! is_array($rows)) {
            return [];
        }

        return array_values(array_map(static fn (array $row): int => (int) $row['id'], $rows));
    }

    private function user(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create();
    }

    private function group(GroupStatus $status, User $owner, ?int $tenantId = null): int
    {
        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'owner_id' => $owner->id,
            'name' => 'Wiki test ' . uniqid('', true),
            'description' => 'Wiki policy fixture.',
            'visibility' => 'private',
            'status' => $status->value,
            'is_active' => $status->legacyIsActive(),
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function membership(
        int $groupId,
        User $user,
        string $role = 'member',
        string $status = 'active',
    ): void {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'role' => $role,
            'status' => $status,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function page(
        int $groupId,
        User $creator,
        bool $published,
        string $slug,
        ?int $parentId = null,
        ?int $tenantId = null,
    ): int {
        $tenantId ??= $this->testTenantId;
        $now = now()->toDateTimeString();
        $pageId = (int) DB::table('group_wiki_pages')->insertGetId([
            'tenant_id' => $tenantId,
            'group_id' => $groupId,
            'parent_id' => $parentId,
            'title' => ucwords(str_replace('-', ' ', $slug)),
            'slug' => $slug,
            'content' => 'Wiki content for ' . $slug,
            'created_by' => $creator->id,
            'last_edited_by' => $creator->id,
            'sort_order' => 0,
            'is_published' => $published,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        DB::table('group_wiki_revisions')->insert([
            'page_id' => $pageId,
            'content' => 'Wiki content for ' . $slug,
            'edited_by' => $creator->id,
            'change_summary' => 'Initial',
            'created_at' => $now,
        ]);

        return $pageId;
    }
}
