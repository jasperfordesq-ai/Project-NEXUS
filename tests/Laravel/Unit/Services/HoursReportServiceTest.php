<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\HoursReportService;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

class HoursReportServiceTest extends TestCase
{
    private HoursReportService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new HoursReportService();
    }

    public function test_getHoursByCategory_returns_formatted_results(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) [
                'category_id' => 1,
                'category_name' => 'Gardening',
                'category_color' => '#10b981',
                'total_hours' => 25.5,
                'transaction_count' => 10,
                'unique_providers' => 5,
                'unique_receivers' => 4,
            ],
        ]);

        $result = $this->service->getHoursByCategory(2);

        $this->assertCount(1, $result);
        $this->assertSame('Gardening', $result[0]['category_name']);
        $this->assertSame(25.5, $result[0]['total_hours']);
        $this->assertSame(10, $result[0]['transaction_count']);
    }

    public function test_getHoursByCategory_null_category_defaults(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) [
                'category_id' => null,
                'category_name' => null,
                'category_color' => null,
                'total_hours' => 5,
                'transaction_count' => 2,
                'unique_providers' => 1,
                'unique_receivers' => 1,
            ],
        ]);

        $result = $this->service->getHoursByCategory(2);

        $this->assertSame('Uncategorized', $result[0]['category_name']);
        $this->assertSame('#6B7280', $result[0]['category_color']);
    }

    public function test_getHoursByCategory_with_date_range(): void
    {
        DB::shouldReceive('select')->once()->andReturn([]);

        $result = $this->service->getHoursByCategory(2, ['from' => '2026-01-01', 'to' => '2026-03-01']);

        $this->assertSame([], $result);
    }

    public function test_getHoursByMember_returns_paginated_data(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) [
                'user_id' => 1,
                // Consistent with the parts, as production rows are: UserObserver
                // keeps `users.name` in step with first_name/last_name, and
                // UserDisplayName::resolve() reads the stored name FIRST so an
                // organisation's trading name survives a select that omits
                // profile_type/organization_name.
                'name' => 'John Doe',
                'first_name' => 'John',
                'last_name' => 'Doe',
                'avatar_url' => null,
                'hours_given' => 10,
                'hours_received' => 5,
                'total_hours' => 15,
                'given_count' => 3,
                'received_count' => 2,
                'total_transactions' => 5,
            ],
        ]);
        DB::shouldReceive('selectOne')->once()->andReturn((object) ['total' => 1]);

        $result = $this->service->getHoursByMember(2);

        $this->assertArrayHasKey('data', $result);
        $this->assertArrayHasKey('total', $result);
        $this->assertSame(1, $result['total']);
        $this->assertSame('John Doe', $result['data'][0]['name']);
    }

    public function test_getHoursByMember_fallback_name(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) [
                'user_id' => 1, 'name' => 'FallbackName',
                'first_name' => '', 'last_name' => '',
                'avatar_url' => null, 'hours_given' => 0, 'hours_received' => 0,
                'total_hours' => 0, 'given_count' => 0, 'received_count' => 0,
                'total_transactions' => 0,
            ],
        ]);
        DB::shouldReceive('selectOne')->once()->andReturn((object) ['total' => 1]);

        $result = $this->service->getHoursByMember(2);
        $this->assertSame('FallbackName', $result['data'][0]['name']);
    }

    public function test_getHoursByPeriod_returns_monthly_breakdown(): void
    {
        DB::shouldReceive('select')->once()->andReturn([
            (object) [
                'period' => '2026-01',
                'period_label' => 'January 2026',
                'total_hours' => 50,
                'transaction_count' => 20,
                'unique_providers' => 8,
                'unique_receivers' => 10,
                'unique_participants' => 18,
            ],
        ]);

        $result = $this->service->getHoursByPeriod(2);

        $this->assertCount(1, $result);
        $this->assertSame('2026-01', $result[0]['period']);
    }

    public function test_getHoursSummary_returns_comprehensive_data(): void
    {
        DB::shouldReceive('selectOne')->andReturn(
            (object) [
                'total_hours' => 100, 'total_transactions' => 50,
                'avg_hours_per_transaction' => 2, 'max_single_transaction' => 8,
                'unique_providers' => 15, 'unique_receivers' => 20,
            ],
            (object) ['cnt' => 30],
            (object) ['hours' => 10, 'transactions' => 5],
            (object) ['hours' => 8, 'transactions' => 4],
        );

        $result = $this->service->getHoursSummary(2);

        $this->assertArrayHasKey('total_hours', $result);
        $this->assertArrayHasKey('participation_rate', $result);
        $this->assertArrayHasKey('this_month', $result);
        $this->assertArrayHasKey('last_month', $result);
        $this->assertArrayHasKey('month_over_month_change', $result);
    }

    public function test_getHoursSummary_zero_members_participation_rate(): void
    {
        DB::shouldReceive('selectOne')->andReturn(
            (object) [
                'total_hours' => 0, 'total_transactions' => 0,
                'avg_hours_per_transaction' => 0, 'max_single_transaction' => 0,
                'unique_providers' => 0, 'unique_receivers' => 0,
            ],
            (object) ['cnt' => 0],
            (object) ['hours' => 0, 'transactions' => 0],
            (object) ['hours' => 0, 'transactions' => 0],
        );

        $result = $this->service->getHoursSummary(2);
        $this->assertSame(0, $result['participation_rate']);
        $this->assertSame(0, $result['month_over_month_change']);
    }
}
