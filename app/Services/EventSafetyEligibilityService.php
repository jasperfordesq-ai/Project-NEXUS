<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventGuardianConsentStatus;
use App\Enums\EventParticipationDenialStatus;
use App\Enums\EventSafetyCodeEvidenceAction;
use App\Enums\EventSafetyRequirementStatus;
use App\Exceptions\EventSafetyException;
use App\Models\Event;
use App\Models\EventGuardianConsent;
use App\Models\EventSafetyCodeAcknowledgement;
use App\Models\EventSafetyRequirement;
use App\Models\EventSafetyRequirementVersion;
use App\Models\User;
use App\Support\Events\EventSafetyEligibilityDecision;
use App\Support\Events\EventSafetyFoundationSupport;
use App\Support\SafeguardingInteractionDecision;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** Pure-read authoritative event-safety eligibility composition. */
final class EventSafetyEligibilityService
{
    public function __construct(
        private readonly EventSafetyFoundationSupport $support = new EventSafetyFoundationSupport(),
        private readonly ?SafeguardingInteractionPolicy $interactionPolicy = null,
    ) {
    }

    public function evaluate(int $eventId, User|int $user): EventSafetyEligibilityDecision
    {
        $userId = $user instanceof User ? (int) $user->getKey() : $user;
        try {
            $this->assertSchema();
            $tenantId = $this->support->tenantId();
            $event = $this->support->concreteEvent($tenantId, $eventId);
            $participant = $this->support->activeUser($tenantId, $user);
            $organizer = $this->support->activeUser(
                $tenantId,
                (int) $event->user_id,
                false,
                'event_safety_organizer_not_active',
            );
            [$requirements, $version] = $this->publishedRequirements($tenantId, $eventId);
            $start = $this->support->eventStartContext($event);
            if ($this->isBlocked(
                $tenantId,
                (int) $participant->id,
                (int) $organizer->id,
            )) {
                return $this->deny(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_bilateral_user_block'],
                    ['event_safety_contact_organizer_unavailable'],
                );
            }
            $denialReason = $this->activeDenialReason(
                $tenantId,
                $eventId,
                (int) $participant->id,
                $start['start_utc']->format('Y-m-d H:i:s'),
            );
            if ($denialReason !== null) {
                return $this->deny(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_active_participation_denial', 'event_safety_denial_' . $denialReason],
                    ['event_safety_contact_organizer'],
                );
            }

            $age = null;
            $minor = null;
            // Adults-only platform (owner decision 2026-09-25, E-035 F-160):
            // guardian consent is switched off. A policy published before the
            // switch-off may still say `guardian_consent_required`; that flag is
            // now ignored — it neither demands a date of birth nor blocks anyone
            // (an under-18 account cannot sign in at all). The minimum age and
            // the code of conduct still apply exactly as published.
            if ($version->minimum_age !== null) {
                $dateOfBirth = $participant->getRawOriginal('date_of_birth');
                if (! is_string($dateOfBirth) || trim($dateOfBirth) === '') {
                    return $this->unavailable(
                        $eventId,
                        (int) $participant->id,
                        (int) $version->version_number,
                        ['event_safety_date_of_birth_required'],
                        ['event_safety_record_date_of_birth'],
                    );
                }
                try {
                    $age = $this->support->ageOnLocalDate($dateOfBirth, $start['local_date']);
                } catch (EventSafetyException) {
                    return $this->unavailable(
                        $eventId,
                        (int) $participant->id,
                        (int) $version->version_number,
                        ['event_safety_date_of_birth_invalid'],
                        ['event_safety_correct_date_of_birth'],
                    );
                }
                if ($version->minimum_age !== null && $age < (int) $version->minimum_age) {
                    return $this->deny(
                        $eventId,
                        (int) $participant->id,
                        (int) $version->version_number,
                        ['event_safety_minimum_age_not_met'],
                        [],
                        $age,
                        $version->minor_age_threshold !== null
                            ? $age < (int) $version->minor_age_threshold
                            : null,
                    );
                }
            }
            if ((bool) $version->code_of_conduct_required
                && ! $this->hasCurrentCodeAcknowledgement(
                    $tenantId,
                    $eventId,
                    (int) $participant->id,
                    $requirements,
                    $version,
                )) {
                return $this->deny(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_code_of_conduct_acknowledgement_required'],
                    ['event_safety_acknowledge_code_of_conduct'],
                    $age,
                    $minor,
                );
            }
            $safeguarding = $this->safeguardingDecision(
                $tenantId,
                (int) $participant->id,
                (int) $organizer->id,
            );
            $policyEvidence = $this->safePolicyEvidence($safeguarding);
            if ($safeguarding->isUnavailable()) {
                return $this->unavailable(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_safeguarding_policy_unavailable'],
                    ['event_safety_contact_coordinator'],
                    $age,
                    $minor,
                    $policyEvidence,
                );
            }
            if ($safeguarding->isDenied()) {
                return $this->deny(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_safeguarding_policy_denied'],
                    $safeguarding->canRequestCoordinator
                        ? ['event_safety_contact_coordinator']
                        : [],
                    $age,
                    $minor,
                    $policyEvidence,
                );
            }
            if (! $safeguarding->isAllowed()) {
                return $this->unavailable(
                    $eventId,
                    (int) $participant->id,
                    (int) $version->version_number,
                    ['event_safety_safeguarding_policy_invalid'],
                    ['event_safety_contact_coordinator'],
                    $age,
                    $minor,
                    $policyEvidence,
                );
            }

            return new EventSafetyEligibilityDecision(
                status: EventSafetyEligibilityDecision::ALLOW,
                eventId: $eventId,
                userId: (int) $participant->id,
                reasonCodes: ['event_safety_eligible'],
                requiredActions: [],
                requirementsVersion: (int) $version->version_number,
                ageAtEvent: $age,
                minorAtEvent: $minor,
                safeguardingPolicy: $policyEvidence,
            );
        } catch (EventSafetyException $exception) {
            return $this->unavailable(
                $eventId,
                $userId > 0 ? $userId : null,
                null,
                [$exception->reasonCode],
                ['event_safety_contact_organizer'],
            );
        } catch (Throwable) {
            return $this->unavailable(
                $eventId,
                $userId > 0 ? $userId : null,
                null,
                ['event_safety_evaluation_unavailable'],
                ['event_safety_contact_organizer'],
            );
        }
    }

