<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\Concerns\HasTenantScope;
use App\Models\UserXpPurchase;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Tests\Laravel\TestCase;

class UserXpPurchaseTest extends TestCase
{
    private UserXpPurchase $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new UserXpPurchase();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('user_xp_purchases', $this->model->getTable());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        // `creation_idempotency_key_hash` is mass-assigned when an XP-shop purchase
        // is created, so a retry after a lost response resolves to the committed
        // row instead of spending XP twice. It must stay fillable.
        $expected = [
            'tenant_id', 'user_id', 'creation_idempotency_key_hash', 'item_id', 'xp_spent', 'is_active', 'expires_at',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('integer', $casts['xp_spent']);
        $this->assertEquals('boolean', $casts['is_active']);
        $this->assertEquals('datetime', $casts['expires_at']);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(UserXpPurchase::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_item_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->item());
    }

    public function test_user_relationship(): void
    {
        $this->assertInstanceOf(BelongsTo::class, $this->model->user());
    }
}
