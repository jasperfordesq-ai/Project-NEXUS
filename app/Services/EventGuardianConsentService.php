<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventGuardianConsentAction;
use App\Enums\EventGuardianConsentStatus;
use App\Enums\EventNotificationDeliveryMode;
use App\Enums\EventSafetyRequirementStatus;
use App\Exceptions\EventSafetyException;
use App\I18n\LocaleContext;
use App\Models\Event;
use App\Models\EventGuardianConsent;
use App\Models\EventGuardianConsentHistory;
use App\Models\EventSafetyRequirement;
use App\Models\EventSafetyRequirementVersion;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Closure;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Event-bound guardian consent with encrypted identity and one-use opaque proof. */
final class EventGuardianConsentService
{
    private readonly Closure $tokenGenerator;

    public function __construct(
        private readonly EventSafetyFoundationSupport $support = new EventSafetyFoundationSupport(),
        ?Closure $tokenGenerator = null,
        private readonly ?EventDomainOutboxService $outbox = null,
        private readonly ?EventGuardianConsentDeliveryEnvelopeService $deliveryEnvelopes = null,
        private readonly ?EventGuardianLocaleResolver $localeResolver = null,
        private readonly ?EventGuardianConsentStatusPublisher $statusNotifications = null,
        private readonly ?EventPolicy $eventPolicy = null,
    ) {
        $this->tokenGenerator = $tokenGenerator
            ?? fn (): string => $this->support->guardianToken();
    }

    /**
     * The plaintext token is deliberately not returned. Phase B must deliver it
     * inside the trusted guardian-address delivery boundary, never to the minor.
     *
     * @param array<string,mixed> $guardianIdentity
     * @return array{consent:EventGuardianConsent,changed:bool}
     */
    public function request(
        int $eventId,
        User|int $minor,
        User|int $actor,
        array $guardianIdentity,
        string $consentText,
        string $consentTextVersion,
        DateTimeInterface $expiresAt,
        string $idempotencyKey,
    ): array {
        return $this->requestInternal(
            $eventId,
            $minor,
            $actor,
            $guardianIdentity,
            $consentText,
            $consentTextVersion,
            $expiresAt,
            $idempotencyKey,
            null,
            false,
        );
    }

    /**
     * Seal the one-use token and its authoritative outbox fact atomically.
     * The plaintext token exists only inside this transaction and the AES-GCM
     * service boundary; it is never returned to the caller.
     *
     * @param array<string,mixed> $guardianIdentity
     * @return array{consent:EventGuardianConsent,changed:bool}
     */
    public function requestWithDelivery(
        int $eventId,
        User|int $minor,
        User|int $actor,
        array $guardianIdentity,
        string $guardianLocale,
        string $idempotencyKey,
    ): array {
        return $this->requestInternal(
            $eventId,
            $minor,
            $actor,
            $guardianIdentity,
            '',
            'guardian-consent-v1',
            CarbonImmutable::now('UTC')->addDay(),
            $idempotencyKey,
            $guardianLocale,
            true,
        );
    }

