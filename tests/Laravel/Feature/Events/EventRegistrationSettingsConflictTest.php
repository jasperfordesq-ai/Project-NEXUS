<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Services\EventRegistrationSettingsService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationSettingsConflictTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_stale_revision_is_distinguishable_from_a_reused_key_without_changing_conflict_code(): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        (new EventRegistrationSettingsService())->save($eventId, $owner, ['approval_mode' => 'auto'], 0, 'original-settings');
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/settings";
        $this->apiPut($url, ['approval_mode' => 'manual', 'expected_revision' => 0, 'idempotency_key' => 'stale-settings'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT')
            ->assertJsonPath('errors.0.field', 'expected_revision');
        $collision = $this->apiPut($url, ['approval_mode' => 'manual', 'expected_revision' => 0, 'idempotency_key' => 'original-settings']);
        $collision->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT');
        self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        $this->apiPost($url . '/publish', ['expected_revision' => 2, 'idempotency_key' => 'stale-publish'])
            ->assertStatus(409)->assertJsonPath('errors.0.field', 'expected_revision');
        self::assertSame(1, DB::table('event_registration_settings_history')->where('event_id', $eventId)->count());
        self::assertSame(1, (int) DB::table('event_registration_settings')->where('event_id', $eventId)->value('revision'));
    }
}
