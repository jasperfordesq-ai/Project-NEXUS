<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Services\CaringCommunity\PilotDisclosurePackService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class PilotDisclosurePackServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        Queue::fake();

        // Remove any pre-existing disclosure pack row for the test tenant.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', PilotDisclosurePackService::SETTING_KEY)
            ->delete();
    }

    private function service(): PilotDisclosurePackService
    {
        return app(PilotDisclosurePackService::class);
    }

    // ──────────────────────────────────────────────────────────────────────
    // defaults()
    // ──────────────────────────────────────────────────────────────────────

    public function test_defaults_contains_all_top_level_sections(): void
    {
        $d = $this->service()->defaults();

        $expectedSections = [
            'controller',
            'processor',
            'data_categories',
            'lawful_basis',
            'retention_defaults',
            'data_subject_rights',
            'federation',
            'isolated_node',
            'incident_response',
            'cross_border_transfers',
            'amendments',
        ];

        foreach ($expectedSections as $section) {
            $this->assertArrayHasKey($section, $d, "Missing section: $section");
        }
    }

    public function test_defaults_processor_name_is_project_nexus(): void
    {
        $d = $this->service()->defaults();

        $this->assertSame('Project NEXUS / Jasper Ford', $d['processor']['name']);
    }

    public function test_defaults_processor_has_five_sub_processors(): void
    {
        $d = $this->service()->defaults();

        $this->assertCount(5, $d['processor']['sub_processors']);
    }

    public function test_defaults_incident_response_notification_window_is_72(): void
    {
        $d = $this->service()->defaults();

        $this->assertSame(72, $d['incident_response']['notification_window_hours']);
    }

    public function test_defaults_federation_disabled_by_default(): void
    {
        $d = $this->service()->defaults();

        $this->assertFalse($d['federation']['enabled']);
    }

    public function test_defaults_data_subject_rights_all_true(): void
    {
        $d = $this->service()->defaults();

        foreach (['access', 'export', 'rectify', 'erase', 'restrict', 'object', 'portability'] as $right) {
            $this->assertTrue($d['data_subject_rights'][$right], "Right '$right' should be true by default");
        }
    }

    // ──────────────────────────────────────────────────────────────────────
    // get() — no stored data
    // ──────────────────────────────────────────────────────────────────────

    public function test_get_returns_defaults_when_no_stored_pack(): void
    {
        $result = $this->service()->get($this->testTenantId);

        $this->assertArrayHasKey('pack', $result);
        $this->assertArrayHasKey('last_updated_at', $result);
        $this->assertArrayHasKey('is_customised', $result);

        $this->assertFalse($result['is_customised']);
        $this->assertNull($result['last_updated_at']);
    }

    public function test_get_pack_contains_defaults_when_nothing_stored(): void
    {
        $pack = $this->service()->get($this->testTenantId)['pack'];

        $this->assertSame(72, $pack['incident_response']['notification_window_hours']);
        $this->assertSame('Project NEXUS / Jasper Ford', $pack['processor']['name']);
        $this->assertFalse($pack['federation']['enabled']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // update() — happy paths
    // ──────────────────────────────────────────────────────────────────────

    public function test_update_persists_controller_name(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'Stadt Zürich'],
        ]);

        $this->assertArrayHasKey('pack', $result);
        $this->assertSame('Stadt Zürich', $result['pack']['controller']['name']);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertSame('Stadt Zürich', $fresh['pack']['controller']['name']);
    }

    public function test_update_marks_pack_as_customised(): void
    {
        $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'Kanton Bern'],
        ]);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertTrue($fresh['is_customised']);
    }

    public function test_update_sets_last_updated_at(): void
    {
        $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'Test'],
        ]);

        $fresh = $this->service()->get($this->testTenantId);
        $this->assertNotNull($fresh['last_updated_at']);
    }

    public function test_update_deep_merges_preserving_processor_defaults(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'Stadt Zürich'],
        ]);

        // processor.name should still be the platform default even though we didn't set it
        $this->assertSame('Project NEXUS / Jasper Ford', $result['pack']['processor']['name']);
    }

    public function test_update_overwrites_list_field_entirely(): void
    {
        // Lists (indexed arrays) are replaced, not merged.
        $result = $this->service()->update($this->testTenantId, [
            'processor' => [
                'sub_processors' => ['Custom Vendor A'],
            ],
        ]);

        $this->assertCount(1, $result['pack']['processor']['sub_processors']);
        $this->assertSame('Custom Vendor A', $result['pack']['processor']['sub_processors'][0]);
    }

    public function test_update_sets_incident_notification_window(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'incident_response' => ['notification_window_hours' => 48],
        ]);

        $this->assertSame(48, $result['pack']['incident_response']['notification_window_hours']);
    }

    public function test_update_partial_leaves_other_sections_intact(): void
    {
        // First set the controller name.
        $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'Winterthur'],
        ]);

        // Now update only incident_response.
        $this->service()->update($this->testTenantId, [
            'incident_response' => ['contact_email' => 'dpo@winterthur.ch'],
        ]);

        $fresh = $this->service()->get($this->testTenantId);
        // controller.name must survive the second update
        $this->assertSame('Winterthur', $fresh['pack']['controller']['name']);
        $this->assertSame('dpo@winterthur.ch', $fresh['pack']['incident_response']['contact_email']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // update() — validation failures
    // ──────────────────────────────────────────────────────────────────────

    public function test_update_rejects_invalid_incident_response_email(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'incident_response' => ['contact_email' => 'not-an-email'],
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('incident_response.contact_email', $fields);
    }

    public function test_update_rejects_notification_window_above_720(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'incident_response' => ['notification_window_hours' => 721],
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('incident_response.notification_window_hours', $fields);
    }

    public function test_update_rejects_notification_window_zero(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'incident_response' => ['notification_window_hours' => 0],
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('incident_response.notification_window_hours', $fields);
    }

    public function test_update_rejects_invalid_controller_contact_email(): void
    {
        $result = $this->service()->update($this->testTenantId, [
            'controller' => ['contact_email' => 'bad'],
        ]);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('controller.contact_email', $fields);
    }

    public function test_update_does_not_persist_when_validation_fails(): void
    {
        // Precondition: no stored pack.
        $before = $this->service()->get($this->testTenantId);
        $this->assertFalse($before['is_customised']);

        $this->service()->update($this->testTenantId, [
            'incident_response' => ['contact_email' => 'bad_email'],
        ]);

        // Must still show uncustomised.
        $after = $this->service()->get($this->testTenantId);
        $this->assertFalse($after['is_customised']);
    }

    public function test_update_accepts_empty_string_contact_email(): void
    {
        // Empty string is explicitly allowed (means "unset")
        $result = $this->service()->update($this->testTenantId, [
            'incident_response' => ['contact_email' => ''],
        ]);

        $this->assertArrayHasKey('pack', $result);
        $this->assertSame('', $result['pack']['incident_response']['contact_email']);
    }

    // ──────────────────────────────────────────────────────────────────────
    // renderMarkdown()
    // ──────────────────────────────────────────────────────────────────────

    public function test_render_markdown_returns_string_with_expected_sections(): void
    {
        $md = $this->service()->renderMarkdown($this->testTenantId);

        $this->assertIsString($md);
        $this->assertStringContainsString('# Swiss FADP / nDSG Disclosure Pack', $md);
        $this->assertStringContainsString('## 1. Controller', $md);
        $this->assertStringContainsString('## 2. Processor', $md);
        $this->assertStringContainsString('## 9. Incident response', $md);
        $this->assertStringContainsString('## 11. Amendments', $md);
    }

    public function test_render_markdown_includes_sub_processors(): void
    {
        $md = $this->service()->renderMarkdown($this->testTenantId);

        $this->assertStringContainsString('Microsoft Azure', $md);
        $this->assertStringContainsString('Cloudflare', $md);
        $this->assertStringContainsString('Stripe', $md);
    }

    // ──────────────────────────────────────────────────────────────────────
    // Tenant isolation
    // ──────────────────────────────────────────────────────────────────────

    public function test_get_is_isolated_per_tenant(): void
    {
        $this->service()->update($this->testTenantId, [
            'controller' => ['name' => 'My Tenant'],
        ]);

        // Different tenant (999) must still see defaults.
        $other = $this->service()->get(999);
        $this->assertSame('', $other['pack']['controller']['name']);
        $this->assertFalse($other['is_customised']);
    }
}
