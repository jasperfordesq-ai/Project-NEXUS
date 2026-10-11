<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Models\User;
use App\Services\EventSafetyEligibilityService;
use App\Services\EventSafetyRequirementService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Events\EventSafetyFoundationSupport;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Laravel\TestCase;

/**
 * Owner decision, 10 October 2026 (E-102, O-199, option (a)): safety
 * enforcement applies the event's own rules only where an organiser has
 * published them. Before this, "enforce" made every event without published
 * rules refuse every member with "could not be checked right now, please try
 * again" — reproduced live on the pen-test server (event 187).
 *
 * Without event rules there is no minimum age or code of conduct to apply, but
 * the protections that do not come from the event's rules still do: a block
 * between the member and the organiser, an organiser's recorded refusal, and
 * the community's safeguarding policy.
 */
final class EventSafetyEnforceWithoutRulesTest extends TestCase
{
    use DatabaseTransactions;

    public function test_an_event_without_published_rules_is_open_to_members(): void
    {
        $owner = $this->member();
        $participant = $this->member();
        $eventId = $this->event($owner);

        $decision = $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant);

        self::assertTrue($decision->isAllowed(), 'BAD OUTCOME: an event with no safety rules refused a member.');
        self::assertSame(['event_safety_eligible'], $decision->reasonCodes);
        self::assertNull($decision->requirementsVersion);
    }

    public function test_a_block_between_member_and_organiser_still_refuses_without_rules(): void
    {
        $owner = $this->member();
        $participant = $this->member();
        $eventId = $this->event($owner);
        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'blocked_user_id' => (int) $participant->id,
            'reason' => null,
            'created_at' => now(),
        ]);

        $decision = $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant);

        self::assertTrue($decision->isDenied());
        self::assertSame(['event_safety_bilateral_user_block'], $decision->reasonCodes);
    }

    public function test_the_safeguarding_policy_still_applies_without_rules(): void
    {
        $owner = $this->member();
        $participant = $this->member();
        $eventId = $this->event($owner);

        $denied = $this->service(SafeguardingInteractionDecision::DENY)->evaluate($eventId, $participant);
        self::assertTrue($denied->isDenied());
        self::assertSame(['event_safety_safeguarding_policy_denied'], $denied->reasonCodes);

        $unavailable = $this->service(SafeguardingInteractionDecision::UNAVAILABLE)->evaluate($eventId, $participant);
        self::assertTrue($unavailable->isUnavailable());
        self::assertSame(['event_safety_safeguarding_policy_unavailable'], $unavailable->reasonCodes);
    }

    public function test_a_member_can_register_for_an_event_without_rules_in_enforce_mode(): void
    {
        Config::set('events.safety.enforcement_mode', 'enforce');
        DB::table('tenant_settings')
            ->where('tenant_id', $this->testTenantId)
            ->where('setting_key', 'events.safety_enforcement_mode')
            ->delete();
        $owner = $this->member();
        $participant = $this->member();
        $eventId = $this->event($owner);

        Sanctum::actingAs($participant, ['*']);
        $this->apiPost("/v2/events/{$eventId}/registration/confirm", [], ['Idempotency-Key' => 'enforce-no-rules'])
            ->assertOk();

        self::assertSame('confirmed', DB::table('event_registrations')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('user_id', (int) $participant->id)
            ->value('registration_state'));
    }

    public function test_published_rules_being_edited_stay_enforced_and_archived_rules_open_the_event(): void
    {
        $owner = $this->member();
        $participant = $this->member();
        $eventId = $this->event($owner);
        $rules = new EventSafetyRequirementService();
        $configuration = [
            'minimum_age' => null,
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => true,
            'code_of_conduct_text' => 'Be kind to everyone.',
            'code_of_conduct_text_version' => 'v1',
        ];
        $draft = $rules->saveDraft($eventId, $owner, $configuration, 0, 'no-rules-draft-1:' . $eventId);
        self::assertTrue(
            $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant)->isAllowed(),
            'A draft that was never published has no rules to apply.',
        );

        $published = $rules->publish($eventId, $owner, (int) $draft['requirements']->revision, (int) $draft['version']->version_number, 'no-rules-publish-1:' . $eventId);
        $enforced = $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant);
        self::assertSame(['event_safety_code_of_conduct_acknowledgement_required'], $enforced->reasonCodes);

        $edit = $rules->saveDraft($eventId, $owner, ['code_of_conduct_text' => 'Be kind to everyone, always.'] + $configuration, (int) $published['requirements']->revision, 'no-rules-draft-2:' . $eventId);
        $editing = $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant);
        self::assertFalse($editing->isAllowed(), 'BAD OUTCOME: editing published rules lifted them.');
        self::assertSame(['event_safety_requirements_not_published'], $editing->reasonCodes);

        $republished = $rules->publish($eventId, $owner, (int) $edit['requirements']->revision, (int) $edit['version']->version_number, 'no-rules-publish-2:' . $eventId);
        $rules->archive($eventId, $owner, (int) $republished['requirements']->revision, (int) $republished['version']->version_number, 'no-rules-archive:' . $eventId);
        self::assertTrue(
            $this->service(SafeguardingInteractionDecision::ALLOW)->evaluate($eventId, $participant)->isAllowed(),
            'Archived rules no longer apply.',
        );
    }

    private function service(string $status): EventSafetyEligibilityService
    {
        $policy = $this->createMock(SafeguardingInteractionPolicy::class);
        $policy->method('evaluateLocalContact')->willReturn(new SafeguardingInteractionDecision(
            status: $status,
            code: $status === SafeguardingInteractionDecision::ALLOW
                ? 'SAFEGUARDING_ALLOWED'
                : ($status === SafeguardingInteractionDecision::DENY
                    ? 'SAFEGUARDING_DENIED'
                    : 'SAFEGUARDING_POLICY_UNAVAILABLE'),
            recipientTenantId: $this->testTenantId,
            purposeCode: 'event_participation',
            scopeType: 'event',
            scopeIdentifier: 'fixture',
            policyVersion: 'safeguarding-v1',
        ));

        return new EventSafetyEligibilityService(new EventSafetyFoundationSupport(), $policy);
    }

    private function event(User $organizer): int
    {
        $start = now()->addWeek();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $organizer->id,
            'title' => 'Enforce without rules fixture',
            'description' => 'Enforce without rules fixture.',
            'start_time' => $start,
            'end_time' => $start->copy()->addHour(),
            'timezone' => 'UTC',
            'timezone_source' => 'explicit',
            'all_day' => 0,
            'occurrence_key' => 'safety-no-rules:' . bin2hex(random_bytes(10)),
            'is_recurring_template' => 0,
            'max_attendees' => 10,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function member(): User
    {
        return User::factory()->forTenant($this->testTenantId)->create([
            'role' => 'member',
            'status' => 'active',
            'is_approved' => true,
        ]);
    }
}
