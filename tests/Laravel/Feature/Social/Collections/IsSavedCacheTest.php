<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Social\Collections;

use App\Models\User;
use App\Services\Social\SavedCollectionService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

/**
 * SOC10 — Bulk check returns correct flags for saved/unsaved pairs.
 */
class IsSavedCacheTest extends TestCase
{
    use DatabaseTransactions;

    public function test_is_saved_bulk_returns_correct_flags(): void
    {
        $user = User::factory()->forTenant($this->testTenantId)->create();
        // User-created listeners reset TenantContext in console mode — re-pin.
        \App\Core\TenantContext::setById($this->testTenantId);
        $svc = new SavedCollectionService();
        $col = $svc->createCollection($user->id, 'C');
        $listingId = DB::table('listings')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id'   => $user->id,
            'title'     => 'Cache listing',
            'type'      => 'offer',
        ]);
        $eventId = DB::table('events')->insertGetId([
            'tenant_id'   => $this->testTenantId,
            'user_id'     => $user->id,
            'title'       => 'Cache event',
            'description' => 'Cache event description',
            'start_time'  => now()->addDay(),
        ]);

        $svc->saveItem($user->id, $col->id, 'listing', $listingId);
        $svc->saveItem($user->id, $col->id, 'event', $eventId);
        $svc->forgetSavedCache($user->id);

        $result = $svc->isSavedBulk($user->id, [
            ['item_type' => 'listing', 'item_id' => $listingId],
            ['item_type' => 'listing', 'item_id' => 999999999],
            ['item_type' => 'event',   'item_id' => $eventId],
        ]);

        $this->assertTrue($result["listing:{$listingId}"]);
        $this->assertFalse($result['listing:999999999']);
        $this->assertTrue($result["event:{$eventId}"]);
    }
}
