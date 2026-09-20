<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventStaffRole;
use App\Services\EventRegistrationRetentionService;
use App\Services\EventRoleService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationRetentionHistoryTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_history_is_paginated_event_bound_and_does_not_expose_internal_evidence(): void
    {
        $owner = $this->eventUser();
        [$eventId, $start, $end] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($eventId, $owner, $start);
        $retention = new EventRegistrationRetentionService();
        $ids = [];
        for ($i = 0; $i < 3; $i++) {
            $ids[] = (int) $retention->dryRun($eventId, $owner, $end->addDay(), 'history-preview-' . $i)['run']->id;
        }
        $appliedId = (int) $retention->apply($eventId, $ids[0], $owner, 'history-apply')['run']->id;
        [$otherId, $otherStart, $otherEnd] = $this->registrationEvent((int) $owner->id);
        $this->registrationSettings($otherId, $owner, $otherStart);
        $retention->dryRun($otherId, $owner, $otherEnd->addDay(), 'history-other');
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/retention";
        $first = $this->apiGet($url . '?per_page=2')->assertOk()
            ->assertJsonPath('data.event_id', $eventId)->assertJsonPath('data.permissions.manage_retention', true)
            ->assertJsonPath('data.pagination.total', 4)->assertJsonPath('data.pagination.next_page', 2)
            ->assertJsonPath('data.runs.0.id', $appliedId)->assertJsonPath('data.runs.0.dry_run_id', $ids[0]);
        self::assertStringContainsString('no-store', $first->headers->get('Cache-Control'));
        foreach ($first->json('data.runs') as $run) {
            self::assertSame($eventId, $run['event_id']);
            self::assertEqualsCanonicalizing(['id', 'event_id', 'mode', 'dry_run_id', 'as_of_utc',
                'eligible_count', 'affected_count', 'completed_at', 'created_at'], array_keys($run));
        }
        $this->apiGet($url . '?page=2&per_page=2')->assertOk()
            ->assertJsonPath('data.runs.0.id', $ids[1])->assertJsonPath('data.runs.1.id', $ids[0])
            ->assertJsonPath('data.pagination.next_page', null)->assertJsonPath('data.pagination.previous_page', 1);
        $this->apiGet($url . '?page=999&per_page=2')->assertOk()->assertJsonPath('data.pagination.page', 2);
        $this->apiGet($url . '?per_page=999')->assertOk()->assertJsonPath('data.pagination.per_page', 100);
        foreach (['page=0', 'page=abc', 'per_page=-1', 'page[]=1'] as $query) {
            $this->apiGet($url . '?' . $query)->assertStatus(422);
        }
        $staff = $this->eventUser();
        (new EventRoleService())->grant($eventId, (int) $staff->id, EventStaffRole::RegistrationManager, $owner, now()->addMonth());
        Sanctum::actingAs($staff, ['*']);
        $this->apiGet($url)->assertForbidden();
        Sanctum::actingAs($owner, ['*']);
        $foreignTenantId = (int) \App\Models\Tenant::factory()->create()->id;
        $foreignOwner = $this->eventUser([], $foreignTenantId);
        [$foreignId] = $this->registrationEvent((int) $foreignOwner->id, tenantId: $foreignTenantId);
        $this->apiGet("/v2/events/{$foreignId}/registration-product/retention")->assertNotFound();
    }

    public function test_empty_history_needs_no_registration_settings(): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        Sanctum::actingAs($owner, ['*']);
        $this->apiGet("/v2/events/{$eventId}/registration-product/retention")
            ->assertOk()->assertJsonPath('data.runs', [])->assertJsonPath('data.pagination.total', 0)
            ->assertJsonPath('data.pagination.from', null)->assertJsonPath('data.pagination.has_more', false);
    }
}
