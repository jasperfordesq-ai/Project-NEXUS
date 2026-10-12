<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Core\TenantContext;
use App\Exceptions\EventSafetyException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use DateTimeImmutable;
use Illuminate\Support\Facades\Crypt;
use Throwable;
use App\Support\Authorization\CrossTenantEntry;

/** Shared fail-closed primitives for the isolated event-safety foundation. */
final class EventSafetyFoundationSupport
{
    public const POLICY_SCHEMA_VERSION = 1;

    private readonly EventPolicy $eventPolicy;

    public function __construct(?EventPolicy $eventPolicy = null)
    {
        $this->eventPolicy = $eventPolicy ?? new EventPolicy();
    }

    public function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventSafetyException('event_safety_tenant_context_required');
        }
        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventSafetyException('event_safety_feature_disabled');
            }
        } catch (EventSafetyException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new EventSafetyException('event_safety_feature_disabled');
        }

        return $tenantId;
    }

    public function activeUser(
        int $tenantId,
        User|int $user,
        bool $lock = false,
        string $reason = 'event_safety_user_not_active',
    ): User {
        $userId = $user instanceof User ? (int) $user->getKey() : $user;
        $query = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($userId)
            ->where('status', 'active')
            ->whereNull('deleted_at');
        if ($lock) {
            $query->lockForUpdate();
        }
        $persisted = $query->first();
        if ($persisted === null) {
            throw new EventSafetyException($reason);
        }

        return $persisted;
    }

    /**
     * The ACTING account (organiser, reviewer): its own community, or a tenant
     * super admin managing this community from above (CrossTenantEntry; owner
     * rule, 12 Oct 2026). Members acted ON keep activeUser(), which is strictly
     * this community's.
     */
    public function activeActor(
        int $tenantId,
        User|int $user,
        bool $lock = false,
        string $reason = 'event_safety_actor_not_active',
    ): User {
        $userId = $user instanceof User ? (int) $user->getKey() : $user;
        $persisted = CrossTenantEntry::activeActor($userId, $tenantId, $lock);
        if ($persisted === null) {
            throw new EventSafetyException($reason);
        }

        return $persisted;
    }

    public function concreteEvent(int $tenantId, int $eventId, bool $lock = false): Event
    {
        $query = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $event = $query->first();
        if ($event === null) {
            throw new EventSafetyException('event_safety_event_not_found');
        }
        if ((bool) $event->getRawOriginal('is_recurring_template')
            || trim((string) $event->getRawOriginal('occurrence_key')) === '') {
            throw new EventSafetyException('event_safety_concrete_event_required');
        }

        return $event;
    }

    public function authorizeManager(User $actor, Event $event): void
    {
        if (! $this->eventPolicy->manage($actor, $event)) {
            throw new EventSafetyException('event_safety_authorization_denied');
        }
    }

    public function idempotencyHash(string $key): string
    {
        $key = trim($key);
        if ($key === '' || strlen($key) > 512) {
            throw new EventSafetyException('event_safety_idempotency_key_invalid');
        }

        return hash('sha256', $key);
    }

    /** @param array<string|int,mixed> $value */
    public function requestHash(array $value): string
    {
        return hash('sha256', json_encode(
            $this->canonicalize($value),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        ));
    }

    public function exactTextHash(string $text): string
    {
        return hash('sha256', $text);
    }

    /** @return array<string,mixed> */
    public function eligibilityPolicyMetadata(): array
    {
        return [
            'schema_version' => self::POLICY_SCHEMA_VERSION,
            'active_named_user_required' => true,
            'bilateral_user_blocks' => 'deny',
            'unbound_guest_policy' => EventSafetyEligibilityDecision::UNBOUND_GUEST_POLICY,
            'safeguarding_interaction_channel' => 'event_participation',
            'safeguarding_policy_failure' => 'fail_closed',
            'minor_definition_source' => 'event_requirement',
        ];
    }

    public function encrypt(string $plaintext): string
    {
        return Crypt::encryptString($plaintext);
    }

    public function decrypt(string $ciphertext): string
    {
        try {
            return Crypt::decryptString($ciphertext);
        } catch (Throwable) {
            throw new EventSafetyException('event_safety_ciphertext_invalid');
        }
    }

    public function normalizeEmail(string $email): string
    {
        $normalized = mb_strtolower(trim($email));
        if (strlen($normalized) > 254
            || filter_var($normalized, FILTER_VALIDATE_EMAIL) === false) {
            throw new EventSafetyException('event_guardian_email_invalid');
        }

        return $normalized;
    }

    public function privacyHash(int $tenantId, string $context, string $value): string
    {
        return hash_hmac(
            'sha256',
            "event-safety|{$tenantId}|{$context}|{$value}",
            $this->applicationKey(),
        );
    }

    public function guardianToken(): string
    {
        return 'nxeg1_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    public function tokenHash(int $tenantId, string $token): string
    {
        $token = trim($token);
        if (preg_match('/^nxeg1_[A-Za-z0-9_-]{43}$/', $token) !== 1) {
            throw new EventSafetyException('event_guardian_token_invalid');
        }

        return $this->privacyHash($tenantId, 'guardian-token', $token);
    }

    /** @return array{start_utc:CarbonImmutable,timezone:string,local_date:string} */
    public function eventStartContext(Event $event): array
    {
        $timezone = trim((string) $event->getRawOriginal('timezone'));
        if ($timezone === '' || ! in_array($timezone, timezone_identifiers_list(), true)) {
            throw new EventSafetyException('event_safety_event_timezone_invalid');
        }
        $raw = $event->getRawOriginal('start_time');
        if (! is_string($raw) || trim($raw) === '') {
            throw new EventSafetyException('event_safety_event_start_invalid');
        }
        try {
            $start = CarbonImmutable::parse($raw, 'UTC')->utc();
        } catch (Throwable) {
            throw new EventSafetyException('event_safety_event_start_invalid');
        }

        return [
            'start_utc' => $start,
            'timezone' => $timezone,
            'local_date' => $start->setTimezone($timezone)->toDateString(),
        ];
    }

    public function ageOnLocalDate(string $dateOfBirth, string $localEventDate): int
    {
        $birth = DateTimeImmutable::createFromFormat('!Y-m-d', trim($dateOfBirth));
        $birthErrors = DateTimeImmutable::getLastErrors();
        $eventDate = DateTimeImmutable::createFromFormat('!Y-m-d', trim($localEventDate));
        $eventErrors = DateTimeImmutable::getLastErrors();
        if ($birth === false
            || $eventDate === false
            || (is_array($birthErrors)
                && (($birthErrors['warning_count'] ?? 0) > 0
                    || ($birthErrors['error_count'] ?? 0) > 0))
            || (is_array($eventErrors)
                && (($eventErrors['warning_count'] ?? 0) > 0
                    || ($eventErrors['error_count'] ?? 0) > 0))
            || $birth->format('Y-m-d') !== trim($dateOfBirth)
            || $eventDate->format('Y-m-d') !== trim($localEventDate)
            || $birth > $eventDate) {
            throw new EventSafetyException('event_safety_date_of_birth_invalid');
        }

        return $birth->diff($eventDate)->y;
    }

    private function applicationKey(): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new EventSafetyException('event_safety_encryption_key_missing');
        }
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            if ($decoded === false || $decoded === '') {
                throw new EventSafetyException('event_safety_encryption_key_invalid');
            }

            return $decoded;
        }

        return $key;
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            if ($value instanceof DateTimeInterface) {
                return CarbonImmutable::instance($value)->utc()->format('Y-m-d\TH:i:s.u\Z');
            }

            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value);
        }
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }
}