    /**
     * @param array<string,mixed> $guardianIdentity
     * @return array{consent:EventGuardianConsent,changed:bool}
     */
    private function requestInternal(
        int $eventId,
        User|int $minor,
        User|int $actor,
        array $guardianIdentity,
        string $consentText,
        string $consentTextVersion,
        DateTimeInterface $expiresAt,
        string $idempotencyKey,
        ?string $requestedGuardianLocale,
        bool $withDelivery,
    ): array {
        $this->assertSchema();
        if ($withDelivery) {
            $this->assertDeliverySchema();
            ($this->deliveryEnvelopes ?? new EventGuardianConsentDeliveryEnvelopeService())
                ->assertCryptoAvailable();
        }
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $minor,
            $actor,
            $guardianIdentity,
            $consentText,
            $consentTextVersion,
            $expiresAt,
            $idempotencyHash,
            $requestedGuardianLocale,
            $withDelivery,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedMinor = $this->support->activeUser(
                $tenantId,
                $minor,
                true,
                'event_guardian_minor_not_active',
            );
            $persistedActor = $this->support->activeUser(
                $tenantId,
                $actor,
                true,
                'event_safety_actor_not_active',
            );
            if ((int) $persistedActor->id !== (int) $persistedMinor->id) {
                $this->support->authorizeManager($persistedActor, $event);
            }
            // A guardian-consent request is participation state for the minor,
            // so the minor must be inside the event's current audience before
            // any consent, history, outbox or delivery-envelope row is written.
            if (! ($this->eventPolicy ?? new EventPolicy())->view($persistedMinor, $event)) {
                throw new EventSafetyException('event_safety_authorization_denied');
            }
            $context = $this->publishedGuardianContext($tenantId, $eventId, true);
            $guardianLocale = $withDelivery
                ? ($this->localeResolver ?? new EventGuardianLocaleResolver())->resolve(
                    $requestedGuardianLocale,
                    $persistedMinor,
                )
                : null;
            if ($withDelivery && $guardianLocale !== null) {
                $consentText = LocaleContext::withLocale(
                    $guardianLocale,
                    static fn (): string => __('emails.event_guardian_consent.consent_text', [
                        'event' => (string) $event->title,
                    ]),
                );
                $consentTextVersion = 'guardian-consent-v1';
            }
            $age = $this->minorAgeAtEvent($persistedMinor, $event);
            if ($age >= (int) $context['version']->minor_age_threshold) {
                throw new EventSafetyException('event_guardian_consent_not_required');
            }
            $identity = $this->normalizeGuardianIdentity($guardianIdentity);
            $minorEmail = $this->support->normalizeEmail((string) $persistedMinor->email);
            if (hash_equals($minorEmail, $identity['guardian_email'])) {
                throw new EventSafetyException('event_guardian_identity_not_distinct');
            }
            $textVersion = trim($consentTextVersion);
            if (trim($consentText) === ''
                || strlen($consentText) > 100000
                || $textVersion === ''
                || strlen($textVersion) > 64) {
                throw new EventSafetyException('event_guardian_consent_text_invalid');
            }
            $now = CarbonImmutable::now('UTC');
            $eventStart = $this->support->eventStartContext($event)['start_utc'];
            $expiry = $withDelivery
                ? $now->addDays(max(1, (int) config(
                    'events.safety.guardian_consent_ttl_days',
                    30,
                )))->max($eventStart->addDay())
                : CarbonImmutable::instance($expiresAt)->utc();
            if (! $expiry->isFuture() || ! $expiry->greaterThan($eventStart)) {
                throw new EventSafetyException('event_guardian_consent_expiry_invalid');
            }
            $emailBlindHash = $this->support->privacyHash(
                $tenantId,
                'guardian-email',
                $identity['guardian_email'],
            );
            $identityJson = json_encode(
                [
                    'guardian_name' => $identity['guardian_name'],
                    'relationship_code' => $identity['relationship_code'],
                ],
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            );
            $identityHash = $this->support->privacyHash(
                $tenantId,
                'guardian-identity',
                $identityJson,
            );
            $textHash = $this->support->exactTextHash($consentText);
            $policyBindingHash = $this->support->privacyHash(
                $tenantId,
                'guardian-policy-binding',
                implode('|', [
                    $eventId,
                    (int) $persistedMinor->id,
                    $emailBlindHash,
                    $identityHash,
                    (int) $context['version']->id,
                    (string) $context['version']->eligibility_policy_hash,
                    $textVersion,
                    $textHash,
                ]),
            );
            $requestFacts = [
                'action' => EventGuardianConsentAction::Requested->value,
                'event_id' => $eventId,
                'minor_user_id' => (int) $persistedMinor->id,
                'actor_user_id' => (int) $persistedActor->id,
                'requirements_version_id' => (int) $context['version']->id,
                'guardian_email_blind_hash' => $emailBlindHash,
                'guardian_identity_hash' => $identityHash,
                'relationship_code' => $identity['relationship_code'],
                'consent_text_version' => $textVersion,
                'consent_text_hash' => $textHash,
                'policy_binding_hash' => $policyBindingHash,
                'expires_at' => $expiry,
            ];
            if ($guardianLocale !== null) {
                $requestFacts['guardian_locale'] = $guardianLocale;
            }
            $requestHash = $this->support->requestHash($requestFacts);
            $replay = $this->requestReplay(
                $tenantId,
                $idempotencyHash,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return ['consent' => $replay, 'changed' => false];
            }
            $current = EventGuardianConsent::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('minor_user_id', (int) $persistedMinor->id)
                ->where('active_slot', 1)
                ->lockForUpdate()
                ->first();
            if ($current !== null) {
                throw new EventSafetyException('event_guardian_consent_current_exists');
            }
            $token = ($this->tokenGenerator)();
            if (! is_string($token)) {
                throw new EventSafetyException('event_guardian_token_invalid');
            }
            $tokenHash = $this->support->tokenHash($tenantId, $token);
            $consentId = (int) DB::table('event_guardian_consents')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                'requirements_id' => (int) $context['requirements']->id,
                'requirements_version_id' => (int) $context['version']->id,
                'requirements_version_number' => (int) $context['version']->version_number,
                'minor_user_id' => (int) $persistedMinor->id,
                'guardian_email_ciphertext' => $this->support->encrypt(
                    $identity['guardian_email'],
                ),
                'guardian_identity_ciphertext' => $this->support->encrypt($identityJson),
                'guardian_email_blind_hash' => $emailBlindHash,
                'relationship_code' => $identity['relationship_code'],
                'guardian_locale' => $guardianLocale,
                'consent_text' => $consentText,
                'consent_text_version' => $textVersion,
                'consent_text_hash' => $textHash,
                'policy_binding_hash' => $policyBindingHash,
                'token_hash' => $tokenHash,
                'status' => EventGuardianConsentStatus::Pending->value,
                'active_slot' => 1,
                'consent_version' => 1,
                'requested_by_user_id' => (int) $persistedActor->id,
                'request_idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'requested_at' => $now,
                'expires_at' => $expiry,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $this->insertHistory(
                $tenantId,
                $eventId,
                $consentId,
                (int) $persistedMinor->id,
                1,
                EventGuardianConsentStatus::Pending,
                EventGuardianConsentAction::Requested,
                'platform_user',
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                [
                    'policy_binding_hash' => $policyBindingHash,
                    'consent_text_version' => $textVersion,
                    'consent_text_hash' => $textHash,
                    'token_plaintext_persisted' => false,
                ],
                $now,
            );
            $consent = $this->consentModel($tenantId, $consentId);
            if ($withDelivery) {
                $outbox = ($this->outbox ?? new EventDomainOutboxService())->record(
                    $tenantId,
                    $eventId,
                    1,
                    'event.safety.guardian_consent.requested',
                    "event-guardian-delivery:{$tenantId}:{$consentId}:{$idempotencyHash}",
                    [
                        'schema_version' => 1,
                        'tenant_id' => $tenantId,
                        'event_id' => $eventId,
                        'consent_id' => $consentId,
                        'consent_version' => 1,
                        'minor_user_id' => (int) $persistedMinor->id,
                        'requirements_version' => (int) $context['version']->version_number,
                        'expires_at' => $expiry->toIso8601String(),
                    ],
                    EventNotificationDeliveryMode::OutboxAuthoritative,
                    "event:{$eventId}:safety:guardian-consent:{$consentId}",
                );
                ($this->deliveryEnvelopes ?? new EventGuardianConsentDeliveryEnvelopeService())
                    ->seal($consent, (int) $outbox['id'], $token);
            }

            return [
                'consent' => $consent,
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{consent:EventGuardianConsent,changed:bool} */
    public function grant(
        string $token,
        string $guardianEmail,
        ?int $actingUserId,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $tokenHash = $this->support->tokenHash($tenantId, $token);
        $normalizedEmail = $this->support->normalizeEmail($guardianEmail);
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $tokenHash,
            $normalizedEmail,
            $actingUserId,
            $idempotencyHash,
        ): array {
            $located = EventGuardianConsent::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('token_hash', $tokenHash)
                ->first();
            if ($located === null) {
                throw new EventSafetyException('event_guardian_consent_not_found');
            }
            $event = $this->support->concreteEvent($tenantId, (int) $located->event_id, true);
            $this->support->activeUser(
                $tenantId,
                (int) $located->minor_user_id,
                true,
                'event_guardian_minor_not_active',
            );
            $actor = null;
            if ($actingUserId !== null) {
                $actor = $this->support->activeUser($tenantId, $actingUserId, true);
                if ((int) $actor->id === (int) $located->minor_user_id) {
                    throw new EventSafetyException('event_guardian_minor_self_grant_forbidden');
                }
                $actorEmail = $this->support->normalizeEmail((string) $actor->email);
                if (! hash_equals($normalizedEmail, $actorEmail)) {
                    throw new EventSafetyException('event_guardian_identity_proof_mismatch');
                }
            }
            $consent = EventGuardianConsent::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->whereKey((int) $located->id)
                ->where('token_hash', $tokenHash)
                ->lockForUpdate()
                ->first();
            if ($consent === null) {
                throw new EventSafetyException('event_guardian_consent_not_found');
            }
            $storedEmail = $this->support->decrypt(
                (string) $consent->guardian_email_ciphertext,
            );
            if (! hash_equals($storedEmail, $normalizedEmail)) {
                throw new EventSafetyException('event_guardian_identity_proof_mismatch');
            }
            $requestHash = $this->support->requestHash([
                'action' => EventGuardianConsentAction::Granted->value,
                'event_id' => (int) $event->id,
                'consent_id' => (int) $consent->id,
                'minor_user_id' => (int) $consent->minor_user_id,
                'guardian_email_blind_hash' => (string) $consent->guardian_email_blind_hash,
                'acting_user_id' => $actingUserId,
                'policy_binding_hash' => (string) $consent->policy_binding_hash,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                EventGuardianConsentAction::Granted,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return [
                    'consent' => $this->consentModel($tenantId, (int) $replay->consent_id),
                    'changed' => false,
                ];
            }
            if ((string) $consent->getRawOriginal('status')
                    !== EventGuardianConsentStatus::Pending->value
                || ! $consent->expires_at->isFuture()) {
                throw new EventSafetyException('event_guardian_consent_not_pending');
            }
            $newVersion = (int) $consent->consent_version + 1;
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_guardian_consents')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $consent->id)
                ->where('status', EventGuardianConsentStatus::Pending->value)
                ->where('consent_version', (int) $consent->consent_version)
                ->update([
                    'status' => EventGuardianConsentStatus::Active->value,
                    'consent_version' => $newVersion,
                    'token_consumed_at' => $now,
                    'granted_at' => $now,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventSafetyException('event_guardian_consent_version_conflict');
            }
            $this->insertHistory(
                $tenantId,
                (int) $consent->event_id,
                (int) $consent->id,
                (int) $consent->minor_user_id,
                $newVersion,
                EventGuardianConsentStatus::Active,
                EventGuardianConsentAction::Granted,
                $actor === null ? 'guardian_external' : 'platform_user',
                $actor !== null ? (int) $actor->id : null,
                $idempotencyHash,
                $requestHash,
                [
                    'policy_binding_hash' => (string) $consent->policy_binding_hash,
                    'token_consumed' => true,
                ],
                $now,
            );
            ($this->statusNotifications ?? new EventGuardianConsentStatusPublisher(
                $this->outbox ?? new EventDomainOutboxService(),
            ))->record(
                $tenantId,
                (int) $consent->event_id,
                (int) $consent->id,
                $newVersion,
                (int) $consent->minor_user_id,
                EventGuardianConsentAction::Granted,
                EventGuardianConsentStatus::Active,
                $idempotencyHash,
                $now,
            );

            return [
                'consent' => $this->consentModel($tenantId, (int) $consent->id),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{consent:EventGuardianConsent,changed:bool} */
    public function withdraw(
        int $eventId,
        int $consentId,
        User|int $actor,
        string $idempotencyKey,
    ): array {
        return $this->terminalTransition(
            $eventId,
            $consentId,
            $actor,
            EventGuardianConsentAction::Withdrawn,
            $idempotencyKey,
        );
    }

    /** @return array{consent:EventGuardianConsent,changed:bool} */
    public function expire(
        int $eventId,
        int $consentId,
        User|int $actor,
        string $idempotencyKey,
    ): array {
        return $this->terminalTransition(
            $eventId,
            $consentId,
            $actor,
            EventGuardianConsentAction::Expired,
            $idempotencyKey,
        );
    }

    /** @return array{consent:EventGuardianConsent,changed:bool} */
    private function terminalTransition(
        int $eventId,
        int $consentId,
        User|int $actor,
        EventGuardianConsentAction $action,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $consentId,
            $actor,
            $action,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->activeUser(
                $tenantId,
                $actor,
                true,
                'event_safety_actor_not_active',
            );
            $consent = EventGuardianConsent::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($consentId)
                ->lockForUpdate()
                ->first();
            if ($consent === null) {
                throw new EventSafetyException('event_guardian_consent_not_found');
            }
            $this->support->activeUser(
                $tenantId,
                (int) $consent->minor_user_id,
                false,
                'event_guardian_minor_not_active',
            );
            if ($action === EventGuardianConsentAction::Expired
                || (int) $persistedActor->id !== (int) $consent->minor_user_id) {
                $this->support->authorizeManager($persistedActor, $event);
            }
            $requestHash = $this->support->requestHash([
                'action' => $action->value,
                'event_id' => $eventId,
                'consent_id' => $consentId,
                'actor_user_id' => (int) $persistedActor->id,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                $action,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return [
                    'consent' => $this->consentModel($tenantId, $consentId),
                    'changed' => false,
                ];
            }
            if (! in_array((string) $consent->getRawOriginal('status'), [
                EventGuardianConsentStatus::Pending->value,
                EventGuardianConsentStatus::Active->value,
            ], true)) {
                throw new EventSafetyException('event_guardian_consent_terminal');
            }
            if ($action === EventGuardianConsentAction::Expired
                && $consent->expires_at->isFuture()) {
                throw new EventSafetyException('event_guardian_consent_not_expired');
            }
            $newVersion = (int) $consent->consent_version + 1;
            $now = CarbonImmutable::now('UTC');
            $status = $action === EventGuardianConsentAction::Withdrawn
                ? EventGuardianConsentStatus::Withdrawn
                : EventGuardianConsentStatus::Expired;
            $updates = [
                'status' => $status->value,
                'active_slot' => null,
                'consent_version' => $newVersion,
                'updated_at' => $now,
            ];
            if ($status === EventGuardianConsentStatus::Withdrawn) {
                $updates += [
                    'withdrawn_by_user_id' => (int) $persistedActor->id,
                    'withdrawn_at' => $now,
                ];
            } else {
                $updates += [
                    'expired_by_user_id' => (int) $persistedActor->id,
                    'expired_at' => $now,
                ];
            }
            $updated = DB::table('event_guardian_consents')
                ->where('tenant_id', $tenantId)
                ->where('id', $consentId)
                ->where('consent_version', (int) $consent->consent_version)
                ->whereIn('status', [
                    EventGuardianConsentStatus::Pending->value,
                    EventGuardianConsentStatus::Active->value,
                ])
                ->update($updates);
            if ($updated !== 1) {
                throw new EventSafetyException('event_guardian_consent_version_conflict');
            }
            $this->insertHistory(
                $tenantId,
                $eventId,
                $consentId,
                (int) $consent->minor_user_id,
                $newVersion,
                $status,
                $action,
                'platform_user',
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                ['terminal_reason_code' => $action->value],
                $now,
            );
            if ($action === EventGuardianConsentAction::Withdrawn) {
                ($this->statusNotifications ?? new EventGuardianConsentStatusPublisher(
                    $this->outbox ?? new EventDomainOutboxService(),
                ))->record(
                    $tenantId,
                    $eventId,
                    $consentId,
                    $newVersion,
                    (int) $consent->minor_user_id,
                    EventGuardianConsentAction::Withdrawn,
                    EventGuardianConsentStatus::Withdrawn,
                    $idempotencyHash,
                    $now,
                );
            }

            return [
                'consent' => $this->consentModel($tenantId, $consentId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion} */
    private function publishedGuardianContext(int $tenantId, int $eventId, bool $lock): array
    {
        $query = EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', EventSafetyRequirementStatus::Published->value);
        if ($lock) {
            $query->lockForUpdate();
        }
        $requirements = $query->first();
        if ($requirements === null || $requirements->published_version === null) {
            throw new EventSafetyException('event_safety_requirements_not_published');
        }
        $version = EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('version_number', (int) $requirements->published_version)
            ->first();
        if ($version === null
            || ! (bool) $version->guardian_consent_required
            || $version->minor_age_threshold === null) {
            throw new EventSafetyException('event_guardian_consent_not_required');
        }

        return ['requirements' => $requirements, 'version' => $version];
    }

    private function minorAgeAtEvent(
        User $minor,
        Event $event,
    ): int {
        $dateOfBirth = $minor->getRawOriginal('date_of_birth');
        if (! is_string($dateOfBirth) || trim($dateOfBirth) === '') {
            throw new EventSafetyException('event_safety_date_of_birth_required');
        }
        $start = $this->support->eventStartContext($event);

        return $this->support->ageOnLocalDate($dateOfBirth, $start['local_date']);
    }

    /** @param array<string,mixed> $identity @return array{guardian_name:string,guardian_email:string,relationship_code:string} */
    private function normalizeGuardianIdentity(array $identity): array
    {
        if (array_diff(array_keys($identity), [
            'guardian_name',
            'guardian_email',
            'relationship_code',
        ]) !== []
            || ! isset(
                $identity['guardian_name'],
                $identity['guardian_email'],
                $identity['relationship_code'],
            )
            || ! is_string($identity['guardian_name'])
            || trim($identity['guardian_name']) === ''
            || strlen(trim($identity['guardian_name'])) > 191
            || ! is_string($identity['guardian_email'])
            || ! is_string($identity['relationship_code'])) {
            throw new EventSafetyException('event_guardian_identity_invalid');
        }
        $relationship = trim($identity['relationship_code']);
        if (! in_array($relationship, ['parent', 'guardian', 'legal_guardian', 'carer'], true)) {
            throw new EventSafetyException('event_guardian_relationship_invalid');
        }

        return [
            'guardian_name' => trim($identity['guardian_name']),
            'guardian_email' => $this->support->normalizeEmail($identity['guardian_email']),
            'relationship_code' => $relationship,
        ];
    }

    private function requestReplay(
        int $tenantId,
        string $idempotencyHash,
        string $requestHash,
        bool $lock,
    ): ?EventGuardianConsent {
        $query = EventGuardianConsent::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('request_idempotency_hash', $idempotencyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $consent = $query->first();
        if ($consent === null) {
            return null;
        }
        if (! hash_equals((string) $consent->request_hash, $requestHash)) {
            throw new EventSafetyException('event_safety_idempotency_conflict');
        }

        return $consent;
    }

    private function historyReplay(
        int $tenantId,
        string $idempotencyHash,
        EventGuardianConsentAction $action,
        string $requestHash,
        bool $lock,
    ): ?EventGuardianConsentHistory {
        $query = EventGuardianConsentHistory::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $idempotencyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $history = $query->first();
        if ($history === null) {
            return null;
        }
        if ((string) $history->getRawOriginal('action') !== $action->value
            || ! hash_equals((string) $history->request_hash, $requestHash)) {
            throw new EventSafetyException('event_safety_idempotency_conflict');
        }

        return $history;
    }

    /** @param array<string,mixed> $evidence */
    private function insertHistory(
        int $tenantId,
        int $eventId,
        int $consentId,
        int $minorUserId,
        int $consentVersion,
        EventGuardianConsentStatus $status,
        EventGuardianConsentAction $action,
        string $actorType,
        ?int $actorUserId,
        string $idempotencyHash,
        string $requestHash,
        array $evidence,
        CarbonImmutable $now,
    ): void {
        DB::table('event_guardian_consent_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'consent_id' => $consentId,
            'minor_user_id' => $minorUserId,
            'consent_version' => $consentVersion,
            'status' => $status->value,
            'action' => $action->value,
            'actor_type' => $actorType,
            'actor_user_id' => $actorUserId,
            'idempotency_hash' => $idempotencyHash,
            'request_hash' => $requestHash,
            'evidence' => json_encode(
                $evidence,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            ),
            'created_at' => $now,
        ]);
    }

    private function consentModel(int $tenantId, int $id): EventGuardianConsent
    {
        return EventGuardianConsent::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_guardian_consents',
            'event_guardian_consent_history',
            'event_safety_requirements',
            'event_safety_requirement_versions',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_safety_schema_unavailable');
            }
        }
        if (! Schema::hasColumn('users', 'date_of_birth')) {
            throw new EventSafetyException('event_safety_date_of_birth_schema_unavailable');
        }
    }

    private function assertDeliverySchema(): void
    {
        foreach ([
            'event_domain_outbox',
            'event_notification_deliveries',
            'event_guardian_consent_delivery_envelopes',
            'event_guardian_consent_delivery_access',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_guardian_delivery_schema_unavailable');
            }
        }
        if (! Schema::hasColumn('event_guardian_consents', 'guardian_locale')
            || ! Schema::hasColumn('event_notification_deliveries', 'external_recipient_hash')) {
            throw new EventSafetyException('event_guardian_delivery_schema_unavailable');
        }
    }
}
