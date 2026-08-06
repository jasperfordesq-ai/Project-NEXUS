<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Performance;

use App\Models\User;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Pins the /v2/admin/performance/summary contract to what the React page reads.
 *
 * 🔴 Why this test exists, specifically. The admin Performance page shipped
 * reading /v2/metrics/summary — the event-counter endpoint, which returns
 * period/total_events/events_by_type and none of the keys the page uses. The
 * page crashed on `summary.memory_spikes.length`. Its own tests passed
 * throughout, because every one of them mocked a payload in exactly the shape
 * the page wanted, and no test ever compared that shape to a real response.
 *
 * So this test asserts the KEY NAMES, not just that a 200 came back. If you
 * rename a key here you must rename it in PerformanceDashboard.tsx in the same
 * commit, and vice versa.
 */
class PerformanceSummaryContractTest extends TestCase
{
    use DatabaseTransactions;

    /**
     * Every key PerformanceDashboard.tsx reads off the summary payload.
     */
    private const REQUIRED_KEYS = [
        'slowest_requests',
        'slowest_queries',
        'memory_spikes',
        'request_volume',
        'n_plus_one_warnings',
        'total_requests',
        'total_slow_queries',
    ];

    public function test_summary_returns_every_key_the_page_reads(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/performance/summary?hours=24');

        $response->assertStatus(200);

        $data = $response->json('data');
        $this->assertIsArray($data);

        foreach (self::REQUIRED_KEYS as $key) {
            $this->assertArrayHasKey($key, $data, "Summary is missing '{$key}', which the admin page reads.");
        }

        // The three list keys must be arrays even with nothing recorded — the
        // page calls .length and .map() on them without guarding.
        $this->assertIsArray($data['slowest_requests']);
        $this->assertIsArray($data['slowest_queries']);
        $this->assertIsArray($data['memory_spikes']);
        $this->assertIsInt($data['n_plus_one_warnings']);
        $this->assertIsInt($data['total_requests']);
        $this->assertIsInt($data['total_slow_queries']);
    }

    public function test_summary_states_whether_recording_is_switched_on(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        config(['performance.enabled' => false]);

        $response = $this->apiGet('/v2/admin/performance/summary');

        $response->assertStatus(200);
        // Without this the page cannot tell "nothing was slow" from "nothing is
        // being measured", and an empty report would imply the platform is fast.
        $this->assertFalse($response->json('meta.recording_enabled'));
    }

    public function test_summary_reports_recorded_rows_with_derived_warnings(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        config([
            'performance.thresholds.slow_request_ms' => 1000,
            'performance.thresholds.memory_spike_mb' => 96,
            'performance.thresholds.many_queries' => 50,
        ]);

        $sampleId = DB::table('performance_request_samples')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $admin->id,
            'method' => 'GET',
            'endpoint' => '/api/v2/listings',
            'status_code' => 200,
            'duration_ms' => 2500.00,
            'query_count' => 64,
            'memory_mb' => 40.00,
            'peak_memory_mb' => 128.00,
            'n_plus_one_count' => 1,
            'max_repeated_query_count' => 42,
            'created_at' => now()->subMinutes(5),
        ]);

        DB::table('performance_query_samples')->insert([
            'tenant_id' => $this->testTenantId,
            'request_sample_id' => $sampleId,
            'duration_ms' => 780.00,
            'sql_text' => 'select * from `listings` where `tenant_id` = ? and `id` = ?',
            'caller_class' => 'App\\Services\\ListingService',
            'caller_function' => 'find',
            'caller_file' => '/var/www/html/app/Services/ListingService.php',
            'caller_line' => 214,
            'created_at' => now()->subMinutes(5),
        ]);

        DB::table('performance_request_hourly')->insert([
            'tenant_id' => $this->testTenantId,
            'bucket_hour' => now()->format('Y-m-d H:00:00'),
            'request_count' => 137,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->apiGet('/v2/admin/performance/summary?hours=24');
        $response->assertStatus(200);

        $data = $response->json('data');

        $this->assertCount(1, $data['slowest_requests']);
        $this->assertSame('/api/v2/listings', $data['slowest_requests'][0]['endpoint']);
        $this->assertSame(64, $data['slowest_requests'][0]['query_count']);

        // Warnings are derived from the row's own numbers, so a threshold change
        // re-labels history instead of leaving a stale stored label behind.
        $warnings = $data['slowest_requests'][0]['warnings'];
        $this->assertContains('slow_request', $warnings);
        $this->assertContains('high_memory', $warnings);
        $this->assertContains('n_plus_one', $warnings);
        $this->assertContains('many_queries', $warnings);

        $this->assertCount(1, $data['memory_spikes']);
        // assertEquals, not assertSame: a whole-number float serialises to JSON
        // as 128, so the decoded value is an int.
        $this->assertEquals(128.0, $data['memory_spikes'][0]['peak_memory_mb']);

        $this->assertCount(1, $data['slowest_queries']);
        // The page reads 'sql'; the column is 'sql_text'. Renaming one without
        // the other is exactly the class of mistake this file guards.
        $this->assertArrayHasKey('sql', $data['slowest_queries'][0]);
        $this->assertSame('find', $data['slowest_queries'][0]['caller']['function']);

        $this->assertSame(137, $data['total_requests']);
        $this->assertSame(1, $data['total_slow_queries']);
        $this->assertSame(1, $data['n_plus_one_warnings']);
        $this->assertNotEmpty($data['request_volume']);
    }

    public function test_summary_never_shows_another_tenants_samples(): void
    {
        $otherTenantId = $this->testTenantId + 1000;

        DB::table('performance_request_samples')->insert([
            'tenant_id' => $otherTenantId,
            'user_id' => null,
            'method' => 'GET',
            'endpoint' => '/api/v2/other-tenant-secret',
            'status_code' => 200,
            'duration_ms' => 9999.00,
            'query_count' => 1,
            'memory_mb' => 10.00,
            'peak_memory_mb' => 500.00,
            'n_plus_one_count' => 3,
            'max_repeated_query_count' => 90,
            'created_at' => now(),
        ]);

        DB::table('performance_request_hourly')->insert([
            'tenant_id' => $otherTenantId,
            'bucket_hour' => now()->format('Y-m-d H:00:00'),
            'request_count' => 5000,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/performance/summary?hours=24');
        $response->assertStatus(200);

        $body = $response->getContent();
        $this->assertIsString($body);
        $this->assertStringNotContainsString('other-tenant-secret', $body);

        $data = $response->json('data');
        $this->assertSame(0, $data['total_requests']);
        $this->assertSame([], $data['memory_spikes']);
    }

    public function test_summary_refuses_a_regular_member(): void
    {
        $member = User::factory()->forTenant($this->testTenantId)->create();
        Sanctum::actingAs($member);

        $this->apiGet('/v2/admin/performance/summary')->assertStatus(403);
    }

    public function test_summary_refuses_an_unauthenticated_caller(): void
    {
        $this->apiGet('/v2/admin/performance/summary')->assertStatus(401);
    }

    public function test_summary_clamps_an_absurd_window(): void
    {
        $admin = User::factory()->forTenant($this->testTenantId)->admin()->create();
        Sanctum::actingAs($admin);

        $response = $this->apiGet('/v2/admin/performance/summary?hours=999999');

        $response->assertStatus(200);
        $this->assertSame(
            (int) config('performance.limits.max_window_hours'),
            $response->json('data.window_hours')
        );
    }
}
