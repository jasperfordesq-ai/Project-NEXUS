<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\CaringCommunity\ExternalIntegrationBacklogService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\TestCase;

class ExternalIntegrationBacklogServiceTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();

        Queue::fake();
        TenantContext::setById($this->testTenantId);

        // Clean any existing caring.external_integrations key for this tenant
        // so tests always start from a known empty state.
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', ExternalIntegrationBacklogService::SETTING_KEY)
            ->delete();
    }

    private function service(): ExternalIntegrationBacklogService
    {
        return app(ExternalIntegrationBacklogService::class);
    }

    private function validPayload(array $overrides = []): array
    {
        return array_merge([
            'name'               => 'Test Integration',
            'category'           => 'banking',
            'owner_name'         => 'ACME Bank',
            'owner_email'        => 'contact@acme-bank.test',
            'status'             => 'proposed',
            'interface_spec_url' => '',
            'dsa_status'         => 'not_required',
            'sandbox_url'        => '',
            'notes'              => 'Initial backlog entry.',
        ], $overrides);
    }

    // -------------------------------------------------------------------------
    // list()
    // -------------------------------------------------------------------------

    public function test_list_returns_empty_when_no_items_stored(): void
    {
        $result = $this->service()->list($this->testTenantId);

        $this->assertIsArray($result);
        $this->assertArrayHasKey('items', $result);
        $this->assertArrayHasKey('last_updated_at', $result);
        $this->assertSame([], $result['items']);
        $this->assertNull($result['last_updated_at']);
    }

    // -------------------------------------------------------------------------
    // seedDefaults()
    // -------------------------------------------------------------------------

    public function test_seed_defaults_creates_six_proposed_items(): void
    {
        $result = $this->service()->seedDefaults($this->testTenantId);

        $this->assertArrayHasKey('items', $result);
        $this->assertCount(6, $result['items']);

        foreach ($result['items'] as $item) {
            $this->assertSame('proposed', $item['status']);
            $this->assertNotEmpty($item['id']);
            $this->assertNotEmpty($item['copy_code']);
            $this->assertSame('', $item['name']);
        }
    }

    public function test_seed_defaults_is_idempotent_and_returns_error_on_second_call(): void
    {
        $this->service()->seedDefaults($this->testTenantId);
        $second = $this->service()->seedDefaults($this->testTenantId);

        $this->assertArrayHasKey('error', $second);
        $this->assertSame('already_seeded', $second['error']);

        // The backlog must still contain only the original 6 items.
        $list = $this->service()->list($this->testTenantId);
        $this->assertCount(6, $list['items']);
    }

    // -------------------------------------------------------------------------
    // create()
    // -------------------------------------------------------------------------

    public function test_create_persists_item_and_returns_it(): void
    {
        $result = $this->service()->create($this->testTenantId, $this->validPayload());

        $this->assertArrayHasKey('item', $result);
        $item = $result['item'];
        $this->assertNotEmpty($item['id']);
        $this->assertStringStartsWith('intg_', $item['id']);
        $this->assertSame('Test Integration', $item['name']);
        $this->assertSame('banking', $item['category']);
        $this->assertSame('proposed', $item['status']);
        $this->assertSame('not_required', $item['dsa_status']);

        // list() must reflect the new item.
        $list = $this->service()->list($this->testTenantId);
        $this->assertCount(1, $list['items']);
        $this->assertSame($item['id'], $list['items'][0]['id']);
    }

    public function test_create_returns_validation_error_when_name_empty(): void
    {
        $result = $this->service()->create($this->testTenantId, $this->validPayload(['name' => '']));

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('name', $fields);
    }

    public function test_create_returns_validation_error_for_invalid_category(): void
    {
        $result = $this->service()->create($this->testTenantId, $this->validPayload(['category' => 'unicorn']));

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('category', $fields);
    }

    public function test_create_returns_validation_error_for_invalid_status(): void
    {
        $result = $this->service()->create($this->testTenantId, $this->validPayload(['status' => 'unknown']));

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('status', $fields);
    }

    public function test_create_returns_validation_error_for_invalid_owner_email(): void
    {
        $result = $this->service()->create($this->testTenantId, $this->validPayload(['owner_email' => 'not-an-email']));

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('owner_email', $fields);
    }

    public function test_create_returns_validation_error_for_invalid_interface_spec_url(): void
    {
        $result = $this->service()->create(
            $this->testTenantId,
            $this->validPayload(['interface_spec_url' => 'not-a-url'])
        );

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('interface_spec_url', $fields);
    }

    public function test_create_multiple_items_are_all_persisted(): void
    {
        $this->service()->create($this->testTenantId, $this->validPayload(['name' => 'Item A', 'category' => 'banking']));
        $this->service()->create($this->testTenantId, $this->validPayload(['name' => 'Item B', 'category' => 'postal']));

        $list = $this->service()->list($this->testTenantId);
        $this->assertCount(2, $list['items']);
        $names = array_column($list['items'], 'name');
        $this->assertContains('Item A', $names);
        $this->assertContains('Item B', $names);
    }

    // -------------------------------------------------------------------------
    // update()
    // -------------------------------------------------------------------------

    public function test_update_modifies_existing_item_in_place(): void
    {
        $created = $this->service()->create($this->testTenantId, $this->validPayload());
        $id      = $created['item']['id'];

        $updated = $this->service()->update($this->testTenantId, $id, [
            'name'   => 'Renamed Integration',
            'status' => 'scoping',
        ]);

        $this->assertArrayHasKey('item', $updated);
        $this->assertSame('Renamed Integration', $updated['item']['name']);
        $this->assertSame('scoping', $updated['item']['status']);
        // Unchanged fields must be preserved.
        $this->assertSame('banking', $updated['item']['category']);

        // list() must reflect the update.
        $list = $this->service()->list($this->testTenantId);
        $this->assertSame('Renamed Integration', $list['items'][0]['name']);
    }

    public function test_update_returns_not_found_for_unknown_id(): void
    {
        $result = $this->service()->update($this->testTenantId, 'intg_doesnotexist', ['name' => 'Nope']);

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('not_found', $result['error']);
    }

    public function test_update_returns_validation_error_for_invalid_partial_fields(): void
    {
        $created = $this->service()->create($this->testTenantId, $this->validPayload());
        $id      = $created['item']['id'];

        $result = $this->service()->update($this->testTenantId, $id, ['status' => 'bad_status']);

        $this->assertArrayHasKey('errors', $result);
        $fields = array_column($result['errors'], 'field');
        $this->assertContains('status', $fields);
    }

    // -------------------------------------------------------------------------
    // delete()
    // -------------------------------------------------------------------------

    public function test_delete_removes_item_from_list(): void
    {
        $created = $this->service()->create($this->testTenantId, $this->validPayload());
        $id      = $created['item']['id'];

        $del = $this->service()->delete($this->testTenantId, $id);

        $this->assertTrue($del['ok'] ?? false);

        $list = $this->service()->list($this->testTenantId);
        $this->assertCount(0, $list['items']);
    }

    public function test_delete_returns_not_found_for_unknown_id(): void
    {
        $result = $this->service()->delete($this->testTenantId, 'intg_doesnotexist');

        $this->assertArrayHasKey('error', $result);
        $this->assertSame('not_found', $result['error']);
    }

    public function test_delete_removes_only_the_targeted_item(): void
    {
        $a = $this->service()->create($this->testTenantId, $this->validPayload(['name' => 'Keep Me', 'category' => 'payment']));
        $b = $this->service()->create($this->testTenantId, $this->validPayload(['name' => 'Delete Me', 'category' => 'postal']));

        $this->service()->delete($this->testTenantId, $b['item']['id']);

        $list = $this->service()->list($this->testTenantId);
        $this->assertCount(1, $list['items']);
        $this->assertSame($a['item']['id'], $list['items'][0]['id']);
    }

    // -------------------------------------------------------------------------
    // tenant isolation
    // -------------------------------------------------------------------------

    public function test_items_are_isolated_by_tenant(): void
    {
        // Create an item for tenant 999.
        DB::table('tenant_settings')
            ->where('tenant_id', 999)
            ->where('setting_key', ExternalIntegrationBacklogService::SETTING_KEY)
            ->delete();

        $this->service()->create(999, $this->validPayload(['name' => 'Tenant 999 Item']));
        $this->service()->create($this->testTenantId, $this->validPayload(['name' => 'Tenant 2 Item']));

        $listTenant2   = $this->service()->list($this->testTenantId);
        $listTenant999 = $this->service()->list(999);

        $this->assertCount(1, $listTenant2['items']);
        $this->assertSame('Tenant 2 Item', $listTenant2['items'][0]['name']);

        $this->assertCount(1, $listTenant999['items']);
        $this->assertSame('Tenant 999 Item', $listTenant999['items'][0]['name']);

        // Clean up tenant 999's row (not rolled back by DatabaseTransactions because
        // the base-class setup inserts tenant 999 outside a transaction boundary).
        DB::table('tenant_settings')
            ->where('tenant_id', 999)
            ->where('setting_key', ExternalIntegrationBacklogService::SETTING_KEY)
            ->delete();
    }
}
