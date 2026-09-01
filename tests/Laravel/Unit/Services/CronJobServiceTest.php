<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use Tests\Laravel\TestCase;
use App\Services\CronJobService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

/**
 * CronJobService — admin-facing cron status listing.
 *
 * These tests used to mock the whole query builder (DB::shouldReceive('orderBy')
 * ->andReturnSelf()), so the column names were never compared with a real table.
 * getStatus() ordered by `name`, which does not exist on `cron_jobs` — the column
 * is `job_name` — and every call threw "Unknown column 'name' in 'ORDER BY'".
 * A mock cannot catch that, so these now run against the real schema.
 *
 * @runTestsInSeparateProcesses
 * @preserveGlobalState disabled
 */
class CronJobServiceTest extends TestCase
{
    use DatabaseTransactions;

    private CronJobService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new CronJobService();
    }

    public function test_getStatus_runs_against_the_real_cron_jobs_table(): void
    {
        $result = $this->service->getStatus($this->testTenantId);

        $this->assertIsArray($result);
    }

    public function test_getStatus_returns_this_tenants_jobs_and_global_ones_in_name_order(): void
    {
        DB::table('cron_jobs')->insert([
            ['tenant_id' => $this->testTenantId, 'job_name' => 'zz-audit-probe-last', 'job_type' => 'test'],
            ['tenant_id' => $this->testTenantId, 'job_name' => 'aa-audit-probe-first', 'job_type' => 'test'],
        ]);

        $names = array_column($this->service->getStatus($this->testTenantId), 'job_name');
        $probes = array_values(array_filter($names, fn ($n) => str_contains((string) $n, 'audit-probe')));

        $this->assertSame(['aa-audit-probe-first', 'zz-audit-probe-last'], $probes);
    }

    public function test_getStatus_excludes_another_tenants_jobs(): void
    {
        // cron_jobs.tenant_id is a real foreign key, so this needs a tenant that
        // actually exists rather than an invented id.
        $otherTenantId = DB::table('tenants')
            ->where('id', '!=', $this->testTenantId)
            ->value('id');

        if ($otherTenantId === null) {
            $this->markTestSkipped('Needs a second tenant in the test database to prove cross-tenant exclusion.');
        }

        DB::table('cron_jobs')->insert([
            ['tenant_id' => $otherTenantId, 'job_name' => 'audit-probe-foreign', 'job_type' => 'test'],
        ]);

        $names = array_column($this->service->getStatus($this->testTenantId), 'job_name');

        $this->assertNotContains('audit-probe-foreign', $names);
    }
}
