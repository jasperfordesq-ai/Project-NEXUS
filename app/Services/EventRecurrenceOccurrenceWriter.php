<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventOperationalState;
use App\Enums\EventPublicationState;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use LogicException;

/** Canonical, deterministic concrete-occurrence row writer. */
class EventRecurrenceOccurrenceWriter
{
    /** @var list<string>|null */
    private static ?array $eventColumns = null;

    public function __construct(
        private readonly EventRecurrenceDefinitionBlueprintService $definitionBlueprints,
    ) {}

    /**
     * @param array{
     *   start_utc:string,
     *   end_utc:?string,
     *   occurrence_date:string,
     *   recurrence_id:string
     * } $occurrence
     * @return array{id:int,inserted:bool}
     */
    public function insert(
        object $root,
        array $occurrence,
        ?int $effectiveRevisionVersion = null,
    ): array
    {
        $tenantId = (int) ($root->tenant_id ?? 0);
        $rootId = (int) ($root->id ?? 0);
        if ($tenantId <= 0 || $rootId <= 0 || ! (bool) ($root->is_recurring_template ?? false)) {
            throw new LogicException('event_recurrence_occurrence_root_invalid');
        }

        $recurrence = app(EventRecurrenceService::class);
        $occurrenceKey = $recurrence->occurrenceKey(
            $tenantId,
            $rootId,
            $occurrence['recurrence_id'],
        );
        $values = $this->attributesForOccurrence($root, $occurrence);
        $columns = $this->eventColumns();
        $values = array_intersect_key($values, array_fill_keys($columns, true));
        $inserted = DB::table('events')->insertOrIgnore($values) === 1;
        $identityColumns = [
            'id',
            'tenant_id',
            'user_id',
            'parent_event_id',
            'start_time',
            'end_time',
            'occurrence_date',
            'occurrence_key',
            'timezone',
            'agenda_version',
            'recurrence_engine',
            'recurrence_engine_version',
        ];
        if (in_array('recurrence_id', $columns, true)) {
            $identityColumns[] = 'recurrence_id';
        }
        foreach ([
            'recurrence_override_fields',
            'recurrence_override_version',
            'recurrence_override_updated_by',
            'is_recurrence_exception',
        ] as $overrideColumn) {
            if (in_array($overrideColumn, $columns, true)) {
                $identityColumns[] = $overrideColumn;
            }
        }
        $existing = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('occurrence_key', $occurrenceKey)
            ->first($identityColumns);
        $overrideFields = $existing === null
            ? []
            : $this->overrideFields($existing->recurrence_override_fields ?? null);
        if ($existing === null
            || (int) $existing->parent_event_id !== $rootId
            || (! in_array('start_time', $overrideFields, true)
                && (string) $existing->start_time !== (string) $values['start_time'])
            || (! in_array('end_time', $overrideFields, true)
                && $this->nullableString($existing->end_time) !== $this->nullableString($values['end_time'] ?? null))
            || (! in_array('timezone', $overrideFields, true)
                && in_array('timezone', $identityColumns, true)
                && (string) $existing->timezone !== (string) ($values['timezone'] ?? 'UTC'))
            || (string) $existing->occurrence_date !== $occurrence['occurrence_date']
            || (string) $existing->recurrence_engine !== EventRecurrenceService::ENGINE
            || (string) $existing->recurrence_engine_version !== EventRecurrenceService::ENGINE_VERSION
            || (in_array('recurrence_id', $columns, true)
                && (string) $existing->recurrence_id !== $occurrence['recurrence_id'])) {
            throw new LogicException('event_recurrence_occurrence_identity_collision');
        }
        if ($overrideFields !== []
            && ((int) ($existing->recurrence_override_version ?? 0) < 1
                || ! (bool) ($existing->is_recurrence_exception ?? false))) {
            throw new LogicException('event_recurrence_occurrence_override_evidence_invalid');
        }

        // Definition blueprints are creation-only by design. A replay may
        // append occurrence-state evidence, but it must never mutate an
        // already materialized occurrence or silently backfill definitions.
        if ($inserted) {
            $this->definitionBlueprints->applyToNewOccurrence(
                $root,
                $existing,
                $occurrence['recurrence_id'],
            );
        }

        if (class_exists(EventRecurrenceRevisionService::class)) {
            $customized = (bool) ($existing->is_recurrence_exception ?? false)
                || (int) ($existing->recurrence_override_version ?? 0) > 0;
            $actorCandidate = $customized
                ? ((int) ($existing->recurrence_override_updated_by ?? 0) ?: null)
                : ((int) ($root->user_id ?? 0) ?: null);
            $actorUserId = $this->activeTenantActorId($tenantId, $actorCandidate);
            $metadata = ['source' => 'event_recurrence_occurrence_writer'];
            if ($actorCandidate !== null && $actorUserId === null) {
                // A deleted or cross-tenant actor must never be reattached to
                // durable evidence. Keep only a non-identifying resolution
                // reason so replay remains safe after erasure.
                $metadata['actor_resolution'] = $customized
                    ? 'override_actor_unavailable'
                    : 'root_actor_unavailable';
            }
            app(EventRecurrenceRevisionService::class)->recordOccurrenceState(
                $tenantId,
                $rootId,
                (int) $existing->id,
                $occurrence['recurrence_id'],
                $occurrenceKey,
                $customized ? 'customized' : 'materialized',
                $effectiveRevisionVersion,
                $actorUserId,
                $metadata,
            );
        }

        return ['id' => (int) $existing->id, 'inserted' => $inserted];
    }

