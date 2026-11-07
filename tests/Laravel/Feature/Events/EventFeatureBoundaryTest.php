<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Http\Controllers\Api\AdminEventsController;
use App\Http\Controllers\Api\EventRecurrenceCapabilityController;
use App\Http\Controllers\Api\EventStaffController;
use App\Http\Controllers\Api\EventsController;
use App\Models\User;
use App\Services\TenantFeatureConfig;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Routing\Route as LaravelRoute;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

final class EventFeatureBoundaryTest extends TestCase
{
    use DatabaseTransactions;

    private function authenticateAdmin(): User
    {
        $user = User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'admin',
            'status' => 'active',
            'is_approved' => true,
        ]);

        Sanctum::actingAs($user, ['*']);

        return $user;
    }

    private function setEventsFeature(?bool $enabled): void
    {
        $features = $enabled === null
            ? null
            : array_merge(TenantFeatureConfig::FEATURE_DEFAULTS, ['events' => $enabled]);

        DB::table('tenants')
            ->where('id', $this->testTenantId)
            ->update([
                'features' => $features === null
                    ? null
                    : json_encode($features, JSON_THROW_ON_ERROR),
            ]);

        TenantContext::setById($this->testTenantId);
    }

    private function findRoute(string $method, string $uri): ?LaravelRoute
    {
        foreach (Route::getRoutes() as $route) {
            if ($route->uri() === $uri && in_array($method, $route->methods(), true)) {
                return $route;
            }
        }

        return null;
    }

    public function test_every_first_party_events_api_route_has_the_feature_boundary(): void
    {
        $controllers = [
            EventsController::class,
            AdminEventsController::class,
            EventRecurrenceCapabilityController::class,
            EventStaffController::class,
        ];
        $eventRoutes = [];

        foreach (Route::getRoutes() as $route) {
            $controller = explode('@', $route->getActionName(), 2)[0];
            if (in_array($controller, $controllers, true)) {
                $eventRoutes[] = $route;
            }
        }

        // 46 with PUT /v2/events/{id}/image-description (AWID report, 7 Nov 2026).
        $this->assertCount(46, $eventRoutes, 'The first-party Events API route inventory changed.');

        foreach ($eventRoutes as $route) {
            $this->assertContains(
                'feature:events',
                $route->middleware(),
                sprintf('%s %s is missing the Events tenant feature boundary.', implode('|', $route->methods()), $route->uri())
            );
        }
    }

    public static function independentEventSurfaces(): array
    {
        return [
            'federation read API' => ['GET', 'api/v2/federation/events'],
            'federation ingest API' => ['POST', 'api/v2/federation/ingest/events'],
            'default municipality calendar' => ['GET', 'api/v2/municipality/events-calendar'],
            'scoped municipality calendar' => ['GET', 'api/v2/municipality/{municipalityCode}/events-calendar'],
            'Verein shared events' => ['GET', 'api/v2/vereine/{organizationId}/shared-events'],
        ];
    }

    /** @dataProvider independentEventSurfaces */
    public function test_federation_and_public_calendar_surfaces_are_not_coupled_to_the_tenant_events_feature(
        string $method,
        string $uri
    ): void {
        $route = $this->findRoute($method, $uri);

        $this->assertNotNull($route, "Expected route {$method} {$uri} is missing.");
        $this->assertNotContains('feature:events', $route->middleware());
    }

    public function test_broken_legacy_rsvp_route_is_removed(): void
    {
        $this->assertNull($this->findRoute('POST', 'api/events/rsvp'));
    }

    public static function gatedEndpointRepresentatives(): array
    {
        return [
            'primary Events API' => ['/v2/events/999999999'],
            'extended Events API' => ['/v2/events/999999999/reminders'],
            'staff management API' => ['/v2/events/999999999/staff'],
            'admin Events API' => ['/v2/admin/events/999999999'],
            'authenticated legacy Events API' => ['/events'],
        ];
    }

    /** @dataProvider gatedEndpointRepresentatives */
    public function test_disabled_events_feature_blocks_each_route_family_before_controller_work(string $uri): void
    {
        $this->authenticateAdmin();
        $this->setEventsFeature(false);

        $this->apiGet($uri)
            ->assertStatus(403)
            ->assertHeader('API-Version', '2.0')
            ->assertJsonPath('success', false)
            ->assertJsonPath('errors.0.code', 'FEATURE_DISABLED')
            ->assertJsonPath('errors.0.message', __('api.service_unavailable'));
    }

    public function test_explicitly_enabled_events_feature_proceeds_to_controller_validation(): void
    {
        $this->authenticateAdmin();
        $this->setEventsFeature(true);
        $before = DB::table('events')->where('tenant_id', $this->testTenantId)->count();

        $response = $this->apiPost('/v2/events', []);

        $response->assertStatus(422);
        $this->assertNotSame('FEATURE_DISABLED', $response->json('errors.0.code'));
        $this->assertSame(
            $before,
            DB::table('events')->where('tenant_id', $this->testTenantId)->count()
        );
    }

    public function test_default_events_feature_proceeds_to_controller_lookup(): void
    {
        $this->authenticateAdmin();
        $this->setEventsFeature(null);
        DB::table('events')->where('id', 999999999)->delete();

        $this->apiGet('/v2/events/999999999')
            ->assertStatus(404)
            ->assertJsonPath('errors.0.code', 'NOT_FOUND');
    }
}