    public function evaluateUnboundGuest(int $eventId): EventSafetyEligibilityDecision
    {
        try {
            $this->assertSchema();
            $tenantId = $this->support->tenantId();
            $this->support->concreteEvent($tenantId, $eventId);
        } catch (Throwable) {
            return $this->unavailable(
                $eventId,
                null,
                null,
                ['event_safety_evaluation_unavailable'],
                ['event_safety_bind_guest_to_active_user'],
            );
        }

        return $this->deny(
            $eventId,
            null,
            null,
            [EventSafetyEligibilityDecision::UNBOUND_GUEST_POLICY],
            ['event_safety_bind_guest_to_active_user'],
        );
    }

    /** @return array{0:EventSafetyRequirement,1:EventSafetyRequirementVersion} */
    private function publishedRequirements(int $tenantId, int $eventId): array
    {
        $requirements = EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', EventSafetyRequirementStatus::Published->value)
            ->first();
        if ($requirements === null || $requirements->published_version === null) {
            throw new EventSafetyException('event_safety_requirements_not_published');
        }
        $version = EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('version_number', (int) $requirements->published_version)
            ->first();
        if ($version === null) {
            throw new EventSafetyException('event_safety_requirements_version_unavailable');
        }
        $hasPublishEvidence = DB::table('event_safety_requirement_history')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('requirements_revision', (int) $requirements->revision)
            ->where('requirements_version_id', (int) $version->id)
            ->where('requirements_version_number', (int) $version->version_number)
            ->where('action', 'published')
            ->where('actor_user_id', (int) $requirements->published_by_user_id)
            ->exists();
        $expectedPolicy = $this->support->eligibilityPolicyMetadata();
        if (! $hasPublishEvidence
            || $version->eligibility_policy_metadata !== $expectedPolicy
            || ! hash_equals(
                (string) $version->eligibility_policy_hash,
                $this->support->requestHash($expectedPolicy),
            )
            || ((bool) $version->code_of_conduct_required
                && (! is_string($version->code_of_conduct_text)
                    || ! hash_equals(
                        (string) $version->code_of_conduct_text_hash,
                        $this->support->exactTextHash($version->code_of_conduct_text),
                    )))) {
            throw new EventSafetyException('event_safety_requirements_integrity_invalid');
        }

        return [$requirements, $version];
    }

    private function isBlocked(int $tenantId, int $userId, int $organizerId): bool
    {
        if ($userId === $organizerId) {
            return false;
        }

        return DB::table('user_blocks')
            ->where('tenant_id', $tenantId)
            ->where(static function ($query) use ($userId, $organizerId): void {
                $query->where(static function ($forward) use ($userId, $organizerId): void {
                    $forward->where('user_id', $userId)
                        ->where('blocked_user_id', $organizerId);
                })->orWhere(static function ($reverse) use ($userId, $organizerId): void {
                    $reverse->where('user_id', $organizerId)
                        ->where('blocked_user_id', $userId);
                });
            })
            ->exists();
    }

