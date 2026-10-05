<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Models\Concerns\HasTenantScope;
use App\Models\VolGivingDay;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Tests\Laravel\TestCase;

class VolGivingDayTest extends TestCase
{
    private VolGivingDay $model;

    protected function setUp(): void
    {
        parent::setUp();
        $this->model = new VolGivingDay();
    }

    public function test_table_name(): void
    {
        $this->assertEquals('vol_giving_days', $this->model->getTable());
    }

    public function test_timestamps_disabled(): void
    {
        $this->assertFalse($this->model->usesTimestamps());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $expected = [
            'title', 'description', 'start_date', 'end_date',
            'goal_amount', 'raised_amount', 'target_hours', 'is_active', 'organization_id', 'created_by', 'created_at',
        ];
        $this->assertEquals($expected, $this->model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = $this->model->getCasts();
        $this->assertEquals('decimal:2', $casts['goal_amount']);
        $this->assertEquals('decimal:2', $casts['raised_amount']);
        $this->assertEquals('boolean', $casts['is_active']);
        $this->assertEquals('datetime', $casts['created_at']);
    }

    public function test_uses_has_tenant_scope(): void
    {
        $traits = class_uses_recursive(VolGivingDay::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    public function test_donations_relationship(): void
    {
        $this->assertInstanceOf(HasMany::class, $this->model->donations());
    }
}
