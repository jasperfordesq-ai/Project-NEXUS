<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use App\Models\User;
use App\Services\TokenService;
use Illuminate\Support\Facades\DB;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\UploadedFile;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Feature tests for ResourcePublicController — public resource library.
 */
class ResourcePublicControllerTest extends TestCase
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

    // ------------------------------------------------------------------
    //  GET /v2/resources
    // ------------------------------------------------------------------

    public function test_index_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/resources');

        $response->assertStatus(200);
    }

    public function test_cursor_traverses_manual_order_and_timestamp_ties_once(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId)];
        $ids = [];
        foreach ([[0, '2026-01-01'], [2, '2026-01-01'], [0, '2026-01-02'], [0, '2026-01-02'], [1, '2026-01-01']] as [$order, $date]) {
            $ids[] = DB::table('resources')->insertGetId([
                'tenant_id' => $this->testTenantId, 'user_id' => $user->id,
                'title' => 'DN123 cursor fixture', 'file_path' => 'fixture.pdf',
                'sort_order' => $order, 'created_at' => $date . ' 00:00:00',
            ]);
        }
        $seen = [];
        $cursor = null;
        $firstCursor = null;
        for ($page = 0; $page < 4; $page++) {
            $query = http_build_query(['search' => 'DN123 cursor fixture', 'per_page' => 2, 'cursor' => $cursor]);
            $response = $this->apiGet('/v2/resources?' . $query, $headers)->assertOk();
            $seen = array_merge($seen, array_column($response->json('data'), 'id'));
            if (!$response->json('meta.has_more')) break;
            $cursor = $response->json('meta.cursor');
            $firstCursor ??= $cursor;
            $this->assertNotEmpty($cursor);
        }
        $this->assertSame([$ids[3], $ids[2], $ids[0], $ids[4], $ids[1]], $seen);
        $query = ['search' => 'DN123 cursor fixture', 'per_page' => 10, 'cursor' => base64_encode((string) $ids[2])];
        $legacy = $this->apiGet('/v2/resources?' . http_build_query($query), $headers)->assertOk();
        $this->assertSame([$ids[0], $ids[4], $ids[1]], array_column($legacy->json('data'), 'id'));
        DB::table('resources')->where('id', $ids[2])->where('tenant_id', $this->testTenantId)->delete();
        $query['cursor'] = $firstCursor;
        $afterDeletion = $this->apiGet('/v2/resources?' . http_build_query($query), $headers)->assertOk();
        $this->assertSame([$ids[0], $ids[4], $ids[1]], array_column($afterDeletion->json('data'), 'id'));
        $query['cursor'] = base64_encode('{"v":1,"id":[]}');
        $this->apiGet('/v2/resources?' . http_build_query($query), $headers)->assertStatus(422);
        foreach (['2026-02-30 00:00:00', '2026-01-01 25:00:00'] as $invalidDate) {
            $query['cursor'] = base64_encode(json_encode(['v' => 1, 'sort' => 0, 'created' => $invalidDate, 'id' => $ids[0]]));
            $this->apiGet('/v2/resources?' . http_build_query($query), $headers)->assertStatus(422);
        }
        $target = $this->apiGet('/v2/resources?resource_id=' . $ids[1], $headers)->assertOk();
        $this->assertSame([$ids[1]], array_column($target->json('data'), 'id'));
        $this->apiGet('/v2/resources?resource_id=' . $ids[2], $headers)->assertOk()->assertJsonCount(0, 'data');
    }

    // ------------------------------------------------------------------
    //  GET /v2/resources/categories
    // ------------------------------------------------------------------

    public function test_categories_requires_auth(): void
    {
        $response = $this->apiGet('/v2/resources/categories');

        $response->assertStatus(401);
    }

    public function test_categories_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/resources/categories');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/resources
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/resources', [
            'title' => 'Test Resource',
            'description' => 'A helpful resource',
        ]);

        $response->assertStatus(401);
    }

    public function test_store_rejects_allowed_extension_when_detected_mime_is_not_allowed(): void
    {
        $this->authenticatedUser();
        $uploadDir = base_path('httpdocs/uploads/' . $this->testTenantId . '/resources');
        $before = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];

        $response = $this->apiPost('/v2/resources', [
            'title' => 'Disguised executable',
            'file' => UploadedFile::fake()->createWithContent('not-a-real.pdf', 'MZ' . str_repeat("\0", 512)),
        ]);

        $after = is_dir($uploadDir) ? glob($uploadDir . '/*') ?: [] : [];
        foreach (array_diff($after, $before) as $createdFile) {
            @unlink($createdFile);
        }

        $response->assertStatus(400);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/resources/{id}
    // ------------------------------------------------------------------

    public function test_destroy_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/resources/1');

        $response->assertStatus(401);
    }
}
