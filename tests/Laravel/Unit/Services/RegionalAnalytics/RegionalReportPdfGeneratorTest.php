<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services\RegionalAnalytics;

use Tests\Laravel\TestCase;
use App\Services\RegionalAnalytics\RegionalReportPdfGenerator;
use App\Core\TenantContext;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;

/**
 * RegionalReportPdfGeneratorTest
 *
 * Tests PDF generation and storage. Storage::fake() intercepts the
 * Storage::put() call so no real disk writes occur. The returned URL
 * and the stored bytes are both asserted against the service contract.
 */
class RegionalReportPdfGeneratorTest extends TestCase
{
    use DatabaseTransactions;

    private const TENANT_ID = 2;

    private RegionalReportPdfGenerator $generator;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();
        Storage::fake(); // Intercept all Storage::put calls.
        TenantContext::setById(self::TENANT_ID);
        $this->generator = new RegionalReportPdfGenerator();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private function minimalPayload(): array
    {
        return [
            'generated_at' => '2026-01-01T00:00:00+00:00',
        ];
    }

    private function fullPayload(): array
    {
        return [
            'generated_at' => '2026-01-15T12:00:00+00:00',
            'engagement'   => [
                'active_members_bucket'    => '50-200',
                'categories_active_bucket' => '10-20',
                'partner_orgs_bucket'      => '<5',
                'volunteer_hours_rounded'  => 340,
                'event_participation_bucket' => '200-1000',
            ],
            'demand_supply' => [
                'cells' => [
                    [
                        'category_id'      => 1,
                        'postcode_3'       => 'D01',
                        'offers_bucket'    => '50-200',
                        'requests_bucket'  => '50-200',
                        'match_rate_bucket' => 72,
                    ],
                ],
            ],
            'demographics' => [
                'age_buckets' => [
                    '<25'   => '<50',
                    '25-44' => '50-200',
                    '45-64' => '50-200',
                    '65+'   => '<50',
                ],
                'gender_buckets' => [
                    'M'           => '50-200',
                    'F'           => '50-200',
                    'Other'       => '<10',
                    'Unspecified' => '<10',
                ],
            ],
            'footfall' => [
                'areas' => [
                    'listings' => [
                        'page_views_bucket'       => '200-1000',
                        'distinct_visitors_bucket' => '50-200',
                    ],
                ],
            ],
        ];
    }

    // ── URL / path contract ───────────────────────────────────────────────────

    public function test_generateAndStore_returns_the_private_path_not_a_public_address(): void
    {
        // Since F3 (2624e7da3) the PDF lives on the private disk and is reached
        // only through the signed RegionalReportDownloadLink, so the generator
        // returns the stored path, never a "/storage/..." address.
        $path = $this->generator->generateAndStore($this->minimalPayload(), 42, '2026-01');

        $this->assertStringStartsWith('regional-analytics/42/', $path);
        $this->assertStringNotContainsString('/storage/', $path);
        $this->assertTrue(Storage::disk(RegionalReportPdfGenerator::DISK)->exists($path));
    }

    public function test_generateAndStore_url_contains_subscription_id_and_period(): void
    {
        $url = $this->generator->generateAndStore($this->minimalPayload(), 99, '2026-06');

        $this->assertStringContainsString('/99/', $url);
        $this->assertStringContainsString('2026-06', $url);
    }

    public function test_generateAndStore_url_ends_with_pdf_extension(): void
    {
        $url = $this->generator->generateAndStore($this->minimalPayload(), 1, '2026-01');

        $this->assertStringEndsWith('.pdf', $url);
    }

    // ── PDF bytes ─────────────────────────────────────────────────────────────

    public function test_generateAndStore_writes_valid_pdf_to_storage(): void
    {
        $url = $this->generator->generateAndStore($this->minimalPayload(), 7, '2026-03');

        // Derive the storage path from the returned URL: strip leading '/storage/'
        $path = ltrim(str_replace('/storage/', '', $url), '/');

        Storage::assertExists($path);

        $bytes = Storage::get($path);
        $this->assertNotNull($bytes);
        // Valid PDF must start with the PDF magic header.
        $this->assertStringStartsWith('%PDF-', $bytes);
    }

    public function test_pdf_bytes_contain_eof_marker(): void
    {
        $url  = $this->generator->generateAndStore($this->minimalPayload(), 3, '2026-04');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('%%EOF', $bytes);
    }

    // ── Content sections ──────────────────────────────────────────────────────

    public function test_pdf_contains_period_label(): void
    {
        $url  = $this->generator->generateAndStore($this->minimalPayload(), 5, '2026-JUNE');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('2026-JUNE', $bytes);
    }

    public function test_pdf_contains_engagement_section_when_provided(): void
    {
        $url  = $this->generator->generateAndStore($this->fullPayload(), 10, '2026-Q1');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('REGIONAL ENGAGEMENT', $bytes);
        $this->assertStringContainsString('50-200', $bytes); // active_members_bucket
    }

    public function test_pdf_contains_demand_supply_cells_when_provided(): void
    {
        $url  = $this->generator->generateAndStore($this->fullPayload(), 11, '2026-Q1');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('DEMAND vs SUPPLY', $bytes);
        $this->assertStringContainsString('D01', $bytes);
    }

    public function test_pdf_contains_demographics_section_when_provided(): void
    {
        $url  = $this->generator->generateAndStore($this->fullPayload(), 12, '2026-Q1');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('DEMOGRAPHICS', $bytes);
        $this->assertStringContainsString('25-44', $bytes);
    }

    public function test_pdf_contains_footfall_section_when_provided(): void
    {
        $url  = $this->generator->generateAndStore($this->fullPayload(), 13, '2026-Q1');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('FOOTFALL', $bytes);
        $this->assertStringContainsString('listings', $bytes);
    }

    public function test_pdf_contains_privacy_footer(): void
    {
        $url  = $this->generator->generateAndStore($this->minimalPayload(), 14, '2026-Q2');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringContainsString('PRIVACY', $bytes);
        $this->assertStringContainsString('bucketed', $bytes);
    }

    public function test_pdf_omits_engagement_section_when_payload_empty(): void
    {
        // An empty payload should produce a valid PDF but without section [1].
        $url  = $this->generator->generateAndStore(['generated_at' => '2026-01-01'], 15, '2026-bare');
        $path = ltrim(str_replace('/storage/', '', $url), '/');
        $bytes = Storage::get($path);

        $this->assertStringNotContainsString('[1] REGIONAL ENGAGEMENT', $bytes);
    }

    public function test_each_call_produces_unique_filename(): void
    {
        $url1 = $this->generator->generateAndStore($this->minimalPayload(), 20, '2026-DUP');
        $url2 = $this->generator->generateAndStore($this->minimalPayload(), 20, '2026-DUP');

        // The random 8-hex suffix must make each filename unique.
        $this->assertNotSame($url1, $url2);
    }
}
