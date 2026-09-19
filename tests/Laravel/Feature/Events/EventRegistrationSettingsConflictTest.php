<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Services\EventRegistrationSettingsService;
use App\Services\EventRegistrationFormService;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\Feature\Events\Concerns\BuildsEventRegistrationFormFixtures;
use Tests\Laravel\TestCase;

final class EventRegistrationSettingsConflictTest extends TestCase
{
    use DatabaseTransactions;
    use BuildsEventRegistrationFormFixtures;

    public function test_published_form_refusal_is_definitive_but_successful_retry_still_replays(): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        (new EventRegistrationSettingsService())->save($eventId, $owner, [], 0, 'published-conflict-settings');
        $forms = new EventRegistrationFormService();
        $created = $forms->createDraft($eventId, $owner, 'Original', null, $this->standardRegistrationQuestions(), 1, 'published-conflict-form');
        $formId = (int) $created['form']->id;
        $forms->publish($eventId, $formId, $owner, 1, 2, 'original-publication');
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/forms/{$formId}";
        $this->apiPut($url, ['name' => 'Changed', 'expected_form_revision' => 2,
            'expected_settings_revision' => 3, 'idempotency_key' => 'edit-published'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT')
            ->assertJsonPath('errors.0.field', 'form_status');
        $this->apiPost($url . '/publish', ['expected_form_revision' => 1,
            'expected_settings_revision' => 2, 'idempotency_key' => 'original-publication'])
            ->assertOk()->assertJsonPath('data.idempotent_replay', true);
        self::assertSame('Original', DB::table('event_registration_form_versions')->where('id', $formId)->value('name'));
        self::assertSame(3, (int) DB::table('event_registration_settings')->where('event_id', $eventId)->value('revision'));
    }

    public function test_form_revision_rejection_identifies_the_form_field_without_masking_retry_collisions(): void
    {
        $owner = $this->eventUser();
        [$eventId] = $this->registrationEvent((int) $owner->id);
        (new EventRegistrationSettingsService())->save($eventId, $owner, [], 0, 'form-conflict-settings');
        $forms = new EventRegistrationFormService();
        $created = $forms->createDraft($eventId, $owner, 'Original', null, $this->standardRegistrationQuestions(), 1, 'original-form');
        $formId = (int) $created['form']->id;
        Sanctum::actingAs($owner, ['*']);
        $url = "/v2/events/{$eventId}/registration-product/forms/{$formId}";
        $this->apiPut($url, ['name' => 'Changed', 'expected_form_revision' => 2,
            'expected_settings_revision' => 2, 'idempotency_key' => 'stale-form'])
            ->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT')
            ->assertJsonPath('errors.0.field', 'expected_form_revision');
        $collision = $this->apiPut($url, ['name' => 'Changed', 'expected_form_revision' => 1,
            'expected_settings_revision' => 2, 'idempotency_key' => 'original-form']);
        $collision->assertStatus(409)->assertJsonPath('errors.0.code', 'EVENT_REGISTRATION_CONFLICT');
        self::assertArrayNotHasKey('field', $collision->json('errors.0'));
        self::assertSame(1, (int) DB::table('event_registration_form_versions')->where('id', $formId)->value('revision'));
        self::assertSame(2, (int) DB::table('event_registration_settings')->where('event_id', $eventId)->value('revision'));
    }

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
