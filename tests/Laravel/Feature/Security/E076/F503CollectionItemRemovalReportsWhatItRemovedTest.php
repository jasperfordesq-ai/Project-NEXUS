<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Security\E076;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-503 (E-076) — `DELETE /v2/marketplace/collections/{id}/items/{listingId}`
 * must not answer `{"removed": true}` when nothing was removed.
 *
 * `MarketplaceDiscoveryService::removeFromCollection()` computed the delete
 * count and used it to guard the `item_count` decrement, but was typed `void`,
 * so the controller answered the fixed success shape for a listing the
 * collection never held — including another community's. Ninth route of the
 * false-success family (F-418, F-472, F-473, F-482).
 *
 * These tests assert the CORRECT behaviour and fail before the fix. Controls in
 * the same file: removing a listing the collection really holds still answers
 * 200 and decrements the count; the refusal for a foreign listing is still
 * byte-identical to the one for an invented id (no existence oracle).
 */
final class F503CollectionItemRemovalReportsWhatItRemovedTest extends TestCase
{
    use DatabaseTransactions;

    private const FOREIGN_TENANT_ID = 999;

    protected function setUp(): void
    {
        parent::setUp();
        $features = json_decode((string) DB::table('tenants')->where('id', $this->testTenantId)->value('features'), true) ?: [];
        $features['marketplace'] = true;
        DB::table('tenants')->where('id', $this->testTenantId)->update(['features' => json_encode($features)]);
        \App\Core\TenantContext::setById($this->testTenantId);
    }

    public function test_removing_a_listing_the_collection_does_not_hold_is_refused(): void
    {
        $owner = $this->member($this->testTenantId);
        Sanctum::actingAs($owner);
        $collectionId = $this->collection((int) $owner->id, 0);

        $stranger = $this->member(self::FOREIGN_TENANT_ID);
        $foreignListingId = $this->listing(self::FOREIGN_TENANT_ID, (int) $stranger->id);

        $foreign = $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/{$foreignListingId}");
        $absent = $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/999999999");

        $this->assertSame(404, $foreign->getStatusCode(), 'F-503: nothing was removed, so the answer must not be success. ' . $foreign->getContent());
        $this->assertNotSame(true, $foreign->json('data.removed'));

        // CONTROL: still not an existence oracle.
        $this->assertSame($absent->getStatusCode(), $foreign->getStatusCode());
        $this->assertSame($absent->getContent(), $foreign->getContent());
        $this->assertDatabaseHas('marketplace_listings', ['id' => $foreignListingId, 'tenant_id' => self::FOREIGN_TENANT_ID]);
        $this->assertSame(0, (int) DB::table('marketplace_collections')->where('id', $collectionId)->value('item_count'));
    }

    /** CONTROL — legitimate removal is unchanged. */
    public function test_control_removing_a_listing_the_collection_holds_still_succeeds(): void
    {
        $owner = $this->member($this->testTenantId);
        Sanctum::actingAs($owner);
        $listingId = $this->listing($this->testTenantId, (int) $owner->id);
        $collectionId = $this->collection((int) $owner->id, 1);
        DB::table('marketplace_collection_items')->insert([
            'tenant_id' => $this->testTenantId,
            'collection_id' => $collectionId,
            'marketplace_listing_id' => $listingId,
            'created_at' => now(),
        ]);

        $res = $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/{$listingId}");

        $this->assertSame(200, $res->getStatusCode(), 'CONTROL: ' . $res->getContent());
        $this->assertTrue($res->json('data.removed'));
        $this->assertDatabaseMissing('marketplace_collection_items', [
            'collection_id' => $collectionId, 'marketplace_listing_id' => $listingId,
        ]);
        $this->assertSame(0, (int) DB::table('marketplace_collections')->where('id', $collectionId)->value('item_count'));

        // And a second removal of the same listing now reports that nothing was removed.
        $this->apiDelete("/v2/marketplace/collections/{$collectionId}/items/{$listingId}")->assertStatus(404);
    }

    // ── fixtures ────────────────────────────────────────────────────────────

    private function member(int $tenantId): User
    {
        return User::factory()->forTenant($tenantId)->create(['status' => 'active', 'is_approved' => true]);
    }

    private function collection(int $userId, int $itemCount): int
    {
        return (int) DB::table('marketplace_collections')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $userId,
            'name' => 'F503 collection',
            'item_count' => $itemCount,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function listing(int $tenantId, int $userId): int
    {
        return (int) DB::table('marketplace_listings')->insertGetId([
            'tenant_id' => $tenantId,
            'user_id' => $userId,
            'title' => 'F503 listing',
            'description' => 'F503 listing',
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
