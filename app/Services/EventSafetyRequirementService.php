<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventSafetyRequirementAction;
use App\Enums\EventSafetyRequirementStatus;
use App\Exceptions\EventSafetyException;
use App\Models\EventSafetyRequirement;
use App\Models\EventSafetyRequirementHistory;
use App\Models\EventSafetyRequirementVersion;
use App\Models\User;
use App\Support\Events\EventSafetyFoundationSupport;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Optimistically versioned safety policy for one concrete event occurrence. */
final class EventSafetyRequirementService
{
    private const FIELDS = [
        'minimum_age',
        'guardian_consent_required',
        'minor_age_threshold',
        'code_of_conduct_required',
        'code_of_conduct_text',
        'code_of_conduct_text_version',
    ];

    public function __construct(
        private readonly EventSafetyFoundationSupport $support = new EventSafetyFoundationSupport(),
    ) {
    }

    /**
     * @param array<string,mixed> $attributes
     * @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion,changed:bool}
     */
    public function saveDraft(
        int $eventId,
        User|int $actor,
        array $attributes,
        ?int $expectedRevision,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $normalized = $this->normalize($attributes);
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $normalized,
            $expectedRevision,
            $idempotencyHash,
        ): array {
            $event = $this->support->concreteEvent($tenantId, $eventId, true);
            $persistedActor = $this->support->activeUser(
                $tenantId,
                $actor,
                true,
                'event_safety_actor_not_active',
            );
            $this->support->authorizeManager($persistedActor, $event);
            $requirements = $this->requirements($tenantId, $eventId, true, false);
            $requestHash = $this->support->requestHash([
                'action' => EventSafetyRequirementAction::Saved->value,
                'event_id' => $eventId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'configuration' => $normalized,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                EventSafetyRequirementAction::Saved,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return $this->saveResultFromHistory($tenantId, $replay);
            }

            $now = CarbonImmutable::now('UTC');
            if ($requirements === null) {
                if ($expectedRevision !== null && $expectedRevision !== 0) {
                    throw new EventSafetyException('event_safety_requirements_revision_conflict');
                }
                $revision = 1;
                $versionNumber = 1;
                $requirementsId = (int) DB::table('event_safety_requirements')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => (string) $event->getRawOriginal('occurrence_key'),
                    'revision' => $revision,
                    'current_version' => $versionNumber,
                    'published_version' => null,
                    'status' => EventSafetyRequirementStatus::Draft->value,
                    'created_by_user_id' => (int) $persistedActor->id,
                    'updated_by_user_id' => (int) $persistedActor->id,
                    'published_by_user_id' => null,
                    'published_at' => null,
                    'archived_by_user_id' => null,
                    'archived_at' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            } else {
                if ((string) $requirements->getRawOriginal('status')
                    === EventSafetyRequirementStatus::Archived->value) {
                    throw new EventSafetyException('event_safety_requirements_archived');
                }
                if ($expectedRevision === null
                    || $expectedRevision !== (int) $requirements->revision) {
                    throw new EventSafetyException('event_safety_requirements_revision_conflict');
                }
                $revision = $expectedRevision + 1;
                $versionNumber = (int) $requirements->current_version + 1;
                $requirementsId = (int) $requirements->id;
                $updated = DB::table('event_safety_requirements')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $eventId)
                    ->where('revision', $expectedRevision)
                    ->where('status', '<>', EventSafetyRequirementStatus::Archived->value)
                    ->update([
                        'revision' => $revision,
                        'current_version' => $versionNumber,
                        'published_version' => null,
                        'status' => EventSafetyRequirementStatus::Draft->value,
                        'updated_by_user_id' => (int) $persistedActor->id,
                        'published_by_user_id' => null,
                        'published_at' => null,
                        'archived_by_user_id' => null,
                        'archived_at' => null,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventSafetyException('event_safety_requirements_revision_conflict');
                }
            }

            $versionId = $this->insertVersion(
                $tenantId,
                $eventId,
                $requirementsId,
                $versionNumber,
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                $normalized,
                $now,
            );
            $this->insertHistory(
                $tenantId,
                $eventId,
                $requirementsId,
                $revision,
                $versionId,
                $versionNumber,
                EventSafetyRequirementAction::Saved,
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                [
                    'code_of_conduct_hash' => $normalized['code_of_conduct_text_hash'],
                    'eligibility_policy_hash' => $normalized['eligibility_policy_hash'],
                ],
                $now,
            );

            return [
                'requirements' => $this->requirementsModel($tenantId, $requirementsId),
                'version' => $this->versionModel($tenantId, $versionId),
                'changed' => true,
            ];
        }, 3);
    }

    /** @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion,changed:bool} */
    public function publish(
        int $eventId,
        User|int $actor,
        int $expectedRevision,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        return $this->transition(
            $eventId,
            $actor,
            $expectedRevision,
            $expectedVersion,
            EventSafetyRequirementAction::Published,
            $idempotencyKey,
        );
    }

    /** @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion,changed:bool} */
    public function archive(
        int $eventId,
        User|int $actor,
        int $expectedRevision,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        return $this->transition(
            $eventId,
            $actor,
            $expectedRevision,
            $expectedVersion,
            EventSafetyRequirementAction::Archived,
            $idempotencyKey,
        );
    }

    /** @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion,changed:bool} */
    private function transition(
        int $eventId,
        User|int $actor,
        int $expectedRevision,
        int $expectedVersion,
        EventSafetyRequirementAction $action,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $actor,
            $expectedRevision,
            $expectedVersion,
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
            $this->support->authorizeManager($persistedActor, $event);
            $requirements = $this->requirements($tenantId, $eventId, true);
            $requestHash = $this->support->requestHash([
                'action' => $action->value,
                'event_id' => $eventId,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_revision' => $expectedRevision,
                'expected_version' => $expectedVersion,
            ]);
            $replay = $this->historyReplay(
                $tenantId,
                $idempotencyHash,
                $action,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return $this->saveResultFromHistory($tenantId, $replay);
            }
            if ((string) $requirements->getRawOriginal('status')
                === EventSafetyRequirementStatus::Archived->value) {
                throw new EventSafetyException('event_safety_requirements_archived');
            }
            if ((int) $requirements->revision !== $expectedRevision
                || (int) $requirements->current_version !== $expectedVersion) {
                throw new EventSafetyException('event_safety_requirements_revision_conflict');
            }
            if ($action === EventSafetyRequirementAction::Published
                && (string) $requirements->getRawOriginal('status')
                    !== EventSafetyRequirementStatus::Draft->value) {
                throw new EventSafetyException('event_safety_requirements_publish_invalid');
            }
            $version = $this->versionByNumber(
                $tenantId,
                (int) $requirements->id,
                $expectedVersion,
            );
            $newRevision = $expectedRevision + 1;
            $now = CarbonImmutable::now('UTC');
            $updates = [
                'revision' => $newRevision,
                'updated_by_user_id' => (int) $persistedActor->id,
                'updated_at' => $now,
            ];
            if ($action === EventSafetyRequirementAction::Published) {
                $updates += [
                    'status' => EventSafetyRequirementStatus::Published->value,
                    'published_version' => $expectedVersion,
                    'published_by_user_id' => (int) $persistedActor->id,
                    'published_at' => $now,
                ];
            } else {
                $updates += [
                    'status' => EventSafetyRequirementStatus::Archived->value,
                    'archived_by_user_id' => (int) $persistedActor->id,
                    'archived_at' => $now,
                ];
            }
            $updated = DB::table('event_safety_requirements')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('revision', $expectedRevision)
                ->where('current_version', $expectedVersion)
                ->update($updates);
            if ($updated !== 1) {
                throw new EventSafetyException('event_safety_requirements_revision_conflict');
            }
            $this->insertHistory(
                $tenantId,
                $eventId,
                (int) $requirements->id,
                $newRevision,
                (int) $version->id,
                $expectedVersion,
                $action,
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                ['state_transition' => $action->value],
                $now,
            );

            return [
                'requirements' => $this->requirementsModel(
                    $tenantId,
                    (int) $requirements->id,
                ),
                'version' => $version,
                'changed' => true,
            ];
        }, 3);
    }

    /** @param array<string,mixed> $attributes @return array<string,mixed> */
    private function normalize(array $attributes): array
    {
        if (array_diff(array_keys($attributes), self::FIELDS) !== []) {
            throw new EventSafetyException('event_safety_requirements_field_forbidden');
        }
        foreach (self::FIELDS as $field) {
            if (! array_key_exists($field, $attributes)) {
                throw new EventSafetyException('event_safety_requirements_field_missing');
            }
        }
        $minimumAge = $this->nullableAge($attributes['minimum_age']);
        $guardianRequired = $this->boolean($attributes['guardian_consent_required']);
        $minorThreshold = $this->nullableAge($attributes['minor_age_threshold']);
        // Adults-only platform (owner decision 2026-09-25, E-035 F-160): guardian
        // consent is switched off, so an organiser can no longer require it. A
        // minor-age threshold only ever made sense with it, and is refused by
        // the existing rule below whenever guardian consent is off. The minimum
        // age is deliberately unchanged.
        if ($guardianRequired) {
            throw new EventSafetyException('event_guardian_consent_retired');
        }
        if (($guardianRequired && ($minorThreshold === null || $minorThreshold < 1))
            || (! $guardianRequired && $minorThreshold !== null)) {
            throw new EventSafetyException('event_safety_minor_policy_invalid');
        }
        $codeRequired = $this->boolean($attributes['code_of_conduct_required']);
        $codeText = $attributes['code_of_conduct_text'];
        $codeVersion = $attributes['code_of_conduct_text_version'];
        if ($codeRequired) {
            if (! is_string($codeText)
                || trim($codeText) === ''
                || strlen($codeText) > 100000
                || ! is_string($codeVersion)
                || trim($codeVersion) === ''
                || strlen(trim($codeVersion)) > 64) {
                throw new EventSafetyException('event_safety_code_of_conduct_invalid');
            }
            $codeVersion = trim($codeVersion);
        } elseif ($codeText !== null || $codeVersion !== null) {
            throw new EventSafetyException('event_safety_code_of_conduct_invalid');
        }
        $policy = $this->support->eligibilityPolicyMetadata();

        return [
            'minimum_age' => $minimumAge,
            'guardian_consent_required' => $guardianRequired,
            'minor_age_threshold' => $minorThreshold,
            'code_of_conduct_required' => $codeRequired,
            'code_of_conduct_text' => $codeRequired ? $codeText : null,
            'code_of_conduct_text_version' => $codeRequired ? $codeVersion : null,
            'code_of_conduct_text_hash' => $codeRequired
                ? $this->support->exactTextHash($codeText)
                : null,
            'eligibility_policy_metadata' => $policy,
            'eligibility_policy_hash' => $this->support->requestHash($policy),
        ];
    }

    private function nullableAge(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (! is_int($value)
            && (! is_string($value) || preg_match('/^\d{1,3}$/', $value) !== 1)) {
            throw new EventSafetyException('event_safety_age_requirement_invalid');
        }
        $age = (int) $value;
        if ($age < 0 || $age > 125) {
            throw new EventSafetyException('event_safety_age_requirement_invalid');
        }

        return $age;
    }

    private function boolean(mixed $value): bool
    {
        if (! is_bool($value)) {
            throw new EventSafetyException('event_safety_requirements_boolean_invalid');
        }

        return $value;
    }

    /** @param array<string,mixed> $normalized */
    private function insertVersion(
        int $tenantId,
        int $eventId,
        int $requirementsId,
        int $versionNumber,
        int $actorId,
        string $idempotencyHash,
        string $requestHash,
        array $normalized,
        CarbonImmutable $now,
    ): int {
        return (int) DB::table('event_safety_requirement_versions')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'requirements_id' => $requirementsId,
            'version_number' => $versionNumber,
            'minimum_age' => $normalized['minimum_age'],
            'guardian_consent_required' => $normalized['guardian_consent_required'],
            'minor_age_threshold' => $normalized['minor_age_threshold'],
            'code_of_conduct_required' => $normalized['code_of_conduct_required'],
            'code_of_conduct_text' => $normalized['code_of_conduct_text'],
            'code_of_conduct_text_version' => $normalized['code_of_conduct_text_version'],
            'code_of_conduct_text_hash' => $normalized['code_of_conduct_text_hash'],
            'eligibility_policy_metadata' => $this->json(
                $normalized['eligibility_policy_metadata'],
            ),
            'eligibility_policy_hash' => $normalized['eligibility_policy_hash'],
            'captured_by_user_id' => $actorId,
            'idempotency_hash' => $idempotencyHash,
            'request_hash' => $requestHash,
            'created_at' => $now,
        ]);
    }

    /** @param array<string,mixed> $metadata */
    private function insertHistory(
        int $tenantId,
        int $eventId,
        int $requirementsId,
        int $revision,
        int $versionId,
        int $versionNumber,
        EventSafetyRequirementAction $action,
        int $actorId,
        string $idempotencyHash,
        string $requestHash,
        array $metadata,
        CarbonImmutable $now,
    ): void {
        DB::table('event_safety_requirement_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'requirements_id' => $requirementsId,
            'requirements_revision' => $revision,
            'requirements_version_id' => $versionId,
            'requirements_version_number' => $versionNumber,
            'action' => $action->value,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $idempotencyHash,
            'request_hash' => $requestHash,
            'metadata' => $this->json($metadata),
            'created_at' => $now,
        ]);
    }

    private function historyReplay(
        int $tenantId,
        string $idempotencyHash,
        EventSafetyRequirementAction $action,
        string $requestHash,
        bool $lock = false,
    ): ?EventSafetyRequirementHistory {
        $query = EventSafetyRequirementHistory::withoutGlobalScopes()
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

    /** @return array{requirements:EventSafetyRequirement,version:EventSafetyRequirementVersion,changed:bool} */
    private function saveResultFromHistory(
        int $tenantId,
        EventSafetyRequirementHistory $history,
    ): array {
        return [
            'requirements' => $this->requirementsModel(
                $tenantId,
                (int) $history->requirements_id,
            ),
            'version' => $this->versionModel(
                $tenantId,
                (int) $history->requirements_version_id,
            ),
            'changed' => false,
        ];
    }

    private function requirements(
        int $tenantId,
        int $eventId,
        bool $lock = false,
        bool $required = true,
    ): ?EventSafetyRequirement {
        $query = EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $requirements = $query->first();
        if ($required && $requirements === null) {
            throw new EventSafetyException('event_safety_requirements_not_found');
        }

        return $requirements;
    }

    private function versionByNumber(
        int $tenantId,
        int $requirementsId,
        int $versionNumber,
    ): EventSafetyRequirementVersion {
        $version = EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('requirements_id', $requirementsId)
            ->where('version_number', $versionNumber)
            ->first();
        if ($version === null) {
            throw new EventSafetyException('event_safety_requirements_version_not_found');
        }

        return $version;
    }

    private function requirementsModel(int $tenantId, int $id): EventSafetyRequirement
    {
        return EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);
    }

    private function versionModel(int $tenantId, int $id): EventSafetyRequirementVersion
    {
        return EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($id);
    }

    private function json(array $value): string
    {
        return json_encode(
            $value,
            JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
        );
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_safety_requirements',
            'event_safety_requirement_versions',
            'event_safety_requirement_history',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_safety_schema_unavailable');
            }
        }
    }
}
