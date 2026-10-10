<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Http\Middleware\EnsureLegalAcceptance;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * F-589: creating an event from a template is creating an event. It must obey
 * the community's "who may create events" setting and the legal-acceptance
 * gate exactly as POST /v2/events does.
 */
final class EventTemplateCreationRoleTest extends TestCase
{
    use DatabaseTransactions;

    protected function setUp(): void
    {
        parent::setUp();
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'features' => json_encode(['events' => true], JSON_THROW_ON_ERROR),
        ]);
        TenantContext::reset();
        TenantContext::setById($this->testTenantId);
    }

    public function test_member_cannot_materialize_a_template_when_only_admins_may_create_events(): void
    {
        $owner = User::factory()->forTenant($this->testTenantId)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $sourceEventId = $this->sourceEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);

        $templateId = (int) $this->apiPost(
            "/v2/events/{$sourceEventId}/templates",
            [],
            ['Idempotency-Key' => 'f589-capture'],
        )->assertCreated()->json('data.template.id');

        $this->setEventConfig(['creation_role' => 'admins']);

        // Control: the ordinary create path refuses this member.
        $this->apiPost('/v2/events', [
            'title' => 'Direct create',
            'start_time' => CarbonImmutable::now('UTC')->addMonth()->toIso8601String(),
        ])->assertForbidden();

        $eventsBefore = DB::table('events')->where('tenant_id', $this->testTenantId)->count();
        $start = CarbonImmutable::now('UTC')->addMonths(2)->startOfHour();

        $this->apiPost(
            "/v2/event-templates/{$templateId}/materializations",
            [
                'template_version' => 1,
                'start_time' => $start->toIso8601String(),
                'end_time' => $start->addHours(2)->toIso8601String(),
            ],
            ['Idempotency-Key' => 'f589-materialize'],
        )->assertForbidden()
            ->assertJsonPath('errors.0.code', 'EVENT_TEMPLATE_FORBIDDEN');

        self::assertSame(
            $eventsBefore,
            DB::table('events')->where('tenant_id', $this->testTenantId)->count(),
            'A refused materialization must not create an event.',
        );
        self::assertSame(
            0,
            DB::table('event_template_materializations')->where('template_id', $templateId)->count(),
        );
    }

    public function test_template_and_recurring_creation_routes_carry_the_legal_acceptance_gate(): void
    {
        foreach ([
            'api/v2/events',
            'api/v2/events/recurring',
            'api/v2/event-templates/{templateId}/materializations',
        ] as $uri) {
            $route = null;
            foreach (Route::getRoutes() as $candidate) {
                if ($candidate->uri() === $uri && in_array('POST', $candidate->methods(), true)) {
                    $route = $candidate;
                    break;
                }
            }
            self::assertNotNull($route, "POST {$uri} is not registered.");
            $middleware = $route->gatherMiddleware();
            self::assertTrue(
                in_array('legal-acceptance', $middleware, true)
                    || in_array(EnsureLegalAcceptance::class, $middleware, true),
                "POST {$uri} creates an event and must carry the legal-acceptance gate.",
            );
        }
    }

    /** @param array<string,mixed> $settings */
    private function setEventConfig(array $settings): void
    {
        $raw = DB::table('tenants')->where('id', $this->testTenantId)->value('configuration');
        $configuration = is_string($raw) ? (json_decode($raw, true) ?: []) : [];
        $configuration['events'] = array_merge($configuration['events'] ?? [], $settings);
        DB::table('tenants')->where('id', $this->testTenantId)->update([
            'configuration' => json_encode($configuration),
        ]);
    }

    private function sourceEvent(int $ownerId): int
    {
        $start = CarbonImmutable::now('UTC')->addMonth()->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'F-589 template source',
            'description' => 'Reusable configuration.',
            'location' => 'Original venue',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'max_attendees' => 40,
            'is_online' => false,
            'allow_remote_attendance' => false,
            'federated_visibility' => 'none',
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'calendar_sequence' => 1,
            'is_recurring_template' => false,
            'occurrence_key' => 'f589:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
