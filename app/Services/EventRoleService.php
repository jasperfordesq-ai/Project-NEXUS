<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventStaffAssignmentStatus;
use App\Enums\EventStaffCapability;
use App\Enums\EventStaffRole;
use App\Exceptions\EventRoleAssignmentException;
use App\Models\EventStaffAssignment;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Transactional write and capability boundary for delegated event staff. */
final class EventRoleService
{
    /** @var list<EventStaffRole> */
    private const DELEGATABLE_BY_STAFF_MANAGER = [
        EventStaffRole::RegistrationManager,
        EventStaffRole::CommunicationsManager,
        EventStaffRole::CheckInStaff,
    ];

    private readonly EventDomainOutboxService $outbox;

    public function __construct(?EventDomainOutboxService $outbox = null)
    {
        $this->outbox = $outbox ?? new EventDomainOutboxService();
    }

    /** @return array<string,list<string>> */
    public static function capabilityMap(): array
    {
        $map = [];
        foreach (EventStaffRole::cases() as $role) {
            $map[$role->value] = array_map(
                static fn (EventStaffCapability $capability): string => $capability->value,
                $role->capabilities(),
            );
        }

        return $map;
    }

    /**
     * @return Collection<int,EventStaffAssignment>
     */
    public function list(int $eventId, User $actor, bool $includeInactive = false): Collection
    {
        if (!$this->schemaAvailable()) {
            return collect();
        }

        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $this->authorizeEventManager($tenantId, $eventId, $actor, false);

        return EventStaffAssignment::withoutGlobalScopes()
            ->with([
                'user:id,tenant_id,first_name,last_name,profile_type,organization_name,avatar_url',
                'history',
            ])
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->when(!$includeInactive, static function ($query): void {
                $query->where('status', EventStaffAssignmentStatus::Active->value)
                    ->where(static function ($expiry): void {
                        $expiry->whereNull('expires_at')->orWhere('expires_at', '>', now());
                    });
            })
            ->orderBy('role')
            ->orderBy('user_id')
            ->orderBy('id')
            ->get();
    }

    public function find(int $eventId, int $assignmentId, User $actor): ?EventStaffAssignment
    {
        if (! $this->schemaAvailable()) {
            return null;
        }

        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $this->authorizeEventManager($tenantId, $eventId, $actor, false);

        return EventStaffAssignment::withoutGlobalScopes()
            ->with([
                'user:id,tenant_id,first_name,last_name,profile_type,organization_name,avatar_url',
                'history',
            ])
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->whereKey($assignmentId)
            ->first();
    }

    /**
     * @return array{assignment:EventStaffAssignment,changed:bool,history_id:?int,outbox_id:?int}
     */
    public function grant(
        int $eventId,
        int $userId,
        EventStaffRole $role,
        User $actor,
        ?DateTimeInterface $expiresAt = null,
        ?string $idempotencyKey = null,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $expiry = $this->normalizeFutureExpiry($expiresAt);
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $role,
            $actor,
            $expiry,
            $idempotencyKey,
        ): array {
            [$event, $persistedActor, $target] = $this->lockMutationSubjects(
                $tenantId,
                $eventId,
                $actor,
                $userId,
            );
            $this->assertCanManageRole($tenantId, $event, $persistedActor, $role);
            if ((int) $event->user_id === (int) $target->id) {
                throw new EventRoleAssignmentException('event_staff_role_owner_implicit');
            }

            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                $userId,
                $role,
                (int) $persistedActor->id,
                'granted',
                $expiry,
                $idempotencyKey,
            );
            if ($replay !== null) {
                return $replay;
            }

            $assignment = DB::table('event_staff_assignments')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('role', $role->value)
                ->lockForUpdate()
                ->first();

            if ($assignment !== null
                && (string) $assignment->status === EventStaffAssignmentStatus::Active->value
                && $this->sameTimestamp($assignment->expires_at, $expiry)) {
                return $this->result((int) $assignment->id, false, null, null);
            }

