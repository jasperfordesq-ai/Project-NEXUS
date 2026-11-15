<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\XPShopService;
use App\Core\TenantContext;
use Illuminate\Support\Facades\DB;

class XPShopServiceTest extends TestCase
{
    public function test_getItems_returns_array(): void
    {
        DB::shouldReceive('table')->with('xp_shop_items')->andReturnSelf();
        DB::shouldReceive('where')->with('tenant_id', 2)->andReturnSelf();
        DB::shouldReceive('where')->with('is_active', 1)->andReturnSelf();
        DB::shouldReceive('orderBy')->with('display_order')->andReturnSelf();
        DB::shouldReceive('orderBy')->with('xp_cost')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = XPShopService::getItems(2);
        $this->assertIsArray($result);
    }

    public function test_getBalance_returns_zero_when_user_not_found(): void
    {
        DB::shouldReceive('table')->with('users')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $this->assertEquals(0, XPShopService::getBalance(2, 999));
    }

    public function test_getBalance_returns_xp_value(): void
    {
        DB::shouldReceive('table')->with('users')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn((object) ['xp' => 150]);

        $this->assertEquals(150, XPShopService::getBalance(2, 1));
    }

    public function test_purchaseItem_returns_error_when_item_not_found(): void
    {
        DB::shouldReceive('table')->with('xp_shop_items')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('first')->andReturn(null);

        $result = XPShopService::purchaseItem(1, 999);

        $this->assertFalse($result['success']);
        $this->assertEquals("We can't find that item in the shop.", $result['error']);
    }

    public function test_getUserPurchases_returns_array(): void
    {
        DB::shouldReceive('table')->with('user_xp_purchases as uxp')->andReturnSelf();
        DB::shouldReceive('join')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('select')->andReturnSelf();
        DB::shouldReceive('orderByDesc')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = XPShopService::getUserPurchases(2, 1);
        $this->assertIsArray($result);
    }
}
