<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Http\Controllers\Api\EventRecurrenceCapabilityController;
use App\Models\User;
use App\Services\EventRecurrenceDefinitionBlueprintService;
use App\Services\EventRecurrenceMaterializationService;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventRecurrenceCapabilityControllerTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('events.recurrence.engine_v2_enabled', false);
        config()->set('events.recurrence.materialization.enabled', false);
        config()->set('events.recurrence.definition_blueprints.enabled', false);
    }

    public function test_route_is_authenticated_feature_gated_and_precedes_dynamic_event_lookup(): void
    {
        $routes = array_values(Route::getRoutes()->getRoutes());
        $capabilityIndex = null;
        $dynamicIndex = null;
        $capabilityRoute = null;
        foreach ($routes as $index => $route) {
            if ($route->uri() === 'api/v2/events/recurrence-capabilities'
                && in_array('GET', $route->methods(), true)) {
                $capabilityIndex = $index;
                $capabilityRoute = $route;
            }
            if ($route->uri() === 'api/v2/events/{id}'
                && in_array('GET', $route->methods(), true)) {
                $dynamicIndex = $index;
            }
        }

        self::assertInstanceOf(LaravelRoute::class, $capabilityRoute);
        self::assertSame(
            EventRecurrenceCapabilityController::class . '@show',
            $capabilityRoute->getActionName(),
        );
        self::assertContains('auth:sanctum', $capabilityRoute->middleware());
        self::assertContains('feature:events', $capabilityRoute->middleware());
        self::assertIsInt($capabilityIndex);
        self::assertIsInt($dynamicIndex);
        self::assertLessThan($dynamicIndex, $capabilityIndex);
    }

    public function test_endpoint_requires_authentication(): void
    {
        $this->apiGet('/v2/events/recurrence-capabilities')->assertUnauthorized();
    }

    public function test_engine_flag_off_response_is_v2_exact_private_and_non_sensitive(): void
    {
        // E-102: the legacy engine no longer exists, so the flag being off
        // must not make the contract claim it (52 occurrences, "legacy").
        config()->set('events.recurrence.max_occurrences', 366);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);
        $schemaReady = app(EventRecurrenceMaterializationService::class)->schemaAvailable();

        $response = $this->apiGet('/v2/events/recurrence-capabilities')
            ->assertOk()
            ->assertHeader('Pragma', 'no-cache')
            ->assertJsonPath('data.contract_version', 1)
            ->assertJsonPath('data.engine', 'v2')
            ->assertJsonPath('data.structured_input', true)
            ->assertJsonPath('data.supported_frequencies', ['daily', 'weekly', 'monthly', 'yearly'])
            ->assertJsonPath('data.max_occurrences', 366)
            ->assertJsonPath('data.supported_end_types', ['after_count', 'on_date'])
            ->assertJsonPath('data.supports_rolling_never', false)
            ->assertJsonPath('data.supports_effective_revisions', false)
            ->assertJsonPath('data.supports_definition_blueprints', false)
            ->assertJsonPath('data.schema_ready', $schemaReady)
            ->assertJsonPath('data.rollout_state', $schemaReady ? 'v2_finite' : 'v2_degraded');

        $cacheControl = (string) $response->headers->get('Cache-Control');
        self::assertStringContainsString('private', $cacheControl);
        self::assertStringContainsString('no-store', $cacheControl);
        $vary = array_map(
            'trim',
            explode(',', (string) $response->headers->get('Vary')),
        );
        self::assertContains('Authorization', $vary);
        self::assertContains('Cookie', $vary);
        self::assertContains('X-Tenant-ID', $vary);
        self::assertSame([
            'contract_version',
            'engine',
            'structured_input',
            'supported_frequencies',
            'max_occurrences',
            'supported_end_types',
            'supports_rolling_never',
            'supports_effective_revisions',
            'supports_definition_blueprints',
            'schema_ready',
            'rollout_state',
        ], array_keys((array) $response->json('data')));
        $encoded = $response->getContent();
        self::assertStringNotContainsString('tenant_id', $encoded);
        self::assertStringNotContainsString('information_schema', $encoded);
        self::assertStringNotContainsString('materialization_error', $encoded);
    }

    public function test_v2_runtime_contract_only_exposes_schema_backed_rollout_features(): void
    {
        config()->set('events.recurrence.engine_v2_enabled', true);
        config()->set('events.recurrence.max_occurrences', 800);
        config()->set('events.recurrence.materialization.enabled', true);
        config()->set('events.recurrence.definition_blueprints.enabled', true);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $schemaReady = app(EventRecurrenceMaterializationService::class)->schemaAvailable();
        $blueprintReady = $schemaReady
            && app(EventRecurrenceDefinitionBlueprintService::class)->schemaAvailable();
        $endTypes = $schemaReady
            ? ['after_count', 'on_date', 'never']
            : ['after_count', 'on_date'];
        $this->apiGet('/v2/events/recurrence-capabilities')
            ->assertOk()
            ->assertJsonPath('data.engine', 'v2')
            ->assertJsonPath('data.max_occurrences', 800)
            ->assertJsonPath('data.supported_end_types', $endTypes)
            ->assertJsonPath('data.supports_rolling_never', $schemaReady)
            ->assertJsonPath('data.supports_effective_revisions', $schemaReady)
            ->assertJsonPath('data.supports_definition_blueprints', $blueprintReady)
            ->assertJsonPath('data.schema_ready', $schemaReady)
            ->assertJsonPath(
                'data.rollout_state',
                $schemaReady ? 'v2_rolling' : 'v2_degraded',
            );
    }

    public function test_a_community_with_recurring_events_switched_off_is_offered_nothing_to_create(): void
    {
        // E-102: the create page offered "Repeat this event" and the save was
        // then refused with a 403 by EventsController::createRecurring().
        config()->set('events.recurrence.engine_v2_enabled', true);
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['events'] = array_merge($configuration['events'] ?? [], ['recurrence_enabled' => false]);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration),
        ]);
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        Sanctum::actingAs($user, ['*']);

        $this->apiGet('/v2/events/recurrence-capabilities')
            ->assertOk()
            ->assertJsonPath('data.engine', 'v2')
            ->assertJsonPath('data.supported_frequencies', [])
            ->assertJsonPath('data.supported_end_types', []);
    }

    public function test_feature_gate_is_resolved_for_the_authenticated_tenant(): void
    {
        $tenantTwoUser = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $tenant999User = User::factory()->forTenant(999)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $this->setEventsFeature($this->testTenantId, true);
        $this->setEventsFeature(999, false);

        Sanctum::actingAs($tenantTwoUser, ['*']);
        $this->apiGet('/v2/events/recurrence-capabilities')->assertOk();

        TenantContext::reset();
        Sanctum::actingAs($tenant999User, ['*']);
        $this->getJson('/api/v2/events/recurrence-capabilities', [
            'X-Tenant-ID' => '999',
            'Accept' => 'application/json',
        ])->assertForbidden()
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED');
    }

    private function setEventsFeature(int $tenantId, bool $enabled): void
    {
        DB::table('tenants')->where('id', $tenantId)->update([
            'features' => json_encode(array_merge(
                TenantFeatureConfig::FEATURE_DEFAULTS,
                ['events' => $enabled],
            ), JSON_THROW_ON_ERROR),
        ]);
        if ($tenantId === $this->testTenantId) {
            TenantContext::setById($tenantId);
        }
    }
}
