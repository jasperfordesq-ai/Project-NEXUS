<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventStaffRole;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationRetentionAuthorizationTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_retention_writes_follow_the_advertised_owner_boundary(): void
    {
        $owner = $this->eventUser();
        [$eventId, $start, $end] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($eventId, $owner, $start);
        $url = "/v2/events/{$eventId}/registration-product";
        Sanctum::actingAs($owner, ['*']);
        $this->apiGet($url . '/manage')->assertOk()->assertJsonPath('data.permissions.manage_retention', true);
        $preview = $this->apiPost($url . '/retention/dry-run', [
            'as_of' => $end->addDay()->toIso8601String(), 'idempotency_key' => 'owner-preview',
        ])->assertCreated();
        $previewId = (int) $preview->json('data.run.id');
        $responses = [];
        foreach ([EventStaffRole::RegistrationManager, EventStaffRole::CoOrganizer] as $role) {
            $staff = $this->eventUser();
            (new EventRoleService())->grant($eventId, (int) $staff->id, $role, $owner, now()->addMonth());
            Sanctum::actingAs($staff, ['*']);
            $this->apiGet($url . '/manage')->assertOk()->assertJsonPath('data.permissions.manage_retention', false);
            $responses[] = $this->apiPost($url . '/retention/dry-run', [
                'as_of' => $end->addDay()->toIso8601String(), 'idempotency_key' => 'staff-preview-' . $role->value,
            ]);
            $responses[] = $this->apiPost($url . "/retention/{$previewId}/apply", [
                'idempotency_key' => 'staff-apply-' . $role->value,
            ]);
        }
        self::assertSame([403, 403, 403, 403], array_map(fn ($response) => $response->status(), $responses));
        foreach ($responses as $response) {
            $response->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_FORBIDDEN');
        }
        self::assertSame(1, DB::table('event_registration_retention_runs')->where('event_id', $eventId)->count());
        Sanctum::actingAs($owner, ['*']);
        $this->apiPost($url . "/retention/{$previewId}/apply", ['idempotency_key' => 'owner-apply'])
            ->assertCreated()->assertJsonPath('data.run.mode', 'apply');
        $this->apiPost($url . "/retention/{$previewId}/apply", ['idempotency_key' => 'owner-apply'])
            ->assertOk()->assertJsonPath('data.idempotent_replay', true);
        self::assertSame(2, DB::table('event_registration_retention_runs')->where('event_id', $eventId)->count());
    }
}
