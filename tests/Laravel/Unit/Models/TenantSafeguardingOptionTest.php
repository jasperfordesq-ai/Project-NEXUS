<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Models;

use App\Core\TenantContext;
use App\Models\Concerns\HasTenantScope;
use App\Models\TenantSafeguardingOption;
use App\Models\UserSafeguardingPreference;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Tests\Laravel\TestCase;

/**
 * Tests for TenantSafeguardingOption model logic.
 * Uses unique tenant id 99769 to avoid collisions.
 */
class TenantSafeguardingOptionTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 99769;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();

        DB::table('tenants')->updateOrInsert(
            ['id' => self::TENANT_ID],
            [
                'name'              => 'TSO Test Tenant',
                'slug'              => 'tso-test-99769',
                'domain'            => null,
                'is_active'         => true,
                'depth'             => 0,
                'allows_subtenants' => false,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]
        );

        TenantContext::setById(self::TENANT_ID);
    }

    // ─── structural / metadata ─────────────────────────────────────────────────

    public function test_table_name(): void
    {
        $model = new TenantSafeguardingOption();
        $this->assertSame('tenant_safeguarding_options', $model->getTable());
    }

    public function test_timestamps_disabled(): void
    {
        $model = new TenantSafeguardingOption();
        $this->assertFalse($model->usesTimestamps());
    }

    public function test_fillable_contains_expected_fields(): void
    {
        $model = new TenantSafeguardingOption();
        $expected = [
            'tenant_id', 'option_key', 'option_type', 'label', 'description',
            'help_url', 'sort_order', 'is_active', 'is_required',
            'accepts_new_selections', 'select_options', 'triggers', 'preset_source',
        ];
        $this->assertSame($expected, $model->getFillable());
    }

    public function test_casts_are_correct(): void
    {
        $casts = (new TenantSafeguardingOption())->getCasts();
        $this->assertSame('integer', $casts['sort_order']);
        $this->assertSame('boolean', $casts['is_active']);
        $this->assertSame('boolean', $casts['is_required']);
        $this->assertSame('array', $casts['select_options']);
        $this->assertSame('array', $casts['triggers']);
    }

    public function test_uses_has_tenant_scope_trait(): void
    {
        $traits = class_uses_recursive(TenantSafeguardingOption::class);
        $this->assertContains(HasTenantScope::class, $traits);
    }

    // ─── relationships ─────────────────────────────────────────────────────────

    public function test_preferences_relationship_is_has_many(): void
    {
        $model = new TenantSafeguardingOption();
        $this->assertInstanceOf(HasMany::class, $model->preferences());
    }

    // ─── getTrigger() helper ───────────────────────────────────────────────────

    public function test_get_trigger_returns_true_for_truthy_key(): void
    {
        $model = new TenantSafeguardingOption([
            'triggers' => ['requires_vetted_interaction' => true],
        ]);
        $this->assertTrue($model->getTrigger('requires_vetted_interaction'));
    }

    public function test_get_trigger_returns_false_for_falsy_key(): void
    {
        $model = new TenantSafeguardingOption([
            'triggers' => ['requires_vetted_interaction' => false],
        ]);
        $this->assertFalse($model->getTrigger('requires_vetted_interaction'));
    }

    public function test_get_trigger_returns_false_for_missing_key(): void
    {
        $model = new TenantSafeguardingOption([
            'triggers' => [],
        ]);
        $this->assertFalse($model->getTrigger('nonexistent_key'));
    }

    public function test_get_trigger_returns_false_when_triggers_is_null(): void
    {
        $model = new TenantSafeguardingOption(['triggers' => null]);
        $this->assertFalse($model->getTrigger('any_key'));
    }

    // ─── getRequiredVettingType() helper ───────────────────────────────────────

    public function test_get_required_vetting_type_returns_value_when_present(): void
    {
        $model = new TenantSafeguardingOption([
            'triggers' => ['vetting_type_required' => 'dbs_check'],
        ]);
        $this->assertSame('dbs_check', $model->getRequiredVettingType());
    }

    public function test_get_required_vetting_type_returns_null_when_missing(): void
    {
        $model = new TenantSafeguardingOption([
            'triggers' => [],
        ]);
        $this->assertNull($model->getRequiredVettingType());
    }

    public function test_get_required_vetting_type_returns_null_when_triggers_null(): void
    {
        $model = new TenantSafeguardingOption(['triggers' => null]);
        $this->assertNull($model->getRequiredVettingType());
    }

    // ─── scopeActive query scope ───────────────────────────────────────────────

    public function test_scope_active_returns_only_active_options_ordered_by_sort_order(): void
    {
        // Insert: inactive first (sort_order=1), two active ones (sort_order=5,2)
        DB::table('tenant_safeguarding_options')->insert([
            [
                'tenant_id'   => self::TENANT_ID,
                'option_key'  => 'inactive_99769',
                'option_type' => 'checkbox',
                'label'       => 'Inactive Option',
                'sort_order'  => 1,
                'is_active'   => 0,
                'is_required' => 0,
                'created_at'  => now(),
            ],
            [
                'tenant_id'   => self::TENANT_ID,
                'option_key'  => 'active_b_99769',
                'option_type' => 'checkbox',
                'label'       => 'Active B',
                'sort_order'  => 5,
                'is_active'   => 1,
                'is_required' => 0,
                'created_at'  => now(),
            ],
            [
                'tenant_id'   => self::TENANT_ID,
                'option_key'  => 'active_a_99769',
                'option_type' => 'checkbox',
                'label'       => 'Active A',
                'sort_order'  => 2,
                'is_active'   => 1,
                'is_required' => 0,
                'created_at'  => now(),
            ],
        ]);

        $results = TenantSafeguardingOption::active()->get();

        // Only the two active rows
        $this->assertCount(2, $results);

        // Ordered by sort_order ascending: A (2) before B (5)
        $this->assertSame('Active A', $results->first()->label);
        $this->assertSame('Active B', $results->last()->label);
    }

    public function test_scope_active_excludes_inactive_options(): void
    {
        DB::table('tenant_safeguarding_options')->insert([
            'tenant_id'   => self::TENANT_ID,
            'option_key'  => 'inactive_only_99769',
            'option_type' => 'checkbox',
            'label'       => 'Should Not Appear',
            'sort_order'  => 1,
            'is_active'   => 0,
            'is_required' => 0,
            'created_at'  => now(),
        ]);

        $results = TenantSafeguardingOption::active()->get();
        $this->assertCount(0, $results);
    }
}
