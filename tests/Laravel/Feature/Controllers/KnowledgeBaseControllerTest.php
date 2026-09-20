<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Controllers;

use Tests\Laravel\TestCase;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use App\Models\User;
use App\Models\Category;
use App\Services\TokenService;
use Illuminate\Support\Facades\DB;

/**
 * Feature tests for KnowledgeBaseController — KB articles CRUD, search, feedback.
 */
class KnowledgeBaseControllerTest extends TestCase
{
    use DatabaseTransactions;

    public function test_member_feedback_replays_and_changes_one_vote_with_readable_totals(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId)];
        $id = DB::table('knowledge_base_articles')->insertGetId([
            'tenant_id' => $this->testTenantId, 'created_by' => $user->id,
            'title' => 'Native feedback fixture', 'slug' => 'native-feedback-' . $user->id,
            'content' => 'Local fixture', 'is_published' => true,
            'sort_order' => 0, 'created_at' => now(),
        ]);
        $this->apiGet('/v2/kb/' . $id, $headers)->assertOk()->assertJsonPath('data.my_feedback', null);
        foreach ([true, true, false, false] as $choice) {
            $this->apiPost('/v2/kb/' . $id . '/feedback', ['is_helpful' => $choice], $headers)->assertOk();
            $this->apiGet('/v2/kb/' . $id, $headers)->assertOk()
                ->assertJsonPath('data.my_feedback', $choice)
                ->assertJsonPath('data.helpful_yes', $choice ? 1 : 0)
                ->assertJsonPath('data.helpful_no', $choice ? 0 : 1);
            $this->assertSame(1, DB::table('knowledge_base_feedback')
                ->where('tenant_id', $this->testTenantId)->where('article_id', $id)->where('user_id', $user->id)->count());
        }
    }

    public function test_search_pages_all_ranked_matches_and_preserves_legacy_array(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId)];
        $term = 'dn127search' . $user->id;
        $ids = [];
        for ($i = 0; $i < 24; $i++) {
            $ids[] = DB::table('knowledge_base_articles')->insertGetId([
                'tenant_id' => $this->testTenantId, 'created_by' => $user->id,
                'title' => $i < 20 ? $term : 'Content match', 'slug' => $term . '-' . $i,
                'content' => $term, 'views_count' => $i < 20 ? 10 : 100,
                'is_published' => $i < 23, 'sort_order' => 0, 'created_at' => '2026-01-01 00:00:00',
            ]);
        }
        $query = ['q' => $term, 'per_page' => 7];
        $seen = [];
        $firstCursor = null;
        for ($page = 0; $page < 5; $page++) {
            $response = $this->apiGet('/v2/kb/search?' . http_build_query($query), $headers)->assertOk();
            $this->assertLessThanOrEqual(7, count($response->json('data')));
            $seen = array_merge($seen, array_column($response->json('data'), 'id'));
            if (!$response->json('meta.has_more')) break;
            $query['cursor'] = $response->json('meta.cursor');
            $firstCursor ??= $query['cursor'];
            $this->assertNotEmpty($query['cursor']);
        }
        $expected = array_merge(array_reverse(array_slice($ids, 0, 20)), array_reverse(array_slice($ids, 20, 3)));
        $this->assertSame($expected, $seen);
        $legacy = $this->apiGet('/v2/kb/search?' . http_build_query(['q' => $term, 'limit' => 20]), $headers)->assertOk();
        $this->assertSame(array_slice($expected, 0, 20), array_column($legacy->json('data'), 'id'));
        $this->assertNull($legacy->json('meta.cursor'));
        $query['cursor'] = $firstCursor;
        $query['q'] = 'another-term';
        $this->apiGet('/v2/kb/search?' . http_build_query($query), $headers)->assertStatus(422);
        $query['q'] = $term;
        $query['cursor'] = base64_encode('{"v":1,"rank":[]}');
        $this->apiGet('/v2/kb/search?' . http_build_query($query), $headers)->assertStatus(422);
    }

    public function test_cursor_traverses_manual_order_and_timestamp_ties_once(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $headers = ['Authorization' => 'Bearer ' . app(TokenService::class)->generateToken((int) $user->id, $this->testTenantId)];
        $category = Category::factory()->forTenant($this->testTenantId)->create(['type' => 'resource']);
        $ids = [];
        foreach ([[0, '2026-01-01'], [2, '2026-01-01'], [0, '2026-01-02'], [0, '2026-01-02'], [1, '2026-01-01']] as $index => [$order, $date]) {
            $ids[] = DB::table('knowledge_base_articles')->insertGetId([
                'tenant_id' => $this->testTenantId, 'created_by' => $user->id, 'category_id' => $category->id,
                'title' => 'DN126 cursor fixture', 'slug' => 'dn126-' . $category->id . '-' . $index,
                'content' => 'Local fixture', 'is_published' => true,
                'sort_order' => $order, 'created_at' => $date . ' 00:00:00',
            ]);
        }
        $query = ['category_id' => $category->id, 'per_page' => 2];
        $seen = [];
        $firstCursor = null;
        for ($page = 0; $page < 4; $page++) {
            $response = $this->apiGet('/v2/kb?' . http_build_query($query), $headers)->assertOk();
            $seen = array_merge($seen, array_column($response->json('data'), 'id'));
            if (!$response->json('meta.has_more')) break;
            $query['cursor'] = $response->json('meta.cursor');
            $firstCursor ??= $query['cursor'];
            $this->assertNotEmpty($query['cursor']);
        }
        $this->assertSame([$ids[3], $ids[2], $ids[0], $ids[4], $ids[1]], $seen);
        $query['per_page'] = 10;
        $query['cursor'] = base64_encode((string) $ids[2]);
        $legacy = $this->apiGet('/v2/kb?' . http_build_query($query), $headers)->assertOk();
        $this->assertSame([$ids[0], $ids[4], $ids[1]], array_column($legacy->json('data'), 'id'));
        DB::table('knowledge_base_articles')->where('id', $ids[2])->delete();
        $query['cursor'] = $firstCursor;
        $remaining = $this->apiGet('/v2/kb?' . http_build_query($query), $headers)->assertOk();
        $this->assertSame([$ids[0], $ids[4], $ids[1]], array_column($remaining->json('data'), 'id'));
        foreach (['not-base64!', base64_encode('{"v":1,"id":[]}'), base64_encode(json_encode([
            'v' => 1, 'sort' => 0, 'created' => '2026-02-30 00:00:00', 'id' => $ids[0],
        ]))] as $invalid) {
            $query['cursor'] = $invalid;
            $this->apiGet('/v2/kb?' . http_build_query($query), $headers)->assertStatus(422);
        }
    }

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
    //  GET /v2/kb
    // ------------------------------------------------------------------

    public function test_index_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/kb');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  GET /v2/kb/search
    // ------------------------------------------------------------------

    public function test_search_returns_data(): void
    {
        $this->authenticatedUser();

        $response = $this->apiGet('/v2/kb/search?q=help');

        $response->assertStatus(200);
    }

    // ------------------------------------------------------------------
    //  POST /v2/kb
    // ------------------------------------------------------------------

    public function test_store_requires_auth(): void
    {
        $response = $this->apiPost('/v2/kb', [
            'title' => 'How to use timebanking',
            'content' => 'Timebanking is...',
        ]);

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  DELETE /v2/kb/{id}
    // ------------------------------------------------------------------

public function test_destroy_requires_auth(): void
    {
        $response = $this->apiDelete('/v2/kb/1');

        $response->assertStatus(401);
    }

    // ------------------------------------------------------------------
    //  POST /v2/kb/{id}/feedback
    // ------------------------------------------------------------------

    public function test_feedback_requires_auth(): void
    {
        $response = $this->apiPost('/v2/kb/1/feedback', [
            'helpful' => true,
        ]);

        $response->assertStatus(401);
    }
}
