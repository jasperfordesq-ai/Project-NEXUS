<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Core\TenantContext;
use App\Exceptions\EventRegistrationFoundationException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\Crypt;
use Throwable;
use App\Support\Authorization\CrossTenantEntry;
use App\Support\Authorization\ManagerDelegate;

/** Shared fail-closed primitives for the isolated registration foundation. */
final class EventRegistrationFoundationSupport
{
    private readonly EventPolicy $policy;

    public function __construct(?EventPolicy $policy = null)
    {
        $this->policy = $policy ?? new EventPolicy();
    }

    public function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventRegistrationFoundationException('event_registration_tenant_context_required');
        }

        return $tenantId;
    }

    public function actor(int $tenantId, User|int $actor, bool $lock = false): User
    {
        $actorId = $actor instanceof User ? (int) $actor->getKey() : $actor;
        $query = User::withoutGlobalScopes()
            ->whereKey($actorId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $persisted = $query->first();
        // A member of this community acts as itself (unchanged). A delegate
        // acts only while usable. A manager from another community whose
        // crossing the door admitted acts as its delegate here, so the
        // record names an account of THIS community (owner, 12 Oct 2026,
        // option 3). Outside an HTTP request no crossing is ever admitted.
        if ($persisted !== null && (int) $persisted->tenant_id !== $tenantId) {
            $persisted = CrossTenantEntry::activeActor((int) $persisted->getKey(), $tenantId, $lock);
        } elseif ($persisted !== null && ManagerDelegate::isDelegate($persisted)
            && ! ManagerDelegate::isUsable($persisted, $tenantId)) {
            $persisted = null;
        }
        if ($persisted === null) {
            throw new EventRegistrationFoundationException('event_registration_actor_not_found');
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
            throw new EventRegistrationFoundationException('event_registration_event_not_found');
        }
        if ((bool) $event->getRawOriginal('is_recurring_template')
            || trim((string) $event->getRawOriginal('occurrence_key')) === '') {
            throw new EventRegistrationFoundationException('event_registration_concrete_occurrence_required');
        }

        return $event;
    }

    public function authorizeManager(User $actor, Event $event): void
    {
        if (! $this->policy->manageRegistration($actor, $event)) {
            throw new EventRegistrationFoundationException('event_registration_authorization_denied');
        }
    }

    public function eventTimezone(Event $event): string
    {
        $timezone = trim((string) ($event->getRawOriginal('timezone') ?: 'UTC'));
        if (! in_array($timezone, timezone_identifiers_list(), true)) {
            throw new EventRegistrationFoundationException('event_registration_event_timezone_invalid');
        }

        return $timezone;
    }

    public function eventStart(Event $event): CarbonImmutable
    {
        return $this->storedInstant($event->getRawOriginal('start_time'), 'event_registration_event_start_invalid');
    }

    public function eventEnd(Event $event): CarbonImmutable
    {
        return $this->storedInstant($event->getRawOriginal('end_time'), 'event_registration_event_end_invalid');
    }

    public function inputInstant(
        mixed $value,
        string $timezone,
        string $reason,
    ): ?CarbonImmutable {
        if ($value === null || $value === '') {
            return null;
        }
        if (! $value instanceof DateTimeInterface
            && (! is_string($value)
                || preg_match(
                    '/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/',
                    trim($value),
                ) !== 1)) {
            throw new EventRegistrationFoundationException($reason);
        }

        try {
            $instant = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse(trim($value));
        } catch (Throwable) {
            throw new EventRegistrationFoundationException($reason);
        }
        if ($instant->getOffset() !== $instant->setTimezone($timezone)->getOffset()) {
            throw new EventRegistrationFoundationException('event_registration_timezone_offset_mismatch');
        }

        return $instant->utc();
    }

    public function idempotencyHash(string $key): string
    {
        $key = trim($key);
        if ($key === '' || strlen($key) > 512) {
            throw new EventRegistrationFoundationException('event_registration_idempotency_key_invalid');
        }

        return hash('sha256', $key);
    }

    /** @param array<string|int,mixed> $payload */
    public function requestHash(array $payload): string
    {
        return hash('sha256', json_encode(
            $this->canonicalize($payload),
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        ));
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
            throw new EventRegistrationFoundationException('event_registration_ciphertext_invalid');
        }
    }

    public function normalizeEmail(string $email): string
    {
        $email = mb_strtolower(trim($email));
        if (strlen($email) > 254 || filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new EventRegistrationFoundationException('event_invitation_email_invalid');
        }

        return $email;
    }

    public function emailBlindHash(int $tenantId, string $email): string
    {
        return hash_hmac(
            'sha256',
            "event-invitation|{$tenantId}|" . $this->normalizeEmail($email),
            $this->applicationKey(),
        );
    }

    public function privacyHash(string $context, string $value): string
    {
        return hash_hmac('sha256', $context . '|' . $value, $this->applicationKey());
    }

    public function tokenHash(int $tenantId, int $eventId, string $token): string
    {
        return hash_hmac(
            'sha256',
            "event-invitation|{$tenantId}|{$eventId}|{$token}",
            $this->applicationKey(),
        );
    }

    public function token(): string
    {
        return 'nxi1_' . rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }

    private function storedInstant(mixed $value, string $reason): CarbonImmutable
    {
        if (! is_string($value) || trim($value) === '') {
            throw new EventRegistrationFoundationException($reason);
        }
        try {
            return CarbonImmutable::parse($value, 'UTC')->utc();
        } catch (Throwable) {
            throw new EventRegistrationFoundationException($reason);
        }
    }

    private function applicationKey(): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new EventRegistrationFoundationException('event_registration_encryption_key_missing');
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