    private function activeDenialReason(
        int $tenantId,
        int $eventId,
        int $userId,
        string $eventStartUtc,
    ): ?string {
        $denial = DB::table('event_participation_denials')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('status', EventParticipationDenialStatus::Active->value)
            ->where('effective_from', '<=', $eventStartUtc)
            ->where(static function ($query) use ($eventStartUtc): void {
                $query->whereNull('effective_until')
                    ->orWhere('effective_until', '>', $eventStartUtc);
            })
            ->first();
        if ($denial === null) {
            return null;
        }
        $hasEvidence = DB::table('event_participation_denial_history')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('denial_id', (int) $denial->id)
            ->where('user_id', $userId)
            ->where('decision_version', (int) $denial->decision_version)
            ->where('decision', (string) $denial->decision)
            ->where('reason_code', (string) $denial->reason_code)
            ->where('reviewer_user_id', (int) $denial->reviewed_by_user_id)
            ->where('effective_from', $denial->effective_from)
            ->where('effective_until', $denial->effective_until)
            ->where('status', EventParticipationDenialStatus::Active->value)
            ->where('action', 'recorded')
            ->exists();
        $reason = $denial->reason_code;
        if (! $hasEvidence || ! is_string($reason) || $reason === '') {
            throw new EventSafetyException('event_participation_denial_integrity_invalid');
        }

        return $reason;
    }

    /**
     * Not called since guardian consent was switched off (2026-09-25). Kept so
     * re-enabling it is a revert of the evaluate() change, not a rewrite of the
     * integrity checks below.
     */
    private function hasValidGuardianConsent(
        int $tenantId,
        Event $event,
        EventSafetyRequirement $requirements,
        EventSafetyRequirementVersion $version,
        User $participant,
        string $eventStartUtc,
    ): bool {
        $consent = EventGuardianConsent::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $event->id)
            ->where('minor_user_id', (int) $participant->id)
            ->where('requirements_id', (int) $requirements->id)
            ->where('requirements_version_id', (int) $version->id)
            ->where('status', EventGuardianConsentStatus::Active->value)
            ->whereNotNull('token_consumed_at')
            ->where('expires_at', '>', $eventStartUtc)
            ->whereExists(static function ($history): void {
                $history->selectRaw('1')
                    ->from('event_guardian_consent_history as history')
                    ->whereColumn('history.tenant_id', 'event_guardian_consents.tenant_id')
                    ->whereColumn('history.event_id', 'event_guardian_consents.event_id')
                    ->whereColumn('history.consent_id', 'event_guardian_consents.id')
                    ->whereColumn('history.minor_user_id', 'event_guardian_consents.minor_user_id')
                    ->whereColumn('history.consent_version', 'event_guardian_consents.consent_version')
                    ->where('history.status', EventGuardianConsentStatus::Active->value)
                    ->where('history.action', 'granted');
            })
            ->first();
        if ($consent === null) {
            return false;
        }
        $email = $this->support->decrypt((string) $consent->guardian_email_ciphertext);
        $identityJson = $this->support->decrypt(
            (string) $consent->guardian_identity_ciphertext,
        );
        try {
            $identity = json_decode($identityJson, true, 512, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            throw new EventSafetyException('event_guardian_consent_integrity_invalid');
        }
        if (! is_array($identity)
            || array_keys($identity) !== ['guardian_name', 'relationship_code']
            || ! is_string($identity['guardian_name'])
            || trim($identity['guardian_name']) === ''
            || strlen(trim($identity['guardian_name'])) > 191
            || ! is_string($identity['relationship_code'])
            || ! in_array(
                $identity['relationship_code'],
                ['parent', 'guardian', 'legal_guardian', 'carer'],
                true,
            )
            || ! hash_equals(
                (string) $consent->relationship_code,
                $identity['relationship_code'],
            )) {
            throw new EventSafetyException('event_guardian_consent_integrity_invalid');
        }
        $emailBlind = $this->support->privacyHash($tenantId, 'guardian-email', $email);
        $identityHash = $this->support->privacyHash(
            $tenantId,
            'guardian-identity',
            $identityJson,
        );
        if (! hash_equals((string) $consent->guardian_email_blind_hash, $emailBlind)
            || ! hash_equals(
                (string) $consent->consent_text_hash,
                $this->support->exactTextHash((string) $consent->consent_text),
            )) {
            throw new EventSafetyException('event_guardian_consent_integrity_invalid');
        }
        $binding = $this->support->privacyHash(
            $tenantId,
            'guardian-policy-binding',
            implode('|', [
                (int) $event->id,
                (int) $participant->id,
                $emailBlind,
                $identityHash,
                (int) $version->id,
                (string) $version->eligibility_policy_hash,
                (string) $consent->consent_text_version,
                (string) $consent->consent_text_hash,
            ]),
        );

        return hash_equals((string) $consent->policy_binding_hash, $binding);
    }

