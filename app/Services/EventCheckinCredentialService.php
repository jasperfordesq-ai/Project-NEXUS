<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventCheckinCredentialStatus;
use App\Exceptions\EventOfflineCheckinException;
use App\Models\Event;
use App\Models\EventCheckinCredential;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventCheckinCredentialIssueResult;
use App\Support\Events\EventCheckinSecurity;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use stdClass;
use App\Support\Authorization\ManagerDelegate;

/** Issuance and verification boundary for opaque, registration-scoped QR credentials. */
final class EventCheckinCredentialService
{
    public function __construct(
        private readonly ?EventCheckinCredentialSigner $signer = null,
        private readonly ?EventPolicy $policy = null,
    ) {
    }

    public function issue(
        int $eventId,
        int $registrationId,
        int $actorUserId,
        string $idempotencyKey,
        ?DateTimeInterface $expiresAt = null,
    ): EventCheckinCredentialIssueResult {
        $tenantId = $this->tenantId();
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $registrationId,
            $actorUserId,
            $idempotencyHash,
            $expiresAt,
        ): EventCheckinCredentialIssueResult {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $actor = $this->activeActor($tenantId, $actorUserId);
            $registration = $this->lockedConfirmedRegistration(
                $tenantId,
                $eventId,
                $registrationId,
            );
            $this->authorizeCredentialActor(
                $tenantId,
                $eventId,
                (int) $registration->user_id,
                $actor,
            );

            $replay = $this->credentialByIdempotency($tenantId, $idempotencyHash, true);
            if ($replay !== null) {
                $this->assertIssueReplay(
                    $replay,
                    $eventId,
                    $registrationId,
                    (int) $registration->user_id,
                    $actorUserId,
                    $expiresAt,
                );

                return new EventCheckinCredentialIssueResult(
                    $replay,
                    null,
                    false,
                    (int) $event->checkin_manifest_version,
                );
            }

            $now = CarbonImmutable::now('UTC');
            $expiry = $this->credentialExpiry($event, $expiresAt, $now);
            $active = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('registration_id', $registrationId)
                ->where('status', EventCheckinCredentialStatus::Active->value)
                ->lockForUpdate()
                ->first();
            if ($active !== null && $active->expires_at->isAfter($now)) {
                throw new EventOfflineCheckinException('event_qr_credential_active_exists');
            }
            if ($active !== null) {
                $this->markExpired($active, $now);
            }

            $version = ((int) EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('registration_id', $registrationId)
                ->max('credential_version')) + 1;
            $signed = $this->credentialSigner()->issue(
                $tenantId,
                $eventId,
                (string) $event->occurrence_key,
                $version,
                $now,
                $expiry,
            );
            $secret = $signed['token'];
            $verifier = EventCheckinSecurity::credentialVerifier($secret);

            try {
                $credentialId = (int) DB::table('event_checkin_credentials')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => (string) $event->occurrence_key,
                    'registration_id' => $registrationId,
                    'user_id' => (int) $registration->user_id,
                    'credential_version' => $version,
                    'status' => EventCheckinCredentialStatus::Active->value,
                    'active_slot' => 1,
                    'token_hash' => $verifier['hash'],
                    'token_fingerprint' => $verifier['fingerprint'],
                    'issue_idempotency_hash' => $idempotencyHash,
                    'issued_by_user_id' => $actorUserId,
                    'issued_at' => $now,
                    'expires_at' => $expiry,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } catch (QueryException $exception) {
                if ($this->isUniqueConflict($exception)) {
                    $replay = $this->credentialByIdempotency($tenantId, $idempotencyHash, true);
                    if ($replay !== null) {
                        $this->assertIssueReplay(
                            $replay,
                            $eventId,
                            $registrationId,
                            (int) $registration->user_id,
                            $actorUserId,
                            $expiresAt,
                        );

                        return new EventCheckinCredentialIssueResult(
                            $replay,
                            null,
                            false,
                            (int) $event->checkin_manifest_version,
                        );
                    }
                }

                throw $exception;
            }

            $manifestVersion = $this->bumpManifestVersion($tenantId, $eventId, $event);
            $credential = EventCheckinCredential::withoutGlobalScopes()->findOrFail($credentialId);

            return new EventCheckinCredentialIssueResult(
                $credential,
                $secret,
                true,
                $manifestVersion,
            );
        }, 3);
    }

    public function rotate(
        int $eventId,
        int $credentialId,
        int $actorUserId,
        int $expectedCredentialVersion,
        string $idempotencyKey,
        ?DateTimeInterface $expiresAt = null,
    ): EventCheckinCredentialIssueResult {
        $tenantId = $this->tenantId();
        $idempotencyHash = EventCheckinSecurity::idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $credentialId,
            $actorUserId,
            $expectedCredentialVersion,
            $idempotencyHash,
            $expiresAt,
        ): EventCheckinCredentialIssueResult {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $actor = $this->activeActor($tenantId, $actorUserId);
            $current = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($credentialId)
                ->lockForUpdate()
                ->first();
            if ($current === null) {
                throw new EventOfflineCheckinException('event_qr_credential_not_found');
            }
            $this->authorizeCredentialActor(
                $tenantId,
                $eventId,
                (int) $current->user_id,
                $actor,
            );

            $replay = $this->credentialByIdempotency($tenantId, $idempotencyHash, true);
            if ($replay !== null) {
                if ((int) $replay->registration_id !== (int) $current->registration_id
                    || (int) $replay->issued_by_user_id !== $actorUserId
                    || (int) $current->superseded_by_id !== (int) $replay->id
                    || (int) $current->credential_version !== $expectedCredentialVersion
                    || ($expiresAt !== null
                        && ! $replay->expires_at->equalTo(
                            CarbonImmutable::instance($expiresAt)->utc(),
                        ))) {
                    throw new EventOfflineCheckinException('event_qr_credential_idempotency_conflict');
                }

                return new EventCheckinCredentialIssueResult(
                    $replay,
                    null,
                    false,
                    (int) $event->checkin_manifest_version,
                );
            }
            if ((int) $current->credential_version !== $expectedCredentialVersion) {
                throw new EventOfflineCheckinException('event_qr_credential_version_conflict');
            }
            if ($current->status !== EventCheckinCredentialStatus::Active) {
                throw new EventOfflineCheckinException('event_qr_credential_not_active');
            }

            $registration = $this->lockedConfirmedRegistration(
                $tenantId,
                $eventId,
                (int) $current->registration_id,
            );
            if ((int) $registration->user_id !== (int) $current->user_id) {
                throw new EventOfflineCheckinException('event_qr_credential_registration_mismatch');
            }

            $now = CarbonImmutable::now('UTC');
            $expiry = $this->credentialExpiry($event, $expiresAt, $now);
            $signed = $this->credentialSigner()->issue(
                $tenantId,
                $eventId,
                (string) $event->occurrence_key,
                $expectedCredentialVersion + 1,
                $now,
                $expiry,
            );
            $secret = $signed['token'];
            $verifier = EventCheckinSecurity::credentialVerifier($secret);
            DB::table('event_checkin_credentials')
                ->where('tenant_id', $tenantId)
                ->where('id', $credentialId)
                ->update([
                    'status' => EventCheckinCredentialStatus::Rotated->value,
                    'active_slot' => null,
                    'rotated_at' => $now,
                    'updated_at' => $now,
                ]);

            $newId = (int) DB::table('event_checkin_credentials')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'occurrence_key' => (string) $event->occurrence_key,
                'registration_id' => (int) $current->registration_id,
                'user_id' => (int) $current->user_id,
                'credential_version' => $expectedCredentialVersion + 1,
                'status' => EventCheckinCredentialStatus::Active->value,
                'active_slot' => 1,
                'token_hash' => $verifier['hash'],
                'token_fingerprint' => $verifier['fingerprint'],
                'issue_idempotency_hash' => $idempotencyHash,
                'issued_by_user_id' => $actorUserId,
                'issued_at' => $now,
                'expires_at' => $expiry,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('event_checkin_credentials')
                ->where('tenant_id', $tenantId)
                ->where('id', $credentialId)
                ->update(['superseded_by_id' => $newId, 'updated_at' => $now]);

            $manifestVersion = $this->bumpManifestVersion($tenantId, $eventId, $event);
            $credential = EventCheckinCredential::withoutGlobalScopes()->findOrFail($newId);

            return new EventCheckinCredentialIssueResult(
                $credential,
                $secret,
                true,
                $manifestVersion,
            );
        }, 3);
    }

    public function revoke(
        int $eventId,
        int $credentialId,
        int $actorUserId,
        int $expectedCredentialVersion,
        string $reason,
    ): EventCheckinCredential {
        $tenantId = $this->tenantId();
        $reason = EventCheckinSecurity::sanitizedText($reason, 500, true);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $credentialId,
            $actorUserId,
            $expectedCredentialVersion,
            $reason,
        ): EventCheckinCredential {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $actor = $this->activeActor($tenantId, $actorUserId);
            $credential = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($credentialId)
                ->lockForUpdate()
                ->first();
            if ($credential === null) {
                throw new EventOfflineCheckinException('event_qr_credential_not_found');
            }
            $this->authorizeCredentialActor(
                $tenantId,
                $eventId,
                (int) $credential->user_id,
                $actor,
            );
            if ((int) $credential->credential_version !== $expectedCredentialVersion) {
                throw new EventOfflineCheckinException('event_qr_credential_version_conflict');
            }
            if ($credential->status === EventCheckinCredentialStatus::Revoked) {
                return $credential;
            }
            if ($credential->status !== EventCheckinCredentialStatus::Active) {
                throw new EventOfflineCheckinException('event_qr_credential_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            DB::table('event_checkin_credentials')
                ->where('tenant_id', $tenantId)
                ->where('id', $credentialId)
                ->update([
                    'status' => EventCheckinCredentialStatus::Revoked->value,
                    'active_slot' => null,
                    'revoked_by_user_id' => $actorUserId,
                    'revoked_at' => $now,
                    'revocation_reason' => $reason,
                    'updated_at' => $now,
                ]);
            $this->bumpManifestVersion($tenantId, $eventId, $event);

            return EventCheckinCredential::withoutGlobalScopes()->findOrFail($credentialId);
        }, 3);
    }

    public function expire(
        int $eventId,
        int $credentialId,
        int $expectedCredentialVersion,
    ): EventCheckinCredential {
        $tenantId = $this->tenantId();

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $credentialId,
            $expectedCredentialVersion,
        ): EventCheckinCredential {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $credential = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->whereKey($credentialId)
                ->lockForUpdate()
                ->first();
            if ($credential === null) {
                throw new EventOfflineCheckinException('event_qr_credential_not_found');
            }
            if ((int) $credential->credential_version !== $expectedCredentialVersion) {
                throw new EventOfflineCheckinException('event_qr_credential_version_conflict');
            }
            if ($credential->status === EventCheckinCredentialStatus::Expired) {
                return $credential;
            }
            if ($credential->status !== EventCheckinCredentialStatus::Active) {
                throw new EventOfflineCheckinException('event_qr_credential_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            if ($credential->expires_at->isAfter($now)) {
                throw new EventOfflineCheckinException('event_qr_credential_not_expired');
            }
            $this->markExpired($credential, $now);
            $this->bumpManifestVersion($tenantId, $eventId, $event);

            return EventCheckinCredential::withoutGlobalScopes()->findOrFail($credentialId);
        }, 3);
    }

    public function verify(int $eventId, string $secret): EventCheckinCredential
    {
        $tenantId = $this->tenantId();

        return DB::transaction(function () use ($tenantId, $eventId, $secret): EventCheckinCredential {
            $event = $this->lockedConcreteEvent($tenantId, $eventId);
            $claims = str_starts_with(trim($secret), 'nqx2_')
                ? $this->credentialSigner()->verify(
                    $secret,
                    $tenantId,
                    $eventId,
                    (string) $event->occurrence_key,
                )
                : null;
            $verifier = EventCheckinSecurity::credentialVerifier($secret);
            $credential = EventCheckinCredential::withoutGlobalScopes()
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('token_fingerprint', $verifier['fingerprint'])
                ->lockForUpdate()
                ->first();
            if ($credential === null
                || ! EventCheckinSecurity::matches((string) $credential->token_hash, $verifier['hash'])) {
                throw new EventOfflineCheckinException('event_qr_credential_invalid');
            }
            if ($credential->status !== EventCheckinCredentialStatus::Active) {
                throw new EventOfflineCheckinException('event_qr_credential_not_active');
            }

            $now = CarbonImmutable::now('UTC');
            if (! $credential->expires_at->isAfter($now)) {
                throw new EventOfflineCheckinException('event_qr_credential_expired');
            }
            if ($claims !== null
                && ((int) $credential->credential_version !== $claims['ver']
                    || $credential->expires_at->getTimestamp() !== $claims['exp'])) {
                throw new EventOfflineCheckinException('event_qr_credential_claims_mismatch');
            }
            $registration = $this->lockedConfirmedRegistration(
                $tenantId,
                $eventId,
                (int) $credential->registration_id,
            );
            if ((int) $registration->user_id !== (int) $credential->user_id) {
                throw new EventOfflineCheckinException('event_qr_credential_registration_mismatch');
            }

            return $credential;
        }, 3);
    }

    public function resolveHashReference(
        int $eventId,
        string $hash,
        string $fingerprint,
    ): ?EventCheckinCredential {
        $tenantId = $this->tenantId();
        $hash = EventCheckinSecurity::hashReference($hash, $fingerprint);
        $credential = EventCheckinCredential::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('token_fingerprint', strtolower($fingerprint))
            ->first();

        return $credential !== null
            && EventCheckinSecurity::matches((string) $credential->token_hash, $hash)
            ? $credential
            : null;
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
                'tenant_id',
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

    private function lockedConfirmedRegistration(
        int $tenantId,
        int $eventId,
        int $registrationId,
    ): stdClass {
        $registration = DB::table('event_registrations')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('id', $registrationId)
            ->lockForUpdate()
            ->first(['id', 'user_id', 'registration_state']);
        if ($registration === null) {
            throw new EventOfflineCheckinException('event_qr_registration_not_found');
        }
        if ((string) $registration->registration_state !== 'confirmed') {
            throw new EventOfflineCheckinException('event_qr_confirmed_registration_required');
        }

        return $registration;
    }

    private function activeActor(int $tenantId, int $actorUserId): User
    {
        $actor = $actorUserId > 0
            ? User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorUserId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->first()
            : null;
        if (! $actor instanceof User) {
            throw new EventOfflineCheckinException('event_checkin_actor_invalid');
        }

        return $actor;
    }

    private function authorizeCredentialActor(
        int $tenantId,
        int $eventId,
        int $attendeeUserId,
        User $actor,
    ): void {
        if ((int) $actor->getKey() === $attendeeUserId) {
            return;
        }
        /** @var Event|null $event */
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null
            || ! ($this->policy ?? new EventPolicy())->manageAttendance($actor, $event)) {
            throw new EventOfflineCheckinException('event_qr_credential_authorization_denied');
        }
    }

    private function credentialSigner(): EventCheckinCredentialSigner
    {
        return $this->signer ?? new EventCheckinCredentialSigner();
    }

    private function credentialExpiry(
        stdClass $event,
        ?DateTimeInterface $requested,
        CarbonImmutable $now,
    ): CarbonImmutable {
        $grace = max(0, (int) config('event_checkin.credential_offline_grace_minutes', 1440));
        $maximum = CarbonImmutable::parse((string) $event->end_time, 'UTC')->addMinutes($grace);
        $expiry = $requested === null
            ? $maximum
            : CarbonImmutable::instance($requested)->utc();
        if (! $expiry->isAfter($now) || $expiry->isAfter($maximum)) {
            throw new EventOfflineCheckinException('event_qr_credential_expiry_invalid');
        }

        return $expiry;
    }

    private function credentialByIdempotency(
        int $tenantId,
        string $idempotencyHash,
        bool $lock,
    ): ?EventCheckinCredential {
        $query = EventCheckinCredential::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('issue_idempotency_hash', $idempotencyHash);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private function assertIssueReplay(
        EventCheckinCredential $credential,
        int $eventId,
        int $registrationId,
        int $userId,
        int $actorUserId,
        ?DateTimeInterface $requestedExpiry,
    ): void {
        if ((int) $credential->event_id !== $eventId
            || (int) $credential->registration_id !== $registrationId
            || (int) $credential->user_id !== $userId
            || (int) $credential->issued_by_user_id !== $actorUserId
            || ($requestedExpiry !== null
                && ! $credential->expires_at->equalTo(
                    CarbonImmutable::instance($requestedExpiry)->utc(),
                ))) {
            throw new EventOfflineCheckinException('event_qr_credential_idempotency_conflict');
        }
    }

    private function markExpired(EventCheckinCredential $credential, CarbonImmutable $now): void
    {
        DB::table('event_checkin_credentials')
            ->where('tenant_id', (int) $credential->tenant_id)
            ->where('id', (int) $credential->id)
            ->update([
                'status' => EventCheckinCredentialStatus::Expired->value,
                'active_slot' => null,
                'expired_at' => $now,
                'updated_at' => $now,
            ]);
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

    private function isUniqueConflict(QueryException $exception): bool
    {
        $sqlState = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        return $sqlState === '23000' || $driverCode === 1062;
    }
}
