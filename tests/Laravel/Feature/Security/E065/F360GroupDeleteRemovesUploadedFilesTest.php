<?php

// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E065;

use App\Models\Group;
use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * E-065 F-360 — deleting a whole group must remove the members' uploaded file
 * and media bytes, not just the rows that name them.
 *
 * Before the fix, GroupService::deleteRelatedGroupRecords() removed only the
 * group_files / group_media ROWS. The per-file path (GroupFileService::delete)
 * quarantines and removes the bytes; the whole-group cascade had no equivalent
 * and no GroupDeleted listener did it either, so members' private group
 * documents stayed on disk indefinitely with no database row to find them by —
 * invisible to any retention or erasure process that works from the database.
 */
class F360GroupDeleteRemovesUploadedFilesTest extends TestCase
{
    use DatabaseTransactions;

    private function owner(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_deleting_a_group_removes_the_uploaded_file_bytes(): void
    {
        Storage::fake('local');
        $owner = $this->owner();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('private-notes.txt', 'E065 F-360 synthetic private bytes'),
        ], ['Idempotency-Key' => 'e066e-f360-0001'])->assertCreated();

        $path = (string) DB::table('group_files')->where('group_id', $group->id)->value('file_path');
        $this->assertNotSame('', $path, 'precondition: the upload stored a path');
        $this->assertTrue(Storage::disk('local')->exists($path), 'precondition: bytes on disk');

        $this->apiDelete("/v2/groups/{$group->id}")->assertStatus(204);

        $this->assertSame(
            0,
            DB::table('group_files')->where('group_id', $group->id)->count(),
            'the metadata row is gone'
        );
        $this->assertFalse(
            Storage::disk('local')->exists($path),
            'F-360: the private file bytes must not outlive the group that named them'
        );
    }

    public function test_deleting_a_group_removes_the_media_and_thumbnail_bytes(): void
    {
        Storage::fake('local');
        Storage::fake('public');
        $owner = $this->owner();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $mediaPath = "groups/{$this->testTenantId}/{$group->id}/media/e066e-f360-image.jpg";
        $thumbPath = "groups/{$this->testTenantId}/{$group->id}/media/e066e-f360-image-thumb.jpg";
        Storage::disk('public')->put($mediaPath, 'E065 F-360 synthetic media bytes');
        Storage::disk('public')->put($thumbPath, 'E065 F-360 synthetic thumbnail bytes');

        DB::table('group_media')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'uploaded_by' => (int) $owner->id,
            'media_type' => 'image',
            'original_name' => 'e066e-f360-image.jpg',
            'mime_type' => 'image/jpeg',
            'file_path' => $mediaPath,
            'thumbnail_path' => $thumbPath,
            'file_size' => 32,
            'created_at' => now(),
        ]);

        $this->apiDelete("/v2/groups/{$group->id}")->assertStatus(204);

        $this->assertSame(
            0,
            DB::table('group_media')->where('group_id', $group->id)->count(),
            'the media row is gone'
        );
        $this->assertFalse(
            Storage::disk('public')->exists($mediaPath),
            'F-360: the media bytes must not outlive the group'
        );
        $this->assertFalse(
            Storage::disk('public')->exists($thumbPath),
            'F-360: the thumbnail bytes must not outlive the group'
        );
    }

    public function test_control_single_file_delete_still_removes_the_bytes(): void
    {
        Storage::fake('local');
        $owner = $this->owner();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $created = $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('private-notes.txt', 'E065 F-360 synthetic private bytes'),
        ], ['Idempotency-Key' => 'e066e-f360-0002'])->assertCreated();

        $fileId = (int) $created->json('data.id');
        $path = (string) DB::table('group_files')->where('id', $fileId)->value('file_path');
        $this->assertTrue(Storage::disk('local')->exists($path));

        $this->apiDelete("/v2/groups/{$group->id}/files/{$fileId}")->assertOk();

        $this->assertFalse(
            Storage::disk('local')->exists($path),
            'CONTROL: the documented per-file delete path still removes the bytes'
        );
    }

    public function test_control_a_refused_delete_leaves_the_bytes_alone(): void
    {
        Storage::fake('local');
        $owner = $this->owner();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('private-notes.txt', 'E065 F-360 synthetic private bytes'),
        ], ['Idempotency-Key' => 'e066e-f360-0003'])->assertCreated();

        $path = (string) DB::table('group_files')->where('group_id', $group->id)->value('file_path');

        $outsider = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);
        DB::table('group_members')->insert([
            'tenant_id' => $this->testTenantId,
            'group_id' => (int) $group->id,
            'user_id' => (int) $outsider->id,
            'role' => 'member',
            'status' => 'active',
            'joined_at' => now(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        Sanctum::actingAs($outsider, ['*']);
        $this->apiDelete("/v2/groups/{$group->id}")->assertStatus(403);

        $this->assertTrue(
            Storage::disk('local')->exists($path),
            'CONTROL: a refused delete must not touch the bytes'
        );
        $this->assertTrue(
            DB::table('group_files')->where('group_id', $group->id)->exists(),
            'CONTROL: a refused delete must not touch the rows'
        );
    }
}
