<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Feature\Events;

use App\Core\TenantContext;
use App\Enums\EventParticipationDecision;
use App\Enums\EventParticipationDenialReason;
use App\Exceptions\EventSafetyException;
use App\Models\User;
use App\Services\EventGuardianConsentService;
use App\Services\EventParticipationDenialService;
use App\Services\EventSafetyAcknowledgementService;
use App\Services\EventSafetyRequirementService;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Laravel\Support\PublishesLegacyGuardianPolicy;
use Tests\Laravel\TestCase;

final class EventSafetyConsentEvidenceTest extends TestCase
{
    use DatabaseTransactions;
    use PublishesLegacyGuardianPolicy;

    public function test_code_acknowledgements_are_append_only_replaced_and_withdrawable(): void
    {
        $owner = $this->user();
        $participant = $this->user();
        $eventId = $this->event((int) $owner->id);
        $requirements = new EventSafetyRequirementService();
        $acknowledgements = new EventSafetyAcknowledgementService();

        $first = $this->publish(
            $requirements,
            $eventId,
            $owner,
            $this->configuration(false, 'Conduct policy v1.', 'coc-v1'),
            0,
            'ack-policy-v1',
        );
        $acknowledged = $acknowledgements->acknowledge(
            $eventId,
            $participant,
            (string) $first['version']->code_of_conduct_text_version,
            (string) $first['version']->code_of_conduct_text_hash,
            'ack-v1',
        );
        self::assertTrue($acknowledged['changed']);
        $ackReplay = $acknowledgements->acknowledge(
            $eventId,
            $participant,
            (string) $first['version']->code_of_conduct_text_version,
            (string) $first['version']->code_of_conduct_text_hash,
            'ack-v1',
        );
        self::assertFalse($ackReplay['changed']);
        self::assertSame((int) $acknowledged['evidence']->id, (int) $ackReplay['evidence']->id);

        $second = $this->publish(
            $requirements,
            $eventId,
            $owner,
            $this->configuration(false, 'Conduct policy v2.', 'coc-v2'),
            (int) $first['requirements']->revision,
            'ack-policy-v2',
        );
        $replacement = $acknowledgements->acknowledge(
            $eventId,
            $participant,
            (string) $second['version']->code_of_conduct_text_version,
            (string) $second['version']->code_of_conduct_text_hash,
            'ack-v2',
        );
        self::assertTrue($replacement['changed']);

        $withdrawn = $acknowledgements->withdraw(
            $eventId,
            $participant,
            (int) $replacement['evidence']->id,
            'ack-v2-withdraw',
        );
        self::assertTrue($withdrawn['changed']);
        $withdrawReplay = $acknowledgements->withdraw(
            $eventId,
            $participant,
            (int) $replacement['evidence']->id,
            'ack-v2-withdraw',
        );
        self::assertFalse($withdrawReplay['changed']);

        $evidence = DB::table('event_safety_code_acknowledgements')
            ->where('event_id', $eventId)
            ->where('user_id', (int) $participant->id)
            ->orderBy('evidence_sequence')
            ->get();
        self::assertSame(
            ['acknowledged', 'replaced', 'acknowledged', 'withdrawn'],
            $evidence->pluck('action')->all(),
        );
        self::assertSame(
            (int) $acknowledged['evidence']->id,
            (int) $evidence[1]->referenced_acknowledgement_id,
        );
        self::assertSame(
            (int) $replacement['evidence']->id,
            (int) $evidence[3]->referenced_acknowledgement_id,
        );
        self::assertSame(4, $evidence->unique('id')->count());
    }

