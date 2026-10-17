<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\VolunteerFormService;
use App\Models\VolAccessibilityNeed;
use Mockery;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class VolunteerFormServiceTest extends TestCase
{
    private $accessibilityNeedAlias;

    protected function setUp(): void
    {
        // App\Models\VolAccessibilityNeed may already be
        // autoloaded by app boot or an earlier test in the combined run, so the
        // alias mocks MUST be created before parent::setUp() and tolerate the
        // classes already existing. shouldIgnoreMissing() makes boot-time/static
        // calls no-ops; per-test expectations are layered on the shared instances.
        $this->accessibilityNeedAlias = Mockery::mock('alias:' . VolAccessibilityNeed::class)->shouldIgnoreMissing();
        parent::setUp();
    }

    public function test_getAccessibilityNeeds_returns_empty_on_error(): void
    {
        $mock = $this->accessibilityNeedAlias;
        $mock->shouldReceive('where')->andThrow(new \Exception('DB error'));

        $result = VolunteerFormService::getAccessibilityNeeds(1, 2);
        $this->assertIsArray($result);
        $this->assertEmpty($result);
    }
}
