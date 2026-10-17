<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Groups;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\GroupConfigurationService;
use App\Services\GroupMentionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class GroupChildResourceAccessTest extends TestCase
{
    use DatabaseTransactions;

    private User $owner;
    private User $nonMember;
    private User $pendingMember;
    private User $member;
    private User $groupAdmin;
    private User $tenantAdmin;
    private User $suggestionTarget;
    private User $foreignOwner;

    private int $activeGroupId;
    private int $otherGroupId;
    private int $archivedGroupId;
    private int $foreignGroupId;
    private int $fileId;
    private int $otherFileId;
    private int $foreignFileId;
    private int $traversalFileId;
    private int $mediaId;
    private int $otherMediaId;
    private int $legacyPublicMediaId;
    private int $traversalMediaId;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('local');
        Storage::fake('public');
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_FILES, true);
        GroupConfigurationService::set(GroupConfigurationService::CONFIG_TAB_MEDIA, true);

        $this->owner = $this->user('child_owner');
        $this->nonMember = $this->user('child_nonmember');
        $this->pendingMember = $this->user('child_pending');
        $this->member = $this->user('child_member');
        $this->groupAdmin = $this->user('child_group_admin');
        $this->tenantAdmin = User::factory()->forTenant($this->testTenantId)->admin()->create([
            'username' => 'child_tenant_admin',
        ]);
        $this->suggestionTarget = $this->user('child_suggestion_target');
        $this->foreignOwner = User::factory()->forTenant(999)->create([
            'username' => 'child_foreign_owner',
        ]);

        TenantContext::setById($this->testTenantId);

        $this->activeGroupId = $this->insertGroup('active', (int) $this->owner->id);
        $this->otherGroupId = $this->insertGroup('active', (int) $this->owner->id);
        $this->archivedGroupId = $this->insertGroup('archived', (int) $this->owner->id);
        $this->foreignGroupId = $this->insertGroup('active', (int) $this->foreignOwner->id, 999);

        $this->insertMembership($this->activeGroupId, $this->pendingMember, 'pending');
        $this->insertMembership($this->activeGroupId, $this->member, 'active');
        $this->insertMembership($this->activeGroupId, $this->groupAdmin, 'active', 'admin');
        $this->insertMembership($this->activeGroupId, $this->suggestionTarget, 'active');
        $this->insertMembership($this->archivedGroupId, $this->member, 'active');
        $this->insertMembership($this->archivedGroupId, $this->groupAdmin, 'active', 'admin');

        $activeFilePath = "groups/{$this->testTenantId}/{$this->activeGroupId}/protected.txt";
        Storage::disk('local')->put($activeFilePath, 'member-only-file-bytes');
        $this->fileId = $this->insertFile($this->activeGroupId, $activeFilePath, (int) $this->member->id);

        $otherFilePath = "groups/{$this->testTenantId}/{$this->otherGroupId}/other.txt";
        Storage::disk('local')->put($otherFilePath, 'other-group-file');
        $this->otherFileId = $this->insertFile($this->otherGroupId, $otherFilePath, (int) $this->owner->id);
        $this->foreignFileId = $this->insertFile(
            $this->foreignGroupId,
            "groups/999/{$this->foreignGroupId}/foreign.txt",
            (int) $this->foreignOwner->id,
            999,
        );
        $this->traversalFileId = $this->insertFile(
            $this->activeGroupId,
            "groups/{$this->testTenantId}/{$this->activeGroupId}/../secret.txt",
            (int) $this->member->id,
        );

        $activeMediaPath = "groups/{$this->testTenantId}/{$this->activeGroupId}/media/member.jpg";
        Storage::disk('local')->put($activeMediaPath, 'member-only-media-bytes');
        $this->mediaId = $this->insertMedia(
            $this->activeGroupId,
            $activeMediaPath,
            (int) $this->member->id,
            $this->testTenantId,
            'https://public.invalid/leaked-old-url.jpg',
        );

        $otherMediaPath = "groups/{$this->testTenantId}/{$this->otherGroupId}/media/other.jpg";
        Storage::disk('local')->put($otherMediaPath, 'other-group-media');
        $this->otherMediaId = $this->insertMedia(
            $this->otherGroupId,
            $otherMediaPath,
            (int) $this->owner->id,
        );

        $legacyPublicPath = "groups/{$this->testTenantId}/{$this->activeGroupId}/media/legacy.jpg";
        Storage::disk('public')->put($legacyPublicPath, 'legacy-public-bytes');
        $this->legacyPublicMediaId = $this->insertMedia(
            $this->activeGroupId,
            $legacyPublicPath,
            (int) $this->member->id,
            $this->testTenantId,
            '/storage/' . $legacyPublicPath,
        );
        $this->traversalMediaId = $this->insertMedia(
            $this->activeGroupId,
            "groups/{$this->testTenantId}/{$this->activeGroupId}/media/../../secret.jpg",
            (int) $this->member->id,
        );
    }

    public function test_member_content_http_matrix_covers_nonmember_pending_member_admin_foreign_and_archived(): void
    {
        $activeEndpoints = [
            "/v2/groups/{$this->activeGroupId}/files",
            "/v2/groups/{$this->activeGroupId}/media",
            "/v2/groups/{$this->activeGroupId}/mentions/suggest?q=child_",
        ];

        foreach ([
            'nonmember' => [$this->nonMember, 403],
            'pending' => [$this->pendingMember, 403],
            'member' => [$this->member, 200],
            'group admin' => [$this->groupAdmin, 200],
            'tenant admin' => [$this->tenantAdmin, 200],
        ] as $label => [$actor, $status]) {
            foreach ($activeEndpoints as $endpoint) {
                $this->authenticateAs($actor);
                $response = $this->apiGet($endpoint);
                $this->assertSame($status, $response->status(), "{$label}: {$endpoint}");
            }
        }

        $this->authenticateAs($this->member);
        foreach (['files', 'media', 'mentions/suggest'] as $resource) {
            $this->apiGet("/v2/groups/{$this->foreignGroupId}/{$resource}")->assertNotFound();
            $this->apiGet("/v2/groups/{$this->archivedGroupId}/{$resource}")->assertForbidden();
        }

        $this->authenticateAs($this->tenantAdmin);
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/files")->assertForbidden();
        $this->apiGet("/v2/groups/{$this->archivedGroupId}/media")->assertForbidden();
    }

    public function test_file_bytes_require_parent_access_and_nested_ids_cannot_be_swapped_or_traversed(): void
    {
        $this->authenticateAs($this->member);
        $list = $this->apiGet("/v2/groups/{$this->activeGroupId}/files")->assertOk();
        $this->assertStringNotContainsString('file_path', (string) $list->getContent());
        $this->assertStringNotContainsString(
            "groups/{$this->testTenantId}/{$this->activeGroupId}",
            (string) $list->getContent(),
        );

        $download = $this->apiGet("/v2/groups/{$this->activeGroupId}/files/{$this->fileId}/download");
        $download->assertOk();
        $this->assertSame('member-only-file-bytes', $download->streamedContent());
        $this->assertStringContainsString('private', (string) $download->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', (string) $download->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $download->headers->get('X-Content-Type-Options'));

        $this->apiGet("/v2/groups/{$this->activeGroupId}/files/{$this->otherFileId}/download")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/files/{$this->foreignFileId}/download")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/files/{$this->traversalFileId}/download")->assertNotFound();

        $this->authenticateAs($this->nonMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/files/{$this->fileId}/download")->assertForbidden();
    }

    public function test_media_lists_only_protected_urls_and_serves_private_local_bytes_after_authorization(): void
    {
        $this->authenticateAs($this->member);
        $list = $this->apiGet("/v2/groups/{$this->activeGroupId}/media")->assertOk();
        $payload = (string) $list->getContent();
        $this->assertStringNotContainsString('file_path', $payload);
        $this->assertStringNotContainsString('public.invalid', $payload);
        $this->assertStringNotContainsString('/storage/', $payload);

        $items = $list->json('data.items');
        $protectedItem = collect($items)->firstWhere('id', $this->mediaId);
        $this->assertSame(
            "/api/v2/groups/{$this->activeGroupId}/media?content={$this->mediaId}",
            $protectedItem['url'] ?? null,
        );

        $content = $this->apiGet("/v2/groups/{$this->activeGroupId}/media?content={$this->mediaId}");
        $content->assertOk();
        $this->assertSame('member-only-media-bytes', $content->streamedContent());
        $this->assertStringContainsString('private', (string) $content->headers->get('Cache-Control'));
        $this->assertStringContainsString('no-store', (string) $content->headers->get('Cache-Control'));
        $this->assertSame('nosniff', $content->headers->get('X-Content-Type-Options'));

        $this->apiGet("/v2/groups/{$this->activeGroupId}/media?content={$this->otherMediaId}")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/media?content={$this->legacyPublicMediaId}")->assertNotFound();
        $this->apiGet("/v2/groups/{$this->activeGroupId}/media?content={$this->traversalMediaId}")->assertNotFound();

        $this->authenticateAs($this->nonMember);
        $this->apiGet("/v2/groups/{$this->activeGroupId}/media?content={$this->mediaId}")->assertForbidden();
    }

    public function test_mentions_only_suggest_active_members_of_the_authorized_parent_group(): void
    {
        $this->authenticateAs($this->member);
        $response = $this->apiGet(
            "/v2/groups/{$this->activeGroupId}/mentions/suggest?q=child_&limit=50",
        )->assertOk();

        $ids = array_map('intval', array_column($response->json('data'), 'id'));
        $this->assertContains((int) $this->suggestionTarget->id, $ids);
        $this->assertNotContains((int) $this->pendingMember->id, $ids);
        $this->assertNotContains((int) $this->nonMember->id, $ids);
        $this->assertNotContains((int) $this->foreignOwner->id, $ids);

        $resolved = GroupMentionService::parseMentions(
            '@child_suggestion_target @child_pending @child_nonmember @child_foreign_owner',
            $this->activeGroupId,
        );
        $this->assertSame(
            [(int) $this->suggestionTarget->id],
            array_column($resolved, 'user_id'),
        );
    }

    public function test_file_and_media_deletes_require_active_lifecycle_and_ownership_or_management(): void
    {
        $this->authenticateAs($this->suggestionTarget);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/files/{$this->fileId}")->assertForbidden();
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/media/{$this->mediaId}")->assertForbidden();

        $archivedFilePath = "groups/{$this->testTenantId}/{$this->archivedGroupId}/archived.txt";
        Storage::disk('local')->put($archivedFilePath, 'archived-file');
        $archivedFileId = $this->insertFile(
            $this->archivedGroupId,
            $archivedFilePath,
            (int) $this->member->id,
        );
        $archivedMediaPath = "groups/{$this->testTenantId}/{$this->archivedGroupId}/media/archived.jpg";
        Storage::disk('local')->put($archivedMediaPath, 'archived-media');
        $archivedMediaId = $this->insertMedia(
            $this->archivedGroupId,
            $archivedMediaPath,
            (int) $this->member->id,
        );

        $this->authenticateAs($this->member);
        $this->apiDelete("/v2/groups/{$this->archivedGroupId}/files/{$archivedFileId}")->assertForbidden();
        $this->apiDelete("/v2/groups/{$this->archivedGroupId}/media/{$archivedMediaId}")->assertForbidden();
        $this->assertDatabaseHas('group_files', ['id' => $archivedFileId]);
        $this->assertDatabaseHas('group_media', ['id' => $archivedMediaId]);

        $this->authenticateAs($this->groupAdmin);
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/files/{$this->fileId}")->assertOk();
        $this->apiDelete("/v2/groups/{$this->activeGroupId}/media/{$this->mediaId}")->assertOk();
        $this->assertDatabaseMissing('group_files', ['id' => $this->fileId]);
        $this->assertDatabaseMissing('group_media', ['id' => $this->mediaId]);
    }

    public function test_upload_policy_runs_before_payload_validation(): void
    {
        $this->authenticateAs($this->nonMember);
        $this->apiPost("/v2/groups/{$this->activeGroupId}/files")->assertForbidden();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/media")->assertForbidden();

        $this->authenticateAs($this->member);
        $this->apiPost("/v2/groups/{$this->archivedGroupId}/files")->assertForbidden();
        $this->apiPost("/v2/groups/{$this->archivedGroupId}/media")->assertForbidden();
        $this->apiPost("/v2/groups/{$this->foreignGroupId}/files")->assertNotFound();
        $this->apiPost("/v2/groups/{$this->foreignGroupId}/media")->assertNotFound();

        // Once policy passes, normal payload validation is allowed to run.
        $this->apiPost("/v2/groups/{$this->activeGroupId}/files")->assertUnprocessable();
        $this->apiPost("/v2/groups/{$this->activeGroupId}/media")->assertBadRequest();
    }

    private function authenticateAs(User $user): void
    {
        Sanctum::actingAs($user, ['*']);
    }

    private function user(string $username): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(['username' => $username]);
    }

    private function insertGroup(string $status, int $ownerId, ?int $tenantId = null): int
    {
        $tenantId ??= $this->testTenantId;

        return (int) DB::table('groups')->insertGetId([
            'tenant_id' => $tenantId,
            'owner_id' => $ownerId,
            'name' => 'Child resource ' . $status . ' ' . uniqid('', true),
            'description' => 'Child-resource authorization fixture.',
            'visibility' => 'private',
            'status' => $status,
            'is_active' => $status === 'active',
            'cached_member_count' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertMembership(int $groupId, User $user, string $status, string $role = 'member'): void
    {
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => $groupId,
            'user_id' => $user->id,
            'status' => $status,
            'role' => $role,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function insertFile(int $groupId, string $path, int $uploaderId, ?int $tenantId = null): int
    {
        return (int) DB::table('group_files')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'group_id' => $groupId,
            'file_name' => basename($path),
            'file_path' => $path,
            'file_type' => 'text/plain',
            'file_size' => 24,
            'folder' => 'audit',
            'description' => 'Protected test file',
            'download_count' => 0,
            'uploaded_by' => $uploaderId,
            'created_at' => now(),
        ]);
    }

    private function insertMedia(
        int $groupId,
        string $path,
        int $uploaderId,
        ?int $tenantId = null,
        ?string $url = null,
    ): int {
        return (int) DB::table('group_media')->insertGetId([
            'tenant_id' => $tenantId ?? $this->testTenantId,
            'group_id' => $groupId,
            'uploaded_by' => $uploaderId,
            'media_type' => 'image',
            'file_path' => $path,
            'url' => $url,
            'thumbnail_path' => null,
            'caption' => 'Protected test media',
            'file_size' => 24,
            'created_at' => now(),
        ]);
    }
}
