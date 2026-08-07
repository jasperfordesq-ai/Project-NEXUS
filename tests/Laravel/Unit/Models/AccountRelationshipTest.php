<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\AccountRelationship;
use App\Models\Concerns\HasTenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Tests\Laravel\TestCase;

class AccountRelationshipTest extends TestCase
{
    public function test_table_name(): void
    {
        $model = new AccountRelationship();
        $this->assertEquals('account_relationships', $model->getTable());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $model = new AccountRelationship();
        $expected = [
            'tenant_id', 'parent_user_id', 'child_user_id',
            'relationship_type', 'permissions', 'status', 'approved_at',
            // Added 2026-08-07 with consent-gated message access. It MUST be
            // fillable: it is written via update() alongside the tiers, and
            // while it was missing here Eloquent silently dropped it, leaving
            // the counterparty-notice mirror null on a live grant.
            'message_access_granted_at',
        ];
        $this->assertEquals($expected, $model->getFillable());
    }

    public function test_casts_contain_correct_types(): void
    {
        $model = new AccountRelationship();
        $casts = $model->getCasts();
        $this->assertEquals('integer', $casts['parent_user_id']);
        $this->assertEquals('integer', $casts['child_user_id']);
        $this->assertEquals('array', $casts['permissions']);
        $this->assertEquals('datetime', $casts['approved_at']);
    }

    public function test_uses_has_tenant_scope_trait(): void
    {
        $this->assertContains(
            HasTenantScope::class,
            class_uses_recursive(AccountRelationship::class)
        );
    }

    public function test_parent_user_relationship_returns_belongs_to(): void
    {
        $model = new AccountRelationship();
        $this->assertInstanceOf(BelongsTo::class, $model->parentUser());
        $this->assertEquals('parent_user_id', $model->parentUser()->getForeignKeyName());
    }

    public function test_child_user_relationship_returns_belongs_to(): void
    {
        $model = new AccountRelationship();
        $this->assertInstanceOf(BelongsTo::class, $model->childUser());
        $this->assertEquals('child_user_id', $model->childUser()->getForeignKeyName());
    }
}