    private function hasCurrentCodeAcknowledgement(
        int $tenantId,
        int $eventId,
        int $userId,
        EventSafetyRequirement $requirements,
        EventSafetyRequirementVersion $version,
    ): bool {
        return EventSafetyCodeAcknowledgement::withoutGlobalScopes()
            ->from('event_safety_code_acknowledgements as acknowledged')
            ->where('acknowledged.tenant_id', $tenantId)
            ->where('acknowledged.event_id', $eventId)
            ->where('acknowledged.user_id', $userId)
            ->where('acknowledged.requirements_id', (int) $requirements->id)
            ->where('acknowledged.requirements_version_id', (int) $version->id)
            ->where('acknowledged.action', EventSafetyCodeEvidenceAction::Acknowledged->value)
            ->where('acknowledged.text_version', (string) $version->code_of_conduct_text_version)
            ->where('acknowledged.text_hash', (string) $version->code_of_conduct_text_hash)
            ->whereNotExists(static function ($terminal): void {
                $terminal->selectRaw('1')
                    ->from('event_safety_code_acknowledgements as terminal')
                    ->whereColumn(
                        'terminal.referenced_acknowledgement_id',
                        'acknowledged.id',
                    )
                    ->whereIn('terminal.action', [
                        EventSafetyCodeEvidenceAction::Withdrawn->value,
                        EventSafetyCodeEvidenceAction::Replaced->value,
                    ]);
            })
            ->exists();
    }

    private function safeguardingDecision(
        int $tenantId,
        int $participantId,
        int $organizerId,
    ): SafeguardingInteractionDecision {
        if ($participantId === $organizerId) {
            return new SafeguardingInteractionDecision(
                status: SafeguardingInteractionDecision::ALLOW,
                code: 'SAFEGUARDING_ALLOWED',
                recipientTenantId: $tenantId,
                purposeCode: 'event_participation_self',
                scopeType: 'event',
                scopeIdentifier: '',
            );
        }
        $policy = $this->interactionPolicy ?? app(SafeguardingInteractionPolicy::class);

        return $policy->evaluateLocalContact(
            $participantId,
            $organizerId,
            $tenantId,
            'event_participation',
        );
    }

    /** @return array<string,mixed> */
    private function safePolicyEvidence(SafeguardingInteractionDecision $decision): array
    {
        return [
            'status' => $decision->status,
            'code' => $decision->code,
            'purpose_code' => $decision->purposeCode,
            'scope_type' => $decision->scopeType,
            'scope_identifier' => $decision->scopeIdentifier,
            'policy_version' => $decision->policyVersion,
            'required_attestation_codes' => $decision->requiredAttestationCodes,
            'can_request_coordinator' => $decision->canRequestCoordinator,
        ];
    }

    /** @param list<string> $reasons @param list<string> $actions @param array<string,mixed> $policy */
    private function deny(
        int $eventId,
        ?int $userId,
        ?int $requirementsVersion,
        array $reasons,
        array $actions,
        ?int $age = null,
        ?bool $minor = null,
        array $policy = [],
    ): EventSafetyEligibilityDecision {
        return new EventSafetyEligibilityDecision(
            status: EventSafetyEligibilityDecision::DENY,
            eventId: $eventId,
            userId: $userId,
            reasonCodes: $reasons,
            requiredActions: $actions,
            requirementsVersion: $requirementsVersion,
            ageAtEvent: $age,
            minorAtEvent: $minor,
            safeguardingPolicy: $policy,
        );
    }

    /** @param list<string> $reasons @param list<string> $actions @param array<string,mixed> $policy */
    private function unavailable(
        int $eventId,
        ?int $userId,
        ?int $requirementsVersion,
        array $reasons,
        array $actions,
        ?int $age = null,
        ?bool $minor = null,
        array $policy = [],
    ): EventSafetyEligibilityDecision {
        return new EventSafetyEligibilityDecision(
            status: EventSafetyEligibilityDecision::UNAVAILABLE,
            eventId: $eventId,
            userId: $userId,
            reasonCodes: $reasons,
            requiredActions: $actions,
            requirementsVersion: $requirementsVersion,
            ageAtEvent: $age,
            minorAtEvent: $minor,
            safeguardingPolicy: $policy,
        );
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_safety_requirements',
            'event_safety_requirement_versions',
            'event_safety_requirement_history',
            'event_safety_code_acknowledgements',
            'event_guardian_consents',
            'event_guardian_consent_history',
            'event_participation_denials',
            'event_participation_denial_history',
            'user_blocks',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_safety_schema_unavailable');
            }
        }
        if (! Schema::hasColumn('user_blocks', 'tenant_id')
            || ! Schema::hasColumn('users', 'date_of_birth')) {
            throw new EventSafetyException('event_safety_schema_unavailable');
        }
    }
}
