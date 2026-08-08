<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Collections;

use App\Models\Social\SavedItem;
use App\Models\User;
use App\Services\Social\SavedCollectionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC10 — Saving the same item twice should NOT create a duplicate row,
 * and the item count on the collection should remain at 1.
 */
class SaveItemIdempotentTest extends TestCase
{
    use DatabaseTransactions;

    public function test_double_save_is_idempotent(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        // User-created listeners reset TenantContext in console mode — re-pin.
        \App\Core\TenantContext::setById($this->testTenantId);
        $svc = new SavedCollectionService();
        $col = $svc->createCollection($user->id, 'Faves');
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id'   => $user->id,
            'title'     => 'Idempotent listing',
            'type'      => 'offer',
        ]);

        $svc->saveItem($user->id, $col->id, 'listing', $listingId);
        $svc->saveItem($user->id, $col->id, 'listing', $listingId);

        $count = SavedItem::where('collection_id', $col->id)
            ->where('item_type', 'listing')
            ->where('item_id', $listingId)
            ->count();
        $this->assertSame(1, $count);

        $col->refresh();
        $this->assertSame(1, (int) $col->items_count);
    }
}
