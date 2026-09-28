<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security;

use App\Core\TenantContext;
use App\Models\User;
use App\Services\AI\Tools\SemanticSearchTool;
use App\Services\EmbeddingService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class SemanticMarketplaceVisibilityTest extends TestCase
{
    use DatabaseTransactions;

    public function test_stale_embedding_hits_obey_current_marketplace_visibility(): void
    {
        $seller = User::factory()->forTenant($this->testTenantId)->create(['status' => 'active', 'is_approved' => true]);
        $viewer = User::factory()->forTenant($this->testTenantId)->create();
        $features = json_decode(DB::table('tenants')->where('id', $this->testTenantId)->value('features') ?: '{}', true);
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
        $id = DB::table('marketplace_listings')->insertGetId(['tenant_id' => $this->testTenantId,
            'user_id' => $seller->id, 'title' => 'Synthetic listing', 'description' => 'Synthetic content',
            'status' => 'active', 'moderation_status' => 'approved', 'price_type' => 'fixed', 'created_at' => now(), 'updated_at' => now()]);
        $embeddings = $this->createMock(EmbeddingService::class);
        $embeddings->method('semanticSearch')->willReturn([['content_type' => 'marketplace', 'content_id' => $id, 'score' => 0.9]]);
        $tool = new SemanticSearchTool($embeddings);
        $search = fn () => $tool->execute(['query' => 'item', 'types' => ['marketplace']], $viewer->id)['results'];
        $this->assertSame([$id], array_column($search(), 'id'));
        foreach ([['moderation_status' => 'pending'], ['expires_at' => now()->subMinute()]] as $hidden) {
            DB::table('marketplace_listings')->where('id', $id)->update($hidden);
            $this->assertSame([], $search());
            DB::table('marketplace_listings')->where('id', $id)->update(['moderation_status' => 'approved', 'expires_at' => null]);
        }
        DB::table('users')->where('id', $seller->id)->update(['is_approved' => false]);
        $this->assertSame([], $search());
        DB::table('users')->where('id', $seller->id)->update(['is_approved' => true]);
        $this->assertSame([$id], array_column($search(), 'id'));
        DB::table('users')->where('id', $seller->id)->update(['status' => 'suspended']);
        $this->assertSame([], $search());
        DB::table('users')->where('id', $seller->id)->update(['status' => 'active']);
        DB::table('marketplace_seller_profiles')->insert(['tenant_id' => $this->testTenantId,
            'user_id' => $seller->id, 'seller_type' => 'private', 'is_suspended' => true,
            'created_at' => now(), 'updated_at' => now()]);
        $this->assertSame([], $search());
        DB::table('marketplace_seller_profiles')->where('user_id', $seller->id)->update(['is_suspended' => false]);
        $this->assertSame([$id], array_column($search(), 'id'));
        $features['marketplace'] = false;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        TenantContext::setById($this->testTenantId);
        $this->assertSame([], $search());
    }
}