    public function test_guardian_consent_encrypts_identity_hashes_token_and_forbids_minor_self_grant(): void
    {
        $token = 'nxeg1_' . str_repeat('A', 43);
        $owner = $this->user();
        $start = CarbonImmutable::now('UTC')->addMonths(3)->startOfDay()->addHours(10);
        $minor = $this->user([
            'email' => 'minor-safety@example.test',
            'date_of_birth' => $start->subYears(16)->addDay()->toDateString(),
        ]);
        $eventId = $this->event((int) $owner->id, $start);
        $requirements = new EventSafetyRequirementService();
        $this->publish(
            $requirements,
            $eventId,
            $owner,
            $this->configuration(true, 'Guardian event conduct policy.', 'guardian-coc-v1'),
            0,
            'guardian-policy',
        );
        $service = new EventGuardianConsentService(
            new EventSafetyFoundationSupport(),
            static fn (): string => $token,
        );
        $identity = [
            'guardian_name' => 'Alex Guardian',
            'guardian_email' => 'alex.guardian@example.test',
            'relationship_code' => 'legal_guardian',
        ];
        $requested = $service->request(
            $eventId,
            $minor,
            $minor,
            $identity,
            'I consent to this minor attending this exact event.',
            'guardian-consent-v1',
            $start->addDays(2),
            'guardian-request',
        );

        self::assertTrue($requested['changed']);
        self::assertArrayNotHasKey('token', $requested);
        self::assertStringNotContainsString($token, json_encode($requested, JSON_THROW_ON_ERROR));
        $stored = DB::table('event_guardian_consents')
            ->where('id', (int) $requested['consent']->id)
            ->firstOrFail();
        self::assertNotSame($identity['guardian_email'], $stored->guardian_email_ciphertext);
        self::assertNotSame($identity['guardian_name'], $stored->guardian_identity_ciphertext);
        self::assertStringNotContainsString($identity['guardian_email'], (string) $stored->guardian_email_ciphertext);
        self::assertStringNotContainsString($identity['guardian_name'], (string) $stored->guardian_identity_ciphertext);
        self::assertSame(
            (new EventSafetyFoundationSupport())->tokenHash($this->testTenantId, $token),
            $stored->token_hash,
        );
        self::assertNotSame($token, $stored->token_hash);
        $support = new EventSafetyFoundationSupport();
        self::assertSame(
            $identity['guardian_email'],
            $support->decrypt((string) $stored->guardian_email_ciphertext),
        );
        self::assertStringContainsString(
            $identity['guardian_name'],
            $support->decrypt((string) $stored->guardian_identity_ciphertext),
        );

        TenantContext::reset();
        TenantContext::setById(999);
        try {
            $this->assertReason(
                fn () => $service->grant(
                    $token,
                    $identity['guardian_email'],
                    null,
                    'guardian-cross-tenant-grant',
                ),
                'event_guardian_consent_not_found',
            );
        } finally {
            TenantContext::reset();
            TenantContext::setById($this->testTenantId);
        }

        $this->assertReason(
            fn () => $service->grant(
                $token,
                (string) $minor->email,
                (int) $minor->id,
                'guardian-minor-self-grant',
            ),
            'event_guardian_minor_self_grant_forbidden',
        );
        $this->assertReason(
            fn () => $service->grant(
                $token,
                'wrong.guardian@example.test',
                null,
                'guardian-wrong-proof',
            ),
            'event_guardian_identity_proof_mismatch',
        );

        $granted = $service->grant(
            $token,
            $identity['guardian_email'],
            null,
            'guardian-grant',
        );
        self::assertTrue($granted['changed']);
        self::assertSame('active', $granted['consent']->getRawOriginal('status'));
        self::assertNotNull($granted['consent']->token_consumed_at);
        $grantReplay = $service->grant(
            $token,
            $identity['guardian_email'],
            null,
            'guardian-grant',
        );
        self::assertFalse($grantReplay['changed']);

        $withdrawn = $service->withdraw(
            $eventId,
            (int) $granted['consent']->id,
            $minor,
            'guardian-withdraw',
        );
        self::assertSame('withdrawn', $withdrawn['consent']->getRawOriginal('status'));
        $withdrawReplay = $service->withdraw(
            $eventId,
            (int) $granted['consent']->id,
            $minor,
            'guardian-withdraw',
        );
        self::assertFalse($withdrawReplay['changed']);
        self::assertSame(
            ['requested', 'granted', 'withdrawn'],
            DB::table('event_guardian_consent_history')
                ->where('consent_id', (int) $granted['consent']->id)
                ->orderBy('consent_version')
                ->pluck('action')
                ->all(),
        );
        $grantEvidence = DB::table('event_guardian_consent_history')
            ->where('consent_id', (int) $granted['consent']->id)
            ->where('action', 'granted')
            ->firstOrFail();
        self::assertSame('guardian_external', $grantEvidence->actor_type);
        self::assertNull($grantEvidence->actor_user_id);
    }