            $now = now();
            $previousStatus = $assignment === null ? null : (string) $assignment->status;
            $previousExpiry = $assignment->expires_at ?? null;
            $version = $assignment === null
                ? 1
                : $this->nextVersion($assignment->assignment_version);

            if ($assignment === null) {
                $assignmentId = (int) DB::table('event_staff_assignments')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'user_id' => $userId,
                    'role' => $role->value,
                    'status' => EventStaffAssignmentStatus::Active->value,
                    'assignment_version' => $version,
                    'granted_at' => $now,
                    'granted_by' => (int) $persistedActor->id,
                    'revoked_at' => null,
                    'revoked_by' => null,
                    'expires_at' => $expiry,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                $assignmentId = (int) $assignment->id;
                $updated = DB::table('event_staff_assignments')
                    ->where('id', $assignmentId)
                    ->where('tenant_id', $tenantId)
                    ->where('assignment_version', (int) $assignment->assignment_version)
                    ->update([
                        'status' => EventStaffAssignmentStatus::Active->value,
                        'assignment_version' => $version,
                        'granted_at' => $now,
                        'granted_by' => (int) $persistedActor->id,
                        'revoked_at' => null,
                        'revoked_by' => null,
                        'expires_at' => $expiry,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventRoleAssignmentException('event_staff_role_concurrent_write_failed');
                }
            }

            [$historyId, $outboxId] = $this->recordMutation(
                $tenantId,
                $eventId,
                $assignmentId,
                $userId,
                $role,
                (int) $persistedActor->id,
                $version,
                'granted',
                $previousStatus,
                EventStaffAssignmentStatus::Active->value,
                $previousExpiry,
                $expiry,
                $idempotencyKey,
                $now,
            );

            return $this->result($assignmentId, true, $historyId, $outboxId);
        }, 3);
    }

    /**
     * @return array{assignment:?EventStaffAssignment,changed:bool,history_id:?int,outbox_id:?int}
     */
    public function revoke(
        int $eventId,
        int $userId,
        EventStaffRole $role,
        User $actor,
        ?string $idempotencyKey = null,
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantIdOrFail();
        $this->assertFeatureEnabled();
        $idempotencyKey = $this->normalizeIdempotencyKey($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $userId,
            $role,
            $actor,
            $idempotencyKey,
        ): array {
            [$event, $persistedActor] = $this->lockMutationSubjects(
                $tenantId,
                $eventId,
                $actor,
                $userId,
            );
            $this->assertCanManageRole($tenantId, $event, $persistedActor, $role);

            $replay = $this->idempotentReplay(
                $tenantId,
                $eventId,
                $userId,
                $role,
                (int) $persistedActor->id,
                'revoked',
                null,
                $idempotencyKey,
            );
            if ($replay !== null) {
                return $replay;
            }

            $assignment = DB::table('event_staff_assignments')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('user_id', $userId)
                ->where('role', $role->value)
                ->lockForUpdate()
                ->first();
            if ($assignment === null) {
                return [
                    'assignment' => null,
                    'changed' => false,
                    'history_id' => null,
                    'outbox_id' => null,
                ];
            }
            if ((string) $assignment->status === EventStaffAssignmentStatus::Revoked->value) {
                return $this->result((int) $assignment->id, false, null, null);
            }

            $version = $this->nextVersion($assignment->assignment_version);
            $now = now();
            $updated = DB::table('event_staff_assignments')
                ->where('id', (int) $assignment->id)
                ->where('tenant_id', $tenantId)
                ->where('assignment_version', (int) $assignment->assignment_version)
                ->update([
                    'status' => EventStaffAssignmentStatus::Revoked->value,
                    'assignment_version' => $version,
                    'revoked_at' => $now,
                    'revoked_by' => (int) $persistedActor->id,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventRoleAssignmentException('event_staff_role_concurrent_write_failed');
            }

            [$historyId, $outboxId] = $this->recordMutation(
                $tenantId,
                $eventId,
                (int) $assignment->id,
                $userId,
                $role,
                (int) $persistedActor->id,
                $version,
                'revoked',
                (string) $assignment->status,
                EventStaffAssignmentStatus::Revoked->value,
                $assignment->expires_at,
                $this->parseNullableTimestamp($assignment->expires_at),
                $idempotencyKey,
                $now,
            );

            return $this->result((int) $assignment->id, true, $historyId, $outboxId);
        }, 3);
    }

    /** @return list<EventStaffCapability> */
    public function capabilitiesForUser(int $eventId, int $userId): array
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0 || $eventId <= 0 || $userId <= 0
            || !$this->schemaAvailable()) {
            return [];
        }
        try {
            if (!TenantContext::hasFeature('events')) {
                return [];
            }
        } catch (\Throwable) {
            return [];
        }

        $eventExists = DB::table('events')
            ->where('id', $eventId)
            ->where('tenant_id', $tenantId)
            ->exists();
        $userExists = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists();
        if (!$eventExists || !$userExists) {
            return [];
        }

        $roles = DB::table('event_staff_assignments')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('status', EventStaffAssignmentStatus::Active->value)
            ->where(static function ($query): void {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('role');

        $granted = [];
        foreach ($roles as $storedRole) {
            $role = EventStaffRole::tryFrom((string) $storedRole);
            if ($role === null) {
                continue;
            }
            foreach ($role->capabilities() as $capability) {
                $granted[$capability->value] = true;
            }
        }

        return array_values(array_filter(
            EventStaffCapability::cases(),
            static fn (EventStaffCapability $capability): bool => isset($granted[$capability->value]),
        ));
    }

    public function hasCapability(
        int $eventId,
        int $userId,
        EventStaffCapability $capability,
    ): bool {
        return in_array($capability, $this->capabilitiesForUser($eventId, $userId), true);
    }

    /**
     * @return array{0:object,1:object,2:object}
     */
    private function lockMutationSubjects(
        int $tenantId,
        int $eventId,
        User $actor,
        int $targetUserId,
    ): array {
        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->lockForUpdate()
            ->first(['id', 'tenant_id', 'user_id']);
        if ($event === null) {
            throw new EventRoleAssignmentException('event_staff_role_event_not_found');
        }

        $actorId = (int) $actor->getKey();
        $userIds = array_values(array_unique([$actorId, $targetUserId]));
        sort($userIds, SORT_NUMERIC);
        $users = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $userIds)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->orderBy('id')
            ->lockForUpdate()
            ->get([
                'id',
                'tenant_id',
                'role',
                'is_admin',
                'is_super_admin',
                'is_tenant_super_admin',
                'is_god',
            ])
            ->keyBy('id');

        $persistedActor = $users->get($actorId);
        if ($persistedActor === null) {
            throw new EventRoleAssignmentException('event_staff_role_actor_invalid');
        }
        $target = $users->get($targetUserId);
        if ($target === null) {
            throw new EventRoleAssignmentException('event_staff_role_target_invalid');
        }

        return [$event, $persistedActor, $target];
    }

    private function authorizeEventManager(
        int $tenantId,
        int $eventId,
        User $actor,
        bool $lock,
    ): void {
        $eventQuery = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId);
        if ($lock) {
            $eventQuery->lockForUpdate();
        }
        $event = $eventQuery->first(['id', 'tenant_id', 'user_id']);
        if ($event === null) {
            throw new EventRoleAssignmentException('event_staff_role_event_not_found');
        }

        $actorRow = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first([
                'id',
                'role',
                'is_admin',
                'is_super_admin',
                'is_tenant_super_admin',
                'is_god',
            ]);
        if ($actorRow === null) {
            throw new EventRoleAssignmentException('event_staff_role_actor_invalid');
        }

        $this->assertStaffManager($tenantId, $event, $actorRow);
    }

    private function assertStaffManager(int $tenantId, object $event, object $actor): void
    {
        if ($this->hasImplicitFullAuthority($event, $actor)
            || $this->hasPersistedCapability(
                $tenantId,
                (int) $event->id,
                (int) $actor->id,
                EventStaffCapability::ManageStaff,
            )) {
            return;
        }

        throw new EventRoleAssignmentException('event_staff_role_authorization_denied');
    }

    private function assertCanManageRole(
        int $tenantId,
        object $event,
        object $actor,
        EventStaffRole $role,
    ): void {
        if ($this->hasImplicitFullAuthority($event, $actor)) {
            return;
        }

        if (! $this->hasPersistedCapability(
            $tenantId,
            (int) $event->id,
            (int) $actor->id,
            EventStaffCapability::ManageStaff,
        )) {
            throw new EventRoleAssignmentException('event_staff_role_authorization_denied');
        }

        if (! in_array($role, self::DELEGATABLE_BY_STAFF_MANAGER, true)) {
            throw new EventRoleAssignmentException('event_staff_role_privilege_escalation_denied');
        }
    }

    private function hasImplicitFullAuthority(object $event, object $actor): bool
    {
        return (int) $event->user_id === (int) $actor->id || $this->isTenantAdmin($actor);
    }

    private function hasPersistedCapability(
        int $tenantId,
        int $eventId,
        int $userId,
        EventStaffCapability $capability,
    ): bool {
        $roles = DB::table('event_staff_assignments')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('user_id', $userId)
            ->where('status', EventStaffAssignmentStatus::Active->value)
            ->where(static function ($query): void {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('role');

        foreach ($roles as $storedRole) {
            $role = EventStaffRole::tryFrom((string) $storedRole);
            if ($role?->grants($capability) === true) {
                return true;
            }
        }

        return false;
    }

    private function isTenantAdmin(object $actor): bool
    {
        return AdminTier::allows($actor);
    }

    /**
     * @return array{assignment:EventStaffAssignment,changed:bool,history_id:?int,outbox_id:?int}|null
     */
    private function idempotentReplay(
        int $tenantId,
        int $eventId,
        int $userId,
        EventStaffRole $role,
        int $actorId,
        string $action,
        ?DateTimeInterface $expiresAt,
        ?string $idempotencyKey,
    ): ?array {
        if ($idempotencyKey === null) {
            return null;
        }

        $history = DB::table('event_staff_assignment_history')
            ->where('tenant_id', $tenantId)
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($history === null) {
            return null;
        }

        $sameOperation = (int) $history->event_id === $eventId
            && (int) $history->user_id === $userId
            && (string) $history->role === $role->value
            && (int) $history->actor_user_id === $actorId
            && (string) $history->action === $action;
        if ($action === 'granted') {
            $sameOperation = $sameOperation
                && $this->sameTimestamp($history->new_expires_at, $expiresAt);
        }

        if (! $sameOperation) {
            throw new EventRoleAssignmentException('event_staff_role_idempotency_conflict');
        }

        return $this->result(
            (int) $history->assignment_id,
            false,
            (int) $history->id,
            null,
        );
    }

    /**
     * @return array{0:int,1:int}
     */
    private function recordMutation(
        int $tenantId,
        int $eventId,
        int $assignmentId,
        int $userId,
        EventStaffRole $role,
        int $actorId,
        int $version,
        string $action,
        ?string $fromStatus,
        string $toStatus,
        mixed $previousExpiry,
        ?DateTimeInterface $newExpiry,
        ?string $idempotencyKey,
        DateTimeInterface $occurredAt,
    ): array {
        $metadata = [
            'schema_version' => 1,
            'source' => 'event_role_service',
            'idempotency_key' => $idempotencyKey,
        ];
        $historyId = (int) DB::table('event_staff_assignment_history')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'assignment_id' => $assignmentId,
            'user_id' => $userId,
            'role' => $role->value,
            'actor_user_id' => $actorId,
            'assignment_version' => $version,
            'action' => $action,
            'idempotency_key' => $idempotencyKey,
            'from_status' => $fromStatus,
            'to_status' => $toStatus,
            'previous_expires_at' => $previousExpiry,
            'new_expires_at' => $newExpiry,
            'metadata' => json_encode($metadata, JSON_THROW_ON_ERROR),
            'created_at' => $occurredAt,
        ]);

        $outboxAction = 'event.staff_role.' . $action;
        $outbox = $this->outbox->record(
            $tenantId,
            $eventId,
            $version,
            $outboxAction,
            "event:{$tenantId}:{$eventId}:staff:{$assignmentId}:v{$version}",
            [
                'schema_version' => 1,
                'tenant_id' => $tenantId,
                'event_id' => $eventId,
                'assignment_id' => $assignmentId,
                'assignment_version' => $version,
                'user_id' => $userId,
                'role' => $role->value,
                'action' => $action,
                'from_status' => $fromStatus,
                'to_status' => $toStatus,
                'expires_at' => $newExpiry?->format(DATE_ATOM),
                'actor_user_id' => $actorId,
                'metadata' => $metadata,
                'occurred_at' => $occurredAt->format(DATE_ATOM),
            ],
        );

        return [$historyId, (int) $outbox['id']];
    }

    /**
     * @return array{assignment:EventStaffAssignment,changed:bool,history_id:?int,outbox_id:?int}
     */
    private function result(
        int $assignmentId,
        bool $changed,
        ?int $historyId,
        ?int $outboxId,
    ): array {
        $assignment = EventStaffAssignment::withoutGlobalScopes()->find($assignmentId);
        if ($assignment === null) {
            throw new EventRoleAssignmentException('event_staff_role_persistence_failed');
        }
        $assignment->load([
            'user:id,tenant_id,first_name,last_name,profile_type,organization_name,avatar_url',
            'history',
        ]);

        return [
            'assignment' => $assignment,
            'changed' => $changed,
            'history_id' => $historyId,
            'outbox_id' => $outboxId,
        ];
    }

    private function tenantIdOrFail(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventRoleAssignmentException('event_staff_role_tenant_context_missing');
        }

        return $tenantId;
    }

    private function assertFeatureEnabled(): void
    {
        try {
            if (TenantContext::hasFeature('events')) {
                return;
            }
        } catch (\Throwable) {
            // Fail closed below.
        }

        throw new EventRoleAssignmentException('event_staff_role_feature_disabled');
    }

    private function assertSchemaAvailable(): void
    {
        if (!$this->schemaAvailable()) {
            throw new EventRoleAssignmentException('event_staff_role_schema_unavailable');
        }
    }

    private function schemaAvailable(): bool
    {
        return Schema::hasTable('event_staff_assignments')
            && Schema::hasTable('event_staff_assignment_history')
            && Schema::hasTable('event_domain_outbox');
    }

    private function normalizeFutureExpiry(?DateTimeInterface $expiresAt): ?CarbonImmutable
    {
        if ($expiresAt === null) {
            return null;
        }

        $expiry = CarbonImmutable::instance($expiresAt)->utc()->startOfSecond();
        if (!$expiry->isFuture()) {
            throw new EventRoleAssignmentException('event_staff_role_expiry_not_future');
        }

        return $expiry;
    }

    private function normalizeIdempotencyKey(?string $idempotencyKey): ?string
    {
        if ($idempotencyKey === null) {
            return null;
        }

        $normalized = trim($idempotencyKey);
        if ($normalized === '' || mb_strlen($normalized) > 191) {
            throw new EventRoleAssignmentException('event_staff_role_idempotency_key_invalid');
        }

        return $normalized;
    }

    private function sameTimestamp(mixed $stored, ?DateTimeInterface $candidate): bool
    {
        if ($stored === null || $stored === '') {
            return $candidate === null;
        }
        if ($candidate === null) {
            return false;
        }

        return CarbonImmutable::parse((string) $stored, 'UTC')->equalTo($candidate);
    }

    private function parseNullableTimestamp(mixed $stored): ?CarbonImmutable
    {
        if ($stored === null || $stored === '') {
            return null;
        }

        return CarbonImmutable::parse((string) $stored, 'UTC');
    }

    private function nextVersion(mixed $current): int
    {
        if (!is_numeric($current) || (int) $current < 1) {
            throw new EventRoleAssignmentException('event_staff_role_version_invalid');
        }

        return (int) $current + 1;
    }
}
