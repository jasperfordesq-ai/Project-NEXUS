<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Enums\EventParticipationDecision;
use App\Enums\EventParticipationDenialReason;
use App\Models\User;
use App\Services\EventParticipationDenialService;
use App\Services\EventSafetyAcknowledgementService;
use App\Services\EventSafetyEligibilityService;
use App\Services\EventSafetyRequirementService;
use App\Services\SafeguardingInteractionPolicy;
use App\Support\Events\EventSafetyEligibilityDecision;
use App\Support\Events\EventSafetyFoundationSupport;
use App\Support\SafeguardingInteractionDecision;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Tests\Laravel\Support\PublishesLegacyGuardianPolicy;
use Tests\Laravel\TestCase;

final class EventSafetyEligibilityServiceTest extends TestCase
{
    use DatabaseTransactions;
    use PublishesLegacyGuardianPolicy;

    public function test_evaluator_fails_closed_for_unpublished_inactive_cross_tenant_and_unbound_users(): void
    {
        $owner = $this->user();
        $participant = $this->user();
        $inactive = $this->user(['status' => 'inactive']);
        $foreign = $this->user([], 999);
        $eventId = $this->event((int) $owner->id);
        $service = new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::ALLOW),
        );

        $unpublished = $service->evaluate($eventId, $participant);
        self::assertTrue($unpublished->isUnavailable());
        self::assertSame(['event_safety_requirements_not_published'], $unpublished->reasonCodes);

        $inactiveDecision = $service->evaluate($eventId, $inactive);
        self::assertTrue($inactiveDecision->isUnavailable());
        self::assertSame(['event_safety_user_not_active'], $inactiveDecision->reasonCodes);

        $foreignDecision = $service->evaluate($eventId, $foreign);
        self::assertTrue($foreignDecision->isUnavailable());
        self::assertSame(['event_safety_user_not_active'], $foreignDecision->reasonCodes);

        $guest = $service->evaluateUnboundGuest($eventId);
        self::assertTrue($guest->isDenied());
        self::assertNull($guest->userId);
        self::assertSame(
            [EventSafetyEligibilityDecision::UNBOUND_GUEST_POLICY],
            $guest->reasonCodes,
        );
        self::assertSame(
            EventSafetyEligibilityDecision::UNBOUND_GUEST_POLICY,
            $guest->unboundGuestPolicy,
        );
    }

    /**
     * Adults-only platform (2026-09-25): guardian consent is switched off. A
     * policy published before then may still carry `guardian_consent_required`;
     * that flag is now inert, so a member below the old minor threshold is only
     * asked for the code of conduct, like everyone else. The event-local age
     * rule (minimum age on the event's own calendar date) still applies.
     */
    public function test_event_local_age_and_exact_code_acknowledgement_compose_and_legacy_guardian_flag_is_inert(): void
    {
        $owner = $this->user();
        $start = CarbonImmutable::parse('2030-01-01 12:30:00', 'UTC');
        $localEventDate = '2030-01-02';
        $adult = $this->user(['date_of_birth' => '2012-01-02']);
        $young = $this->user([
            'email' => 'eligibility-young@example.test',
            'date_of_birth' => '2014-01-03',
        ]);
        $tooYoung = $this->user(['date_of_birth' => '2018-06-01']);
        $eventId = $this->event((int) $owner->id, $start, 'Pacific/Auckland');
        $policy = $this->publishLegacyGuardianPolicy($eventId, $owner, [
            'minimum_age' => 12,
            'minor_age_threshold' => 18,
            'code_of_conduct_required' => true,
            'code_of_conduct_text' => 'Exact eligibility conduct policy.',
            'code_of_conduct_text_version' => 'eligibility-coc-v1',
        ], 'eligibility-legacy:' . $eventId);
        $service = new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::ALLOW),
        );

        self::assertSame(
            18,
            (new EventSafetyFoundationSupport())->ageOnLocalDate(
                (string) $adult->getRawOriginal('date_of_birth'),
                $localEventDate,
            ),
        );
        $adultNeedsCode = $service->evaluate($eventId, $adult);
        self::assertTrue($adultNeedsCode->isDenied());
        self::assertSame(18, $adultNeedsCode->ageAtEvent);
        self::assertSame(
            ['event_safety_code_of_conduct_acknowledgement_required'],
            $adultNeedsCode->reasonCodes,
        );

        // The minimum age is measured on the event's local date and still applies.
        $tooYoungDecision = $service->evaluate($eventId, $tooYoung);
        self::assertTrue($tooYoungDecision->isDenied());
        self::assertSame(['event_safety_minimum_age_not_met'], $tooYoungDecision->reasonCodes);

        // Below the legacy minor threshold: NOT asked for guardian consent.
        $youngNeedsCodeOnly = $service->evaluate($eventId, $young);
        self::assertTrue($youngNeedsCodeOnly->isDenied());
        self::assertSame(15, $youngNeedsCodeOnly->ageAtEvent);
        self::assertSame(
            ['event_safety_code_of_conduct_acknowledgement_required'],
            $youngNeedsCodeOnly->reasonCodes,
        );
        self::assertNotContains('event_safety_request_guardian_consent', $youngNeedsCodeOnly->requiredActions);

        $acknowledgements = new EventSafetyAcknowledgementService();
        foreach ([[$adult, 'eligibility-adult-ack'], [$young, 'eligibility-young-ack']] as [$member, $key]) {
            $acknowledgements->acknowledge(
                $eventId,
                $member,
                (string) $policy['version']->code_of_conduct_text_version,
                (string) $policy['version']->code_of_conduct_text_hash,
                $key,
            );
        }
        $adultAllowed = $service->evaluate($eventId, $adult);
        self::assertTrue($adultAllowed->isAllowed());
        self::assertSame(18, $adultAllowed->ageAtEvent);

        $youngAllowed = $service->evaluate($eventId, $young);
        self::assertTrue($youngAllowed->isAllowed());
        self::assertSame(15, $youngAllowed->ageAtEvent);
        self::assertSame('SAFEGUARDING_ALLOWED', $youngAllowed->safeguardingPolicy['code']);
        self::assertArrayNotHasKey('required_attestation_labels', $youngAllowed->safeguardingPolicy);
    }

    public function test_blocks_reviewed_denials_and_existing_safeguarding_policy_all_fail_closed(): void
    {
        $owner = $this->user();
        $participant = $this->user();
        $eventId = $this->event((int) $owner->id);
        $this->publish($eventId, $owner, [
            'minimum_age' => null,
            'guardian_consent_required' => false,
            'minor_age_threshold' => null,
            'code_of_conduct_required' => false,
            'code_of_conduct_text' => null,
            'code_of_conduct_text_version' => null,
        ]);

        DB::table('user_blocks')->insert([
            'tenant_id' => $this->testTenantId,
            'user_id' => (int) $owner->id,
            'blocked_user_id' => (int) $participant->id,
            'reason' => null,
            'created_at' => now(),
        ]);
        $neverPolicy = $this->createMock(SafeguardingInteractionPolicy::class);
        $neverPolicy->expects(self::never())->method('evaluateLocalContact');
        $blocked = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $neverPolicy,
        ))->evaluate($eventId, $participant);
        self::assertSame(['event_safety_bilateral_user_block'], $blocked->reasonCodes);
        DB::table('user_blocks')
            ->where('tenant_id', $this->testTenantId)
            ->where('user_id', (int) $owner->id)
            ->where('blocked_user_id', (int) $participant->id)
            ->delete();

        $start = CarbonImmutable::parse(
            (string) DB::table('events')->where('id', $eventId)->value('start_time'),
            'UTC',
        );
        $denials = new EventParticipationDenialService();
        $denial = $denials->record(
            $eventId,
            $participant,
            $owner,
            EventParticipationDecision::Deny,
            EventParticipationDenialReason::SafeguardingPolicy,
            $start->subDay(),
            $start->addDay(),
            0,
            'eligibility-active-denial',
        );
        $denied = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $neverPolicy,
        ))->evaluate($eventId, $participant);
        self::assertSame(
            ['event_safety_active_participation_denial', 'event_safety_denial_safeguarding_policy'],
            $denied->reasonCodes,
        );
        $denials->withdraw(
            $eventId,
            (int) $denial['denial']->id,
            $owner,
            1,
            'eligibility-withdraw-denial',
        );

        $safeguardingDenied = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::DENY, true),
        ))->evaluate($eventId, $participant);
        self::assertSame(['event_safety_safeguarding_policy_denied'], $safeguardingDenied->reasonCodes);
        self::assertSame(['event_safety_contact_coordinator'], $safeguardingDenied->requiredActions);
        self::assertSame(['VETTING_REQUIRED'], $safeguardingDenied->safeguardingPolicy['required_attestation_codes']);
        self::assertArrayNotHasKey('required_attestation_labels', $safeguardingDenied->safeguardingPolicy);

        $unavailable = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::UNAVAILABLE),
        ))->evaluate($eventId, $participant);
        self::assertTrue($unavailable->isUnavailable());
        self::assertSame(['event_safety_safeguarding_policy_unavailable'], $unavailable->reasonCodes);

        $unknown = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy('unexpected'),
        ))->evaluate($eventId, $participant);
        self::assertTrue($unknown->isUnavailable());
        self::assertSame(['event_safety_safeguarding_policy_invalid'], $unknown->reasonCodes);

        $allowed = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::ALLOW),
        ))->evaluate($eventId, $participant);
        self::assertTrue($allowed->isAllowed());

        $event = DB::table('events')->where('id', $eventId)->firstOrFail();
        DB::table('event_participation_denials')->insert([
            'tenant_id' => $this->testTenantId,
            'event_id' => $eventId,
            'occurrence_key' => (string) $event->occurrence_key,
            'user_id' => (int) $participant->id,
            'decision' => 'deny',
            'reason_code' => 'safety_review',
            'status' => 'active',
            'active_slot' => 1,
            'decision_version' => 1,
            'reviewed_by_user_id' => (int) $owner->id,
            'effective_from' => $start->subDay(),
            'effective_until' => $start->addDay(),
            'create_idempotency_hash' => hash('sha256', 'direct-denial-key'),
            'create_request_hash' => hash('sha256', 'direct-denial-request'),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $unreviewedDirectWrite = (new EventSafetyEligibilityService(
            new EventSafetyFoundationSupport(),
            $this->policy(SafeguardingInteractionDecision::ALLOW),
        ))->evaluate($eventId, $participant);
        self::assertTrue($unreviewedDirectWrite->isUnavailable());
        self::assertSame(
            ['event_participation_denial_integrity_invalid'],
            $unreviewedDirectWrite->reasonCodes,
        );
    }

    /**
     * @param array<string,mixed> $configuration
     * @return array{requirements:\App\Models\EventSafetyRequirement,version:\App\Models\EventSafetyRequirementVersion,changed:bool}
     */
    private function publish(int $eventId, User $owner, array $configuration): array
    {
        $service = new EventSafetyRequirementService();
        $draft = $service->saveDraft(
            $eventId,
            $owner,
            $configuration,
            0,
            'eligibility-policy-draft:' . $eventId,
        );

        return $service->publish(
            $eventId,
            $owner,
            (int) $draft['requirements']->revision,
            (int) $draft['version']->version_number,
            'eligibility-policy-publish:' . $eventId,
        );
    }

    private function policy(string $status, bool $coordinator = false): SafeguardingInteractionPolicy
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
            requiredAttestationCodes: $status === SafeguardingInteractionDecision::DENY
                ? ['VETTING_REQUIRED']
                : [],
            requiredAttestationLabels: ['Sensitive translated label must not escape'],
            canRequestCoordinator: $coordinator,
        ));

        return $policy;
    }

    private function user(array $overrides = [], int $tenantId = 2): User
    {
        return User::factory()->forTenant($tenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(
        int $ownerId,
        ?CarbonImmutable $start = null,
        string $timezone = 'UTC',
    ): int {
        $start ??= CarbonImmutable::now('UTC')->addMonths(2)->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Safety eligibility fixture',
            'description' => 'Safety eligibility fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => $timezone,
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'calendar_sequence' => 1,
            'is_recurring_template' => false,
            'occurrence_key' => 'safety-eligibility:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }
}
