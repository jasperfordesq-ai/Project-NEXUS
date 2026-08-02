<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\Validator;
use App\Enums\EventRegistrationSettingsStatus;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\EventRegistrationGuest;
use App\Models\User;
use App\Support\Events\EventRegistrationFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Explicit guest identity, consent, ticket linkage, and host-owned cancellation. */
final class EventRegistrationGuestService
{
    private const ACTIVE_REGISTRATION_STATES = ['invited', 'pending', 'confirmed'];

    /**
     * Guest rows that occupy a seat. 'withdrawn' and 'anonymised' guests have
     * given their place back (the schema CHECK constrains status to exactly
     * these three values).
     */
    private const CAPACITY_CONSUMING_GUEST_STATES = ['captured'];
    private const SUPPORTED_LOCALES = [
        'ar', 'de', 'en', 'es', 'fr', 'ga', 'it', 'ja', 'nl', 'pl', 'pt',
    ];

    public function __construct(
        private readonly EventRegistrationFoundationSupport $support = new EventRegistrationFoundationSupport(),
        private readonly EventDomainOutboxService $outbox = new EventDomainOutboxService(),
    ) {
    }

    /** @return array{guest:EventRegistrationGuest,party_size:int} */
    public function capture(
        int $eventId,
        int $registrationId,
        User|int $actor,
        int $expectedRegistrationVersion,
        string $displayName,
        ?string $email,
        ?string $phone,
        bool $consentAccepted,
        string $consentText,
        string $consentTextVersion,
        ?string $preferredLocale = null,
        bool $notificationConsent = false,
        ?string $notificationConsentText = null,
        ?string $notificationConsentVersion = null,
        ?int $ticketEntitlementId = null,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $registrationId,
            $actor,
            $expectedRegistrationVersion,
            $displayName,
            $email,
            $phone,
            $consentAccepted,
            $consentText,
            $consentTextVersion,
            $preferredLocale,
            $notificationConsent,
            $notificationConsentText,
            $notificationConsentVersion,
            $ticketEntitlementId,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $registration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $registrationId)
                ->lockForUpdate()
                ->first();
            if ($registration === null) {
                throw new EventRegistrationFoundationException('event_registration_not_found');
            }
            if ((int) $registration->user_id !== (int) $persistedActor->id) {
                throw new EventRegistrationFoundationException('event_registration_guest_identity_mismatch');
            }
            if ((int) $registration->registration_version !== $expectedRegistrationVersion) {
                throw new EventRegistrationFoundationException('event_registration_guest_registration_version_conflict');
            }
            if (! in_array((string) $registration->registration_state, self::ACTIVE_REGISTRATION_STATES, true)) {
                throw new EventRegistrationFoundationException('event_registration_guest_registration_inactive');
            }
            $settings = DB::table('event_registration_settings')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->lockForUpdate()
                ->first();
            if ($settings === null
                || (string) $settings->status !== EventRegistrationSettingsStatus::Published->value
                || ! (bool) $settings->guests_enabled
                || (int) $settings->max_guests_per_registration < 1) {
                throw new EventRegistrationFoundationException('event_registration_guests_disabled');
            }
            $name = trim($displayName);
            $consentText = trim($consentText);
            $consentTextVersion = trim($consentTextVersion);
            if ($name === '' || mb_strlen($name) > 191) {
                throw new EventRegistrationFoundationException('event_registration_guest_name_invalid');
            }
            if (! $consentAccepted
                || $consentText === '' || mb_strlen($consentText) > 20000
                || $consentTextVersion === '' || mb_strlen($consentTextVersion) > 64) {
                throw new EventRegistrationFoundationException('event_registration_guest_consent_required');
            }
            $normalizedEmail = null;
            if ($email !== null && trim($email) !== '') {
                $normalizedEmail = $this->support->normalizeEmail($email);
            }
            $normalizedPhone = null;
            if ($phone !== null && trim($phone) !== '') {
                $normalizedPhone = trim($phone);
                if (! Validator::isPhone($normalizedPhone)) {
                    throw new EventRegistrationFoundationException('event_registration_guest_phone_invalid');
                }
            }
            $locale = $preferredLocale === null || trim($preferredLocale) === ''
                ? null
                : $this->locale($preferredLocale);
            $notificationText = trim((string) $notificationConsentText);
            $notificationVersion = trim((string) $notificationConsentVersion);
            if ($notificationConsent) {
                if ($normalizedEmail === null
                    || $locale === null
                    || $notificationText === ''
                    || mb_strlen($notificationText) > 20000
                    || $notificationVersion === ''
                    || mb_strlen($notificationVersion) > 64) {
                    throw new EventRegistrationFoundationException('event_registration_guest_notification_consent_invalid');
                }
            } elseif ($notificationText !== '' || $notificationVersion !== '') {
                throw new EventRegistrationFoundationException('event_registration_guest_notification_consent_invalid');
            }
            $guestCount = DB::table('event_registration_guests')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('registration_id', $registrationId)
                ->where('status', '<>', 'anonymised')
                ->count();
            if ($guestCount >= (int) $settings->max_guests_per_registration) {
                throw new EventRegistrationFoundationException('event_registration_guest_limit_reached');
            }

