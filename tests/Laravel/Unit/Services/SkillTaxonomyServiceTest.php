<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\SkillTaxonomyService;
use Illuminate\Support\Facades\DB;

class SkillTaxonomyServiceTest extends TestCase
{
    private SkillTaxonomyService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new SkillTaxonomyService();
    }

    // ── createCategory ──

    public function test_createCategory_rejects_empty_name(): void
    {
        $result = $this->service->createCategory(['name' => '']);
        $this->assertNull($result);
        $this->assertEquals('VALIDATION_ERROR', $this->service->getErrors()[0]['code']);
    }

    public function test_createCategory_rejects_name_over_100_chars(): void
    {
        $result = $this->service->createCategory(['name' => str_repeat('a', 101)]);
        $this->assertNull($result);
    }

    public function test_createCategory_rejects_nonexistent_parent(): void
    {
        DB::shouldReceive('table->where->where->exists')->andReturn(false);

        $result = $this->service->createCategory(['name' => 'Test', 'parent_id' => 9999]);
        $this->assertNull($result);
        $this->assertEquals('NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    // ── updateCategory ──

    public function test_updateCategory_fails_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->exists')->andReturn(false);

        $result = $this->service->updateCategory(999, ['name' => 'New']);
        $this->assertFalse($result);
        $this->assertEquals('NOT_FOUND', $this->service->getErrors()[0]['code']);
    }

    public function test_updateCategory_returns_true_with_no_changes(): void
    {
        DB::shouldReceive('table->where->where->exists')->andReturn(true);

        $result = $this->service->updateCategory(1, []);
        $this->assertTrue($result);
    }

    // ── deleteCategory ──

    public function test_deleteCategory_hard_fails_with_dependencies(): void
    {
        DB::shouldReceive('table->where->where->count')->andReturn(5);

        $result = $this->service->deleteCategory(1, hard: true);
        $this->assertFalse($result);
        $this->assertEquals('HAS_DEPENDENCIES', $this->service->getErrors()[0]['code']);
    }

    public function test_deleteCategory_soft_deactivates(): void
    {
        DB::shouldReceive('table->where->where->update')->once();

        $result = $this->service->deleteCategory(1, hard: false);
        $this->assertTrue($result);
    }

    // ── addUserSkill ──

    public function test_addUserSkill_rejects_empty_name(): void
    {
        $result = $this->service->addUserSkill(1, ['skill_name' => '']);
        $this->assertNull($result);
    }

    public function test_addUserSkill_rejects_duplicate(): void
    {
        DB::shouldReceive('table->where->where->where->exists')->andReturn(true);

        $result = $this->service->addUserSkill(1, ['skill_name' => 'PHP']);
        $this->assertNull($result);
        $this->assertEquals('DUPLICATE', $this->service->getErrors()[0]['code']);
    }

    // ── removeSkill ──

    public function test_removeSkill_returns_false_when_not_found(): void
    {
        // removeSkill scopes by id, user_id AND tenant_id → three where() calls.
        DB::shouldReceive('table->where->where->where->delete')->andReturn(0);

        $result = $this->service->removeSkill(1, 999);
        $this->assertFalse($result);
    }

    // ── updateUserSkill ──

    public function test_updateUserSkill_fails_when_not_found(): void
    {
        DB::shouldReceive('table->where->where->where->exists')->andReturn(false);

        $result = $this->service->updateUserSkill(1, 999, ['proficiency' => 'expert']);
        $this->assertFalse($result);
    }

    public function test_updateUserSkill_returns_true_with_no_changes(): void
    {
        DB::shouldReceive('table->where->where->where->exists')->andReturn(true);

        $result = $this->service->updateUserSkill(1, 1, []);
        $this->assertTrue($result);
    }

    // ── getProficiencyWeightedSkills ──

    public function test_getProficiencyWeightedSkills_returns_array(): void
    {
        DB::shouldReceive('table->where->where->select->get')->andReturn(collect([]));

        $result = SkillTaxonomyService::getProficiencyWeightedSkills(1, $this->testTenantId);
        $this->assertIsArray($result);
    }

    // ── search ──

    public function test_search_returns_array(): void
    {
        // search() now scopes by tenant_id (commit 833dd3bf8), adding a third
        // ->where() before ->orderBy(): tenant_id, is_active, name LIKE.
        DB::shouldReceive('table->where->where->where->orderBy->limit->get->map->all')->andReturn([]);

        $result = $this->service->search('test');
        $this->assertIsArray($result);
    }
}