    public function test_reviewed_denials_and_all_phase_a_evidence_leave_operational_state_untouched(): void
    {
        $token = 'nxeg1_' . str_repeat('B', 43);
        $owner = $this->user();
        $start = CarbonImmutable::now('UTC')->addMonths(4)->startOfDay()->addHours(11);
        $minor = $this->user([
            'email' => 'phase-a-minor@example.test',
            'date_of_birth' => $start->subYears(15)->addDay()->toDateString(),
        ]);
        $eventId = $this->event((int) $owner->id, $start);
        $before = $this->operationalCounts();

        $requirements = new EventSafetyRequirementService();
        $policy = $this->publish(
            $requirements,
            $eventId,
            $owner,
            $this->configuration(true, 'Phase A conduct policy.', 'phase-a-coc-v1'),
            0,
            'phase-a-policy',
        );
        (new EventSafetyAcknowledgementService())->acknowledge(
            $eventId,
            $minor,
            (string) $policy['version']->code_of_conduct_text_version,
            (string) $policy['version']->code_of_conduct_text_hash,
            'phase-a-ack',
        );
        $guardian = new EventGuardianConsentService(
            new EventSafetyFoundationSupport(),
            static fn (): string => $token,
        );
        $consent = $guardian->request(
            $eventId,
            $minor,
            $owner,
            [
                'guardian_name' => 'Phase A Guardian',
                'guardian_email' => 'phase-a-guardian@example.test',
                'relationship_code' => 'parent',
            ],
            'Consent for the exact event and policy.',
            'phase-a-consent-v1',
            $start->addDays(2),
            'phase-a-consent-request',
        );
        $guardian->grant(
            $token,
            'phase-a-guardian@example.test',
            null,
            'phase-a-consent-grant',
        );

        $denials = new EventParticipationDenialService();
        $recorded = $denials->record(
            $eventId,
            $minor,
            $owner,
            EventParticipationDecision::Deny,
            EventParticipationDenialReason::SafetyReview,
            $start->subDay(),
            $start->addDay(),
            0,
            'phase-a-denial-record',
        );
        self::assertSame((int) $owner->id, (int) $recorded['denial']->reviewed_by_user_id);
        self::assertSame(1, (int) $recorded['denial']->decision_version);
        $revised = $denials->record(
            $eventId,
            $minor,
            $owner,
            EventParticipationDecision::Remove,
            EventParticipationDenialReason::ConductViolation,
            $start->subHours(2),
            $start->addHours(2),
            1,
            'phase-a-denial-revise',
        );
        self::assertSame(2, (int) $revised['denial']->decision_version);
        $withdrawn = $denials->withdraw(
            $eventId,
            (int) $revised['denial']->id,
            $owner,
            2,
            'phase-a-denial-withdraw',
        );
        self::assertSame('withdrawn', $withdrawn['denial']->getRawOriginal('status'));
        self::assertSame(
            ['recorded', 'recorded', 'withdrawn'],
            DB::table('event_participation_denial_history')
                ->where('denial_id', (int) $recorded['denial']->id)
                ->orderBy('decision_version')
                ->pluck('action')
                ->all(),
        );
        self::assertSame(
            (int) $consent['consent']->id,
            (int) DB::table('event_guardian_consents')
                ->where('event_id', $eventId)
                ->where('minor_user_id', (int) $minor->id)
                ->value('id'),
        );

        $after = $this->operationalCounts();
        self::assertSame(
            $before['event_domain_outbox'] + 1,
            $after['event_domain_outbox'],
            'Granting consent must create exactly one attendee-facing status fact.',
        );
        unset($before['event_domain_outbox'], $after['event_domain_outbox']);
        self::assertSame($before, $after);

        $statusFact = DB::table('event_domain_outbox')
            ->where('tenant_id', $this->testTenantId)
            ->where('event_id', $eventId)
            ->where('action', 'event.safety.guardian_consent.granted')
            ->sole();
        $statusPayload = json_decode(
            (string) $statusFact->payload,
            true,
            512,
            JSON_THROW_ON_ERROR,
        );
        self::assertSame(1, $statusPayload['schema_version']);
        self::assertSame($this->testTenantId, $statusPayload['tenant_id']);
        self::assertSame($eventId, $statusPayload['event_id']);
        self::assertSame((int) $consent['consent']->id, $statusPayload['consent_id']);
        self::assertSame(2, $statusPayload['consent_version']);
        self::assertSame((int) $minor->id, $statusPayload['recipient_user_id']);
        self::assertSame('active', $statusPayload['to_status']);
        self::assertArrayHasKey('occurred_at', $statusPayload);
        self::assertSame(
            [
                'schema_version',
                'tenant_id',
                'event_id',
                'consent_id',
                'consent_version',
                'recipient_user_id',
                'to_status',
                'occurred_at',
            ],
            array_keys($statusPayload),
            'The status fact must remain attendee-only and contain no guardian PII or token.',
        );
    }