            // 🔴 VENUE CAPACITY. max_guests_per_registration caps how many
            // guests ONE member may bring; it says nothing about how many
            // bodies the room holds. Without this check a 2-capacity event
            // accepted 22 attendees — every registration is one capacity unit
            // (party_size is never written above 1), so guests were invisible
            // to availableSlotsLocked() and the capacity gate never fired for
            // them. For a community venue that limit is often a fire limit,
            // so guests are now counted against it like anyone else.
            // The event row is already locked by concreteEvent(..., true).
            $capacity = $event->getAttribute('max_attendees');
            if ($capacity !== null && $capacity !== '' && (int) $capacity > 0) {
                $activeRegistrations = (int) DB::table('event_registrations')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->whereIn('registration_state', self::ACTIVE_REGISTRATION_STATES)
                    ->count();
                $activeGuests = (int) DB::table('event_registration_guests')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->whereIn('status', self::CAPACITY_CONSUMING_GUEST_STATES)
                    ->count();

                if ($activeRegistrations + $activeGuests >= (int) $capacity) {
                    throw new EventRegistrationFoundationException('event_registration_guest_capacity_full');
                }
            }
            $guestNumber = ((int) DB::table('event_registration_guests')
                ->where('tenant_id', $tenantId)
                ->where('registration_id', $registrationId)
                ->max('guest_number')) + 1;
            if ($guestNumber > 10) {
                throw new EventRegistrationFoundationException('event_registration_guest_limit_reached');
            }
            if ($ticketEntitlementId !== null) {
                if ($ticketEntitlementId <= 0) {
                    throw new EventRegistrationFoundationException('event_registration_guest_ticket_invalid');
                }
                $ticket = DB::table('event_ticket_entitlements')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('id', $ticketEntitlementId)
                    ->where('registration_id', $registrationId)
                    ->where('user_id', (int) $persistedActor->id)
                    ->where('status', 'confirmed')
                    ->lockForUpdate()
                    ->first(['id', 'units']);
                $activeGuestCount = DB::table('event_registration_guests')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('registration_id', $registrationId)
                    ->where('status', 'captured')
                    ->count();
                if ($ticket === null || (int) $ticket->units < $activeGuestCount + 2) {
                    throw new EventRegistrationFoundationException('event_registration_guest_ticket_invalid');
                }
            }
            $fingerprint = $this->support->privacyHash(
                "event-guest|{$tenantId}|{$eventId}|{$registrationId}",
                mb_strtolower($name) . '|' . $normalizedEmail . '|' . $normalizedPhone,
            );
            if (DB::table('event_registration_guests')
                ->where('tenant_id', $tenantId)
                ->where('registration_id', $registrationId)
                ->where('identity_fingerprint', $fingerprint)
                ->exists()) {
                throw new EventRegistrationFoundationException('event_registration_guest_duplicate');
            }
            $now = CarbonImmutable::now('UTC');
            $guestId = (int) DB::table('event_registration_guests')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'registration_id' => $registrationId,
                'ticket_entitlement_id' => $ticketEntitlementId,
                'guest_number' => $guestNumber,
                'revision' => 1,
                'status' => 'captured',
                'display_name_ciphertext' => $this->support->encrypt($name),
                'email_ciphertext' => $normalizedEmail === null
                    ? null
                    : $this->support->encrypt($normalizedEmail),
                'phone_ciphertext' => $normalizedPhone === null
                    ? null
                    : $this->support->encrypt($normalizedPhone),
                'preferred_locale' => $locale,
                'notification_consent' => $notificationConsent,
                'notification_consent_version' => $notificationConsent ? $notificationVersion : null,
                'notification_consent_text_hash' => $notificationConsent
                    ? hash('sha256', $notificationText)
                    : null,
                'notification_consented_at' => $notificationConsent ? $now : null,
                'identity_fingerprint' => $fingerprint,
                'consent_text_version' => $consentTextVersion,
                'consent_text_hash' => hash('sha256', $consentText),
                'consented_at' => $now,
                'retention_due_at' => $this->support->eventEnd($event)
                    ->addDays((int) $settings->guest_retention_days),
                'captured_by_user_id' => (int) $persistedActor->id,
                'withdrawn_at' => null,
                'anonymised_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            return [
                'guest' => EventRegistrationGuest::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($guestId)
                    ->firstOrFail(),
                'party_size' => (int) $registration->party_size,
            ];
        }, 3);
    }

    /** @return array{guest:EventRegistrationGuest,changed:bool,party_size:int} */
    public function cancel(
        int $eventId,
        int $guestId,
        User|int $actor,
        int $expectedRevision,
        string $reason,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventRegistrationFoundationException('event_registration_guest_cancellation_reason_invalid');
        }

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $guestId,
            $actor,
            $expectedRevision,
            $reason,
        ): array {
            $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $guest = DB::table('event_registration_guests')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $guestId)
                ->lockForUpdate()
                ->first();
            if ($guest === null) {
                throw new EventRegistrationFoundationException('event_registration_guest_not_found');
            }
            $registration = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', (int) $guest->registration_id)
                ->lockForUpdate()
                ->first(['id', 'user_id', 'party_size']);
            if ($registration === null || (int) $registration->user_id !== (int) $persistedActor->id) {
                throw new EventRegistrationFoundationException('event_registration_guest_identity_mismatch');
            }
            if ((string) $guest->status === 'withdrawn') {
                if ((int) $guest->revision !== $expectedRevision + 1) {
                    throw new EventRegistrationFoundationException('event_registration_guest_revision_conflict');
                }
                $outbox = DB::table('event_domain_outbox')
                    ->where('tenant_id', $tenantId)
                    ->where('idempotency_key', "event-registration-guest-withdrawn:{$tenantId}:{$eventId}:{$guestId}:" . ($expectedRevision + 1))
                    ->first(['payload']);
                $payload = $outbox === null ? null : json_decode((string) $outbox->payload, true);
                if (! is_array($payload)
                    || ($payload['reason'] ?? null) !== $reason
                    || (int) ($payload['actor_user_id'] ?? 0) !== (int) $persistedActor->id) {
                    throw new EventRegistrationFoundationException('event_registration_guest_cancellation_idempotency_conflict');
                }
                return [
                    'guest' => $this->guestModel($tenantId, $guestId),
                    'changed' => false,
                    'party_size' => (int) $registration->party_size,
                ];
            }
            if ((int) $guest->revision !== $expectedRevision) {
                throw new EventRegistrationFoundationException('event_registration_guest_revision_conflict');
            }
            if ((string) $guest->status !== 'captured') {
                throw new EventRegistrationFoundationException('event_registration_guest_cancellation_invalid');
            }
            $now = CarbonImmutable::now('UTC');
            if (DB::table('event_registration_guests')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('id', $guestId)
                ->where('revision', $expectedRevision)
                ->where('status', 'captured')
                ->update([
                    'status' => 'withdrawn',
                    'revision' => $expectedRevision + 1,
                    'withdrawn_at' => $now,
                    'updated_at' => $now,
                ]) !== 1) {
                throw new EventRegistrationFoundationException('event_registration_guest_revision_conflict');
            }
            $this->outbox->record(
                $tenantId,
                $eventId,
                $expectedRevision + 1,
                'event.registration_guest.withdrawn',
                "event-registration-guest-withdrawn:{$tenantId}:{$eventId}:{$guestId}:" . ($expectedRevision + 1),
                [
                    'guest_id' => $guestId,
                    'registration_id' => (int) $guest->registration_id,
                    'guest_revision' => $expectedRevision + 1,
                    'actor_user_id' => (int) $persistedActor->id,
                    'reason' => $reason,
                    'notification_consent' => (bool) ($guest->notification_consent ?? false),
                    'recipient_locale' => $guest->preferred_locale,
                    'external_email_ciphertext' => $guest->email_ciphertext,
                    'occurred_at' => $now->format('Y-m-d\TH:i:s.u\Z'),
                ],
                aggregateStream: "event:{$eventId}:registration-guest:{$guestId}",
            );

            return [
                'guest' => $this->guestModel($tenantId, $guestId),
                'changed' => true,
                'party_size' => (int) $registration->party_size,
            ];
        }, 3);
    }

    private function guestModel(int $tenantId, int $guestId): EventRegistrationGuest
    {
        return EventRegistrationGuest::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($guestId)
            ->firstOrFail();
    }

    private function locale(string $locale): string
    {
        $locale = strtolower(trim(str_replace('_', '-', $locale)));
        $locale = explode('-', $locale, 2)[0];
        if (! in_array($locale, self::SUPPORTED_LOCALES, true)) {
            throw new EventRegistrationFoundationException('event_registration_guest_locale_invalid');
        }

        return $locale;
    }

    private function assertSchema(): void
    {
        foreach (['event_registration_guests', 'event_ticket_entitlements'] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRegistrationFoundationException('event_registration_guest_schema_unavailable');
            }
        }
        foreach ([
            'preferred_locale', 'notification_consent', 'notification_consent_version',
            'notification_consent_text_hash', 'notification_consented_at',
            'ticket_entitlement_id',
        ] as $column) {
            if (! Schema::hasColumn('event_registration_guests', $column)) {
                throw new EventRegistrationFoundationException('event_registration_guest_schema_unavailable');
            }
        }
    }
}
