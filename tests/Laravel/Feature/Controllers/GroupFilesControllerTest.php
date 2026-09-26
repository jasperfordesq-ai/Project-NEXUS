<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Group;
use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;
use App\Models\User;

/**
 * Feature smoke tests for GroupFilesController.
 */
class GroupFilesControllerTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticatedUser(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    public function test_index_requires_auth(): void
    {
        $this->apiGet('/v2/groups/1/files')->assertStatus(401);
    }

    public function test_store_requires_auth(): void
    {
        $this->apiPost('/v2/groups/1/files', [])->assertStatus(401);
    }

    public function test_folders_requires_auth(): void
    {
        $this->apiGet('/v2/groups/1/files/folders')->assertStatus(401);
    }

    public function test_stats_requires_auth(): void
    {
        $this->apiGet('/v2/groups/1/files/stats')->assertStatus(401);
    }

    public function test_download_requires_auth(): void
    {
        $this->apiGet('/v2/groups/1/files/1/download')->assertStatus(401);
    }

    public function test_destroy_requires_auth(): void
    {
        $this->apiDelete('/v2/groups/1/files/1')->assertStatus(401);
    }

    public function test_index_returns_non_5xx_when_authenticated(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/groups/1/files');
        $this->assertTrue($response->status() < 500, "Got 5xx: {$response->status()}");
    }

    public function test_stats_returns_non_5xx_when_authenticated(): void
    {
        $this->authenticatedUser();
        $response = $this->apiGet('/v2/groups/1/files/stats');
        $this->assertTrue($response->status() < 500, "Got 5xx: {$response->status()}");
    }

    public function test_upload_replays_same_operation_without_duplicate_file_or_storage(): void
    {
        Storage::fake('local');
        $owner = $this->authenticatedUser();
        $group = Group::factory()->forTenant($this->testTenantId)->create([
            'owner_id' => $owner->id,
            'status' => 'active',
            'is_active' => true,
        ]);
        $headers = ['Idempotency-Key' => 'group-file-replay-0001'];

        $first = $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('notes.txt', 'same private file bytes'),
        ], $headers)->assertCreated();
        $second = $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('notes.txt', 'same private file bytes'),
        ], $headers)->assertCreated();

        self::assertSame($first->json('data.id'), $second->json('data.id'));
        self::assertSame(1, DB::table('group_files')->where('group_id', $group->id)->count());
        self::assertSame(1, DB::table('group_content_creation_receipts')
            ->where('group_id', $group->id)
            ->where('operation_type', 'file')
            ->count());
        self::assertCount(1, Storage::disk('local')->allFiles("groups/{$this->testTenantId}/{$group->id}"));

        $this->apiPost("/v2/groups/{$group->id}/files", [
            'file' => UploadedFile::fake()->createWithContent('notes.txt', 'changed private file'),
        ], $headers)->assertStatus(409);
        self::assertSame(1, DB::table('group_files')->where('group_id', $group->id)->count());
        self::assertCount(1, Storage::disk('local')->allFiles("groups/{$this->testTenantId}/{$group->id}"));

        $fileId = (int) $first->json('data.id');
        $this->apiDelete("/v2/groups/{$group->id}/files/{$fileId}")->assertOk();
        self::assertSame(0, DB::table('group_content_creation_receipts')
            ->where('group_id', $group->id)
            ->where('operation_type', 'file')
            ->where('result_id', $fileId)
            ->count());
    }
}
