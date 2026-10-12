<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventCheckinDeviceStatus;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\Event;
use App\Models\EventCheckinDevice;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventCheckinDeviceRegistrationResult;
use App\Support\Events\EventCheckinSecurity;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use stdClass;
use App\Support\Authorization\ManagerDelegate;

/** Registration and revocation boundary for event-scoped offline staff devices. */
final class EventCheckinDeviceService
{
    public function __construct(private readonly ?EventPolicy $policy = null)
    {
    }

    public function register(
        int $eventId,
        int $actorUserId,
        string $label,
        string $idempotencyKey,
        ?DateTimeInterface $expiresAt = null,
    ): EventCheckinDeviceRegistrationResult {
        $tenantId = $this->tenantId();
        $label = EventCheckinSecurity::sanitizedText($label, 120, true);
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actorUserId,
            $label,
            $idempotencyHash,
            $expiresAt,
        ): EventCheckinDeviceRegistrationResult {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $this->authorizedStaff($tenantId, $eventId, $actorUserId);
            $replay = EventCheckinDevice::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('registration_idempotency_hash', $idempotencyHash)
                ->lockForUpdate()
                ->first();
            if ($replay !== null) {
                if ((int) $replay->event_id !== $eventId
                    || (int) $replay->registered_by_user_id !== $actorUserId
                    || (string) $replay->label !== $label) {
                    throw new EventOfflineCheckinException('event_checkin_device_idempotency_conflict');
                }

                return new EventCheckinDeviceRegistrationResult(
                    $replay,
                    null,
                    false,
                    (int) $event->checkin_manifest_version,
                );
            }

            $now = CarbonImmutable::now('UTC');
            $expiry = $this->deviceExpiry($event, $expiresAt, $now);
            $secret = EventCheckinSecurity::generateSecret('nxd1_');
            $verifier = EventCheckinSecurity::verifier($secret, 'nxd1_');
            $deviceId = (int) DB::table('event_checkin_devices')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->occurrence_key,
                'public_id' => (string) Str::uuid(),
                'label' => $label,
                'registered_by_user_id' => $actorUserId,
                'device_version' => 1,
                'status' => EventCheckinDeviceStatus::Active->value,
                'secret_hash' => $verifier['hash'],
                'secret_fingerprint' => $verifier['fingerprint'],
                'registration_idempotency_hash' => $idempotencyHash,
                'registered_at' => $now,
                'expires_at' => $expiry,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $manifestVersion = $this->bumpManifestVersion($tenantId, $eventId, $event);

            return new EventCheckinDeviceRegistrationResult(
                EventCheckinDevice::withoutGlobalScopes()->findOrFail($deviceId),
                $secret,
                true,
                $manifestVersion,
            );
        }, 3);
    }

    public function rotate(
        int $eventId,
        int $deviceId,
        int $actorUserId,
        int $expectedVersion,
        string $idempotencyKey,
        ?DateTimeInterface $expiresAt = null,
    ): EventCheckinDeviceRegistrationResult {
        $tenantId = $this->tenantId();
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $deviceId,
            $actorUserId,
            $expectedVersion,
            $idempotencyHash,
            $expiresAt,
        ): EventCheckinDeviceRegistrationResult {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $this->authorizedStaff($tenantId, $eventId, $actorUserId);
            $device = EventCheckinDevice::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();
            if ($device === null) {
                throw new EventOfflineCheckinException('event_checkin_device_not_found');
            }
            if ((int) $device->registered_by_user_id !== $actorUserId) {
                throw new EventOfflineCheckinException('event_checkin_device_actor_mismatch');
            }
            if ((string) $device->last_rotation_idempotency_hash === $idempotencyHash) {
                if ((int) $device->device_version !== $expectedVersion + 1
                    || ($expiresAt !== null
                        && ! $device->expires_at->equalTo(
                            CarbonImmutable::instance($expiresAt)->utc(),
                        ))) {
                    throw new EventOfflineCheckinException(
                        'event_checkin_device_idempotency_conflict',
                    );
                }

                return new EventCheckinDeviceRegistrationResult(
                    $device,
                    null,
                    false,
                    (int) $event->checkin_manifest_version,
                );
            }
            if ((int) $device->device_version !== $expectedVersion) {
                throw new EventOfflineCheckinException('event_checkin_device_version_conflict');
            }
            if ($device->status !== EventCheckinDeviceStatus::Active) {
                throw new EventOfflineCheckinException('event_checkin_device_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            $expiry = $this->deviceExpiry($event, $expiresAt, $now);
            $secret = EventCheckinSecurity::generateSecret('nxd1_');
            $verifier = EventCheckinSecurity::verifier($secret, 'nxd1_');
            DB::table('event_checkin_devices')
                ->where('tenant_id', $tenantId)
                ->where('id', $deviceId)
                ->update([
                    'device_version' => $expectedVersion + 1,
                    'secret_hash' => $verifier['hash'],
                    'secret_fingerprint' => $verifier['fingerprint'],
                    'last_rotation_idempotency_hash' => $idempotencyHash,
                    'rotated_at' => $now,
                    'expires_at' => $expiry,
                    'updated_at' => $now,
                ]);
            $manifestVersion = $this->bumpManifestVersion($tenantId, $eventId, $event);

            return new EventCheckinDeviceRegistrationResult(
                EventCheckinDevice::withoutGlobalScopes()->findOrFail($deviceId),
                $secret,
                true,
                $manifestVersion,
            );
        }, 3);
    }

    public function revoke(
        int $eventId,
        int $deviceId,
        int $actorUserId,
        int $expectedVersion,
        string $reason,
    ): EventCheckinDevice {
        $tenantId = $this->tenantId();
        $reason = EventCheckinSecurity::sanitizedText($reason, 500, true);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $deviceId,
            $actorUserId,
            $expectedVersion,
            $reason,
        ): EventCheckinDevice {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $this->authorizedStaff($tenantId, $eventId, $actorUserId);
            $device = EventCheckinDevice::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();
            if ($device === null) {
                throw new EventOfflineCheckinException('event_checkin_device_not_found');
            }
            if ($device->status === EventCheckinDeviceStatus::Revoked) {
                if ((int) $device->device_version !== $expectedVersion + 1) {
                    throw new EventOfflineCheckinException('event_checkin_device_version_conflict');
                }

                return $device;
            }
            if ((int) $device->device_version !== $expectedVersion) {
                throw new EventOfflineCheckinException('event_checkin_device_version_conflict');
            }
            if ($device->status !== EventCheckinDeviceStatus::Active) {
                throw new EventOfflineCheckinException('event_checkin_device_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            DB::table('event_checkin_devices')
                ->where('tenant_id', $tenantId)
                ->where('id', $deviceId)
                ->update([
                    'status' => EventCheckinDeviceStatus::Revoked->value,
                    'device_version' => $expectedVersion + 1,
                    'revoked_by_user_id' => $actorUserId,
                    'revoked_at' => $now,
                    'revocation_reason' => $reason,
                    'updated_at' => $now,
                ]);
            $this->bumpManifestVersion($tenantId, $eventId, $event);

            return EventCheckinDevice::withoutGlobalScopes()->findOrFail($deviceId);
        }, 3);
    }

    public function expire(
        int $eventId,
        int $deviceId,
        int $expectedVersion,
    ): EventCheckinDevice {
        $tenantId = $this->tenantId();

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $deviceId,
            $expectedVersion,
        ): EventCheckinDevice {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $device = EventCheckinDevice::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($deviceId)
                ->lockForUpdate()
                ->first();
            if ($device === null) {
                throw new EventOfflineCheckinException('event_checkin_device_not_found');
            }
            if ($device->status === EventCheckinDeviceStatus::Expired) {
                if ((int) $device->device_version !== $expectedVersion + 1) {
                    throw new EventOfflineCheckinException('event_checkin_device_version_conflict');
                }

                return $device;
            }
            if ((int) $device->device_version !== $expectedVersion) {
                throw new EventOfflineCheckinException('event_checkin_device_version_conflict');
            }
            if ($device->status !== EventCheckinDeviceStatus::Active) {
                throw new EventOfflineCheckinException('event_checkin_device_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            if ($device->expires_at->isAfter($now)) {
                throw new EventOfflineCheckinException('event_checkin_device_not_expired');
            }
            DB::table('event_checkin_devices')
                ->where('tenant_id', $tenantId)
                ->where('id', $deviceId)
                ->update([
                    'status' => EventCheckinDeviceStatus::Expired->value,
                    'device_version' => $expectedVersion + 1,
                    'expired_at' => $now,
                    'updated_at' => $now,
                ]);
            $this->bumpManifestVersion($tenantId, $eventId, $event);

            return EventCheckinDevice::withoutGlobalScopes()->findOrFail($deviceId);
        }, 3);
    }

    public function verify(
        int $eventId,
        string $secret,
        ?int $actorUserId = null,
    ): EventCheckinDevice {
        $tenantId = $this->tenantId();
        $verifier = EventCheckinSecurity::verifier($secret, 'nxd1_');

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actorUserId,
            $verifier,
        ): EventCheckinDevice {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $device = EventCheckinDevice::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('secret_fingerprint', $verifier['fingerprint'])
                ->lockForUpdate()
                ->first();
            if ($device === null
                || ! EventCheckinSecurity::matches((string) $device->secret_hash, $verifier['hash'])) {
                throw new EventOfflineCheckinException('event_checkin_device_invalid');
            }
            if ($actorUserId === null) {
                throw new EventOfflineCheckinException('event_checkin_device_actor_required');
            }
            $this->authorizedStaff($tenantId, $eventId, $actorUserId);
            if ((int) $device->registered_by_user_id !== $actorUserId) {
                throw new EventOfflineCheckinException('event_checkin_device_actor_mismatch');
            }
            if ($device->status !== EventCheckinDeviceStatus::Active) {
                throw new EventOfflineCheckinException('event_checkin_device_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            if (! $device->expires_at->isAfter($now)) {
                throw new EventOfflineCheckinException('event_checkin_device_expired');
            }

            return $device;
        }, 3);
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventOfflineCheckinException('event_checkin_tenant_context_missing');
        }

        return $tenantId;
    }

    private function lockedConcreteEvent(int $tenantId, int $eventId): stdClass
    {
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->lockForUpdate()
            ->first([
                'id',
                'occurrence_key',
                'is_recurring_template',
                'end_time',
                'checkin_manifest_version',
            ]);
        if ($event === null) {
            throw new EventOfflineCheckinException('event_checkin_event_not_found');
        }
        if ((bool) $event->is_recurring_template
            || ! is_string($event->occurrence_key)
            || trim($event->occurrence_key) === '') {
            throw new EventOfflineCheckinException('event_checkin_concrete_occurrence_required');
        }

        return $event;
    }

    private function authorizedStaff(int $tenantId, int $eventId, int $actorUserId): User
    {
        $actor = $actorUserId > 0
            ? User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorUserId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->first()
            : null;
        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if (! $actor instanceof User || $event === null
            || ! ($this->policy ?? new EventPolicy())->manageAttendance($actor, $event)) {
            throw new EventOfflineCheckinException('event_checkin_actor_invalid');
        }

        return $actor;
    }

    private function deviceExpiry(
        stdClass $event,
        ?DateTimeInterface $requested,
        CarbonImmutable $now,
    ): CarbonImmutable {
        $defaultTtl = max(1, (int) config('event_checkin.device_ttl_minutes', 720));
        $maximumTtl = max($defaultTtl, (int) config('event_checkin.device_max_ttl_minutes', 4320));
        $eventGrace = max(0, (int) config('event_checkin.credential_offline_grace_minutes', 1440));
        $maximum = $now->addMinutes($maximumTtl)->min(
            CarbonImmutable::parse((string) $event->end_time, 'UTC')->addMinutes($eventGrace),
        );
        $expiry = $requested === null
            ? $now->addMinutes($defaultTtl)->min($maximum)
            : CarbonImmutable::instance($requested)->utc();
        if (! $expiry->isAfter($now) || $expiry->isAfter($maximum)) {
            throw new EventOfflineCheckinException('event_checkin_device_expiry_invalid');
        }

        return $expiry;
    }

    private function bumpManifestVersion(
        int $tenantId,
        int $eventId,
        stdClass $event,
    ): int {
        $next = (int) $event->checkin_manifest_version + 1;
        $updated = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->where('checkin_manifest_version', (int) $event->checkin_manifest_version)
            ->update([
                'checkin_manifest_version' => $next,
                'updated_at' => now(),
            ]);
        if ($updated !== 1) {
            throw new EventOfflineCheckinException('event_checkin_manifest_version_conflict');
        }
        $event->checkin_manifest_version = $next;

        return $next;
    }
}
