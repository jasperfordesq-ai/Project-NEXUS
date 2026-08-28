<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\CronJobService;
use Illuminate\Support\Facades\DB;

/**
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class CronJobServiceTest extends TestCase
{
    private CronJobService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new CronJobService();
    }

    public function test_getStatus_returns_array(): void
    {
        DB::shouldReceive('table')->with('cron_jobs')->andReturnSelf();
        DB::shouldReceive('where')->andReturnSelf();
        DB::shouldReceive('orWhereNull')->andReturnSelf();
        DB::shouldReceive('orderBy')->andReturnSelf();
        DB::shouldReceive('get')->andReturn(collect([]));

        $result = $this->service->getStatus(2);
        $this->assertIsArray($result);
    }

}