    /**
     * Single occurrence-blueprint extension point. An effective-dated revision
     * resolver can override or decorate this method without changing identity,
     * lifecycle, or idempotency handling in insert().
     *
     * @param array{
     *   start_utc:string,
     *   end_utc:?string,
     *   occurrence_date:string,
     *   recurrence_id:string
     * } $occurrence
     * @return array<string,mixed>
     */
    public function attributesForOccurrence(object $root, array $occurrence): array
    {
        $tenantId = (int) ($root->tenant_id ?? 0);
        $rootId = (int) ($root->id ?? 0);
        $occurrenceKey = app(EventRecurrenceService::class)->occurrenceKey(
            $tenantId,
            $rootId,
            $occurrence['recurrence_id'],
        );
        $rootAttributes = [
            'user_id' => (int) $root->user_id,
            'group_id' => $root->group_id ?? null,
            'title' => (string) $root->title,
            'description' => (string) ($root->description ?? ''),
            'location' => $root->location ?? null,
            'start_time' => $occurrence['start_utc'],
            'end_time' => $occurrence['end_utc'],
            'timezone' => $root->timezone ?? 'UTC',
            'timezone_source' => $root->timezone_source ?? 'preexisting_unverified',
            'all_day' => (int) ($root->all_day ?? 0),
            'max_attendees' => $root->max_attendees ?? null,
            'is_online' => (int) ($root->is_online ?? 0),
            'online_link' => $root->online_link ?? null,
            'image_url' => $root->image_url ?? null,
            'video_url' => $root->video_url ?? null,
            'cover_image' => $root->cover_image ?? null,
            'sdg_goals' => $root->sdg_goals ?? null,
            'category_id' => $root->category_id ?? null,
            'volunteer_opportunity_id' => $root->volunteer_opportunity_id ?? null,
            'auto_log_hours' => (int) ($root->auto_log_hours ?? 0),
            'latitude' => $root->latitude ?? null,
            'longitude' => $root->longitude ?? null,
            'accessibility_step_free' => $root->accessibility_step_free ?? null,
            'accessibility_toilet' => $root->accessibility_toilet ?? null,
            'accessibility_hearing_loop' => $root->accessibility_hearing_loop ?? null,
            'accessibility_quiet_space' => $root->accessibility_quiet_space ?? null,
            'accessibility_seating' => $root->accessibility_seating ?? null,
            'accessibility_parking' => $root->accessibility_parking ?? null,
            'accessibility_parking_details' => $root->accessibility_parking_details ?? null,
            'accessibility_transit_details' => $root->accessibility_transit_details ?? null,
            'accessibility_assistance_contact' => $root->accessibility_assistance_contact ?? null,
            'accessibility_notes' => $root->accessibility_notes ?? null,
            'award' => $root->award ?? null,
            'event' => $root->event ?? null,
            'federated_visibility' => $root->federated_visibility ?? 'none',
            'allow_remote_attendance' => (int) ($root->allow_remote_attendance ?? 0),
            'is_public_listing' => (int) ($root->is_public_listing ?? 0),
        ];
        if (class_exists(EventRecurrenceRevisionService::class)) {
            $resolved = app(EventRecurrenceRevisionService::class)->effectiveBlueprint(
                $tenantId,
                $rootId,
                $occurrence['recurrence_id'],
                $occurrence['start_utc'],
                $rootAttributes,
            );
            if (! is_array($resolved)) {
                throw new LogicException('event_recurrence_blueprint_invalid');
            }
            // Revisions can only replace fields already present in the reviewed
            // root blueprint. Identity and lifecycle invariants are appended
            // below and cannot be supplied by a revision implementation.
            $rootAttributes = array_replace(
                $rootAttributes,
                array_intersect_key($resolved, $rootAttributes),
            );
        }
        if (! (bool) app(EventConfigurationService::class)->value(
            'federation_sharing_enabled',
            true,
            $tenantId,
        )) {
            $rootAttributes['federated_visibility'] = 'none';
        }

        $now = now();
        return array_merge($rootAttributes, [
            'tenant_id' => $tenantId,
            'parent_event_id' => $rootId,
            'occurrence_date' => $occurrence['occurrence_date'],
            'occurrence_key' => $occurrenceKey,
            'recurrence_id' => $occurrence['recurrence_id'],
            'recurrence_engine' => EventRecurrenceService::ENGINE,
            'recurrence_engine_version' => EventRecurrenceService::ENGINE_VERSION,
            'recurrence_override_fields' => null,
            'recurrence_override_version' => 0,
            'recurrence_override_updated_at' => null,
            'recurrence_override_updated_by' => null,
            'is_recurring_template' => 0,
            'series_id' => $root->series_id ?? null,
            'status' => 'draft',
            'publication_status' => EventPublicationState::Draft->value,
            'operational_status' => EventOperationalState::Scheduled->value,
            'lifecycle_version' => 0,
            'calendar_sequence' => 0,
            'agenda_version' => 0,
            'federation_version' => 1,
            'checkin_manifest_version' => 0,
            'publication_status_changed_at' => $now,
            'publication_status_changed_by' => (int) $root->user_id,
            'operational_status_changed_at' => $now,
            'operational_status_changed_by' => (int) $root->user_id,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    /** @return list<string> */
    private function eventColumns(): array
    {
        if (self::$eventColumns === null) {
            self::$eventColumns = Schema::getColumnListing('events');
        }

        return self::$eventColumns;
    }

    private function nullableString(mixed $value): ?string
    {
        return $value === null ? null : (string) $value;
    }

    private function activeTenantActorId(int $tenantId, ?int $candidate): ?int
    {
        if ($candidate === null || $candidate <= 0) {
            return null;
        }

        $exists = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $candidate)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->exists();

        return $exists ? $candidate : null;
    }

    /** @return list<string> */
    private function overrideFields(mixed $value): array
    {
        if ($value === null || $value === '') {
            return [];
        }
        if (is_string($value)) {
            $value = json_decode($value, true, 512, JSON_THROW_ON_ERROR);
        }
        if (! is_array($value)) {
            throw new LogicException('event_recurrence_occurrence_override_evidence_invalid');
        }

        $fields = [];
        foreach ($value as $field) {
            if (! is_string($field) || ! in_array($field, ['start_time', 'end_time', 'timezone'], true)) {
                // Non-schedule override fields remain valid evidence but do not
                // relax the deterministic schedule identity checks above.
                continue;
            }
            $fields[] = $field;
        }

        return array_values(array_unique($fields));
    }
}
