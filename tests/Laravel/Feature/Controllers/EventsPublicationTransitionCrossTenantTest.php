<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Controllers;

use App\Models\Event;
use App\Models\User;
use App\Services\TokenService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\TestCase;

/**
 * Regression cover for the ACTOR lookup in
 * EventsController::publicationTransition().
 *
 * The controller resolved the caller with `WHERE id = ? AND tenant_id = ?`
 * against the acting tenant, so POST /v2/events/{id}/publish 403'd every
 * caller whose account row lives on another tenant — before the workflow
 * service could authorize. The Authenticate middleware's JWT branch admits
 * cross-tenant requests only for platform super admins, so exactly those
 * callers were the ones the controller then refused.
 *
 * These requests carry a real JWT (TokenService), NOT Sanctum::actingAs():
 * the guard branch applies its own cross-tenant 403 and would mask the
 * behaviour under test. Production traffic takes the JWT branch.
 */
final class EventsPublicationTransitionCrossTenantTest extends TestCase
{
    use DatabaseTransactions;

    private const ACTING_TENANT = 2;
    private const HOME_TENANT = 999;

    private function draftEventOwnedBy(int $organizerId): Event
    {
        $event = Event::factory()->forTenant(self::ACTING_TENANT)->create([
            'user_id' => $organizerId,
        ]);
        DB::table('events')->where('id', $event->id)->update([
            'status' => 'draft',
            'publication_status' => 'draft',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
        ]);

        return $event->fresh() ?? $event;
    }

    private function bearerHeaders(User $user): array
    {
        $token = app(TokenService::class)->generateToken(
            (int) $user->id,
            self::ACTING_TENANT,
        );

        return ['Authorization' => 'Bearer ' . $token];
    }

    public function test_platform_super_admin_from_another_tenant_can_publish(): void
    {
        $admin = User::factory()->forTenant(self::HOME_TENANT)->create([
            'status' => 'active',
            'is_approved' => true,
            'is_super_admin' => 1,
        ]);
        $event = $this->draftEventOwnedBy((int) $admin->id);

        $response = $this->postJson(
            "/api/v2/events/{$event->id}/publish",
            [],
            $this->bearerHeaders($admin),
        );

        $response->assertStatus(200);
        self::assertSame(
            'published',
            (string) DB::table('events')->where('id', $event->id)->value('publication_status'),
        );
    }

    public function test_same_tenant_organizer_can_still_publish(): void
    {
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create([
            'status' => 'active',
            'is_approved' => true,
        ]);
        $event = $this->draftEventOwnedBy((int) $organizer->id);

        $response = $this->postJson(
            "/api/v2/events/{$event->id}/publish",
            [],
            $this->bearerHeaders($organizer),
        );

        $response->assertStatus(200);
        self::assertSame(
            'published',
            (string) DB::table('events')->where('id', $event->id)->value('publication_status'),
        );
    }

    public function test_same_tenant_stranger_is_still_refused(): void
    {
        $organizer = User::factory()->forTenant(self::ACTING_TENANT)->create(['status' => 'active']);
        $event = $this->draftEventOwnedBy((int) $organizer->id);
        $stranger = User::factory()->forTenant(self::ACTING_TENANT)->create([
            'status' => 'active',
            'is_approved' => true,
            'role' => 'member',
        ]);

        $response = $this->postJson(
            "/api/v2/events/{$event->id}/publish",
            [],
            $this->bearerHeaders($stranger),
        );

        $response->assertStatus(403);
        self::assertSame(
            'draft',
            (string) DB::table('events')->where('id', $event->id)->value('publication_status'),
        );
    }
}