    /**
     * @param array<string,mixed> $configuration
     * @return array{requirements:\App\Models\EventSafetyRequirement,version:\App\Models\EventSafetyRequirementVersion,changed:bool}
     */
    private function publish(
        EventSafetyRequirementService $service,
        int $eventId,
        User $owner,
        array $configuration,
        int $expectedRevision,
        string $key,
    ): array {
        // Guardian consent was switched off on 2026-09-25 (adults-only
        // platform) and organisers can no longer create a policy that requires
        // it. These tests pin the integrity of the retained guardian-consent
        // service, so they publish a legacy guardian policy directly.
        if (($configuration['guardian_consent_required'] ?? false) === true && $expectedRevision === 0) {
            return $this->publishLegacyGuardianPolicy($eventId, $owner, $configuration, $key) + ['changed' => true];
        }
        $draft = $service->saveDraft(
            $eventId,
            $owner,
            $configuration,
            $expectedRevision,
            $key . ':draft',
        );

        return $service->publish(
            $eventId,
            $owner,
            (int) $draft['requirements']->revision,
            (int) $draft['version']->version_number,
            $key . ':publish',
        );
    }

    /** @return array<string,mixed> */
    private function configuration(bool $guardian, string $code, string $version): array
    {
        return [
            'minimum_age' => null,
            'guardian_consent_required' => $guardian,
            'minor_age_threshold' => $guardian ? 18 : null,
            'code_of_conduct_required' => true,
            'code_of_conduct_text' => $code,
            'code_of_conduct_text_version' => $version,
        ];
    }

    /** @return array<string,int> */
    private function operationalCounts(): array
    {
        $counts = [];
        foreach ([
            'event_registrations',
            'event_registration_history',
            'event_waitlist_entries',
            'event_waitlist_entry_history',
            'event_invitations',
            'event_invitation_history',
            'event_ticket_entitlements',
            'event_ticket_entitlement_history',
            'event_attendance',
            'event_attendance_activity',
            'transactions',
            'notifications',
            'event_domain_outbox',
            'event_notification_deliveries',
        ] as $table) {
            if (Schema::hasTable($table)) {
                $counts[$table] = (int) DB::table($table)->count();
            }
        }

        return $counts;
    }

    private function user(array $overrides = []): User
    {
        return User::factory()->forTenant($this->testTenantId)->create(array_merge([
            'status' => 'active',
            'is_approved' => true,
        ], $overrides));
    }

    private function event(int $ownerId, ?CarbonImmutable $start = null): int
    {
        $start ??= CarbonImmutable::now('UTC')->addMonths(2)->startOfHour();

        return (int) DB::table('events')->insertGetId([
            'tenant_id' => $this->testTenantId,
            'user_id' => $ownerId,
            'title' => 'Safety evidence fixture',
            'description' => 'Safety evidence fixture.',
            'start_time' => $start,
            'end_time' => $start->addHours(2),
            'timezone' => 'UTC',
            'timezone_source' => 'test',
            'all_day' => false,
            'status' => 'active',
            'publication_status' => 'published',
            'operational_status' => 'scheduled',
            'lifecycle_version' => 1,
            'calendar_sequence' => 1,
            'is_recurring_template' => false,
            'occurrence_key' => 'safety-evidence:' . bin2hex(random_bytes(12)),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    /** @param callable():mixed $operation */
    private function assertReason(callable $operation, string $reason): void
    {
        try {
            $operation();
            self::fail("Expected {$reason}.");
        } catch (EventSafetyException $exception) {
            self::assertSame($reason, $exception->reasonCode);
        }
    }
}
