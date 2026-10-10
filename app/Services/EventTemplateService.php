<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventTemplateAuditAction;
use App\Enums\EventTemplateStatus;
use App\Exceptions\EventTemplateException;
use App\Models\Event;
use App\Models\EventTemplate;
use App\Models\EventTemplateAudit;
use App\Models\EventTemplateMaterialization;
use App\Models\EventTemplateVersion;
use App\Models\User;
use App\Support\Events\EventTemplateFoundationSupport;
use App\Support\Events\EventTemplateManifest;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/** Versioned, allowlist-only event template capture and draft materialization boundary. */
final class EventTemplateService
{
    public function __construct(
        private readonly EventTemplateFoundationSupport $support = new EventTemplateFoundationSupport(),
        private readonly EventTemplateManifest $manifest = new EventTemplateManifest(),
        private readonly EventConfigurationService $eventConfiguration = new EventConfigurationService(),
    ) {
    }

    /** @return array<string,mixed> */
    public function previewCapture(int $sourceEventId, User|int $actor): array
    {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $source = $this->support->sourceEvent($tenantId, $sourceEventId);
        $persistedActor = $this->support->actor($tenantId, $actor);
        $this->support->authorizeManager($persistedActor, $source);
        $payload = $this->manifest->capture($source);

        return [
            'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
            'source_event_id' => $sourceEventId,
            'source_lifecycle_version' => (int) $source->getRawOriginal('lifecycle_version'),
            'source_calendar_sequence' => (int) $source->getRawOriginal('calendar_sequence'),
            'payload' => $payload,
            'payload_hash' => $this->manifest->payloadHash($payload),
            'copied_fields' => EventTemplateManifest::COPIED_FIELDS,
            'skipped_fields' => EventTemplateManifest::SKIPPED_FIELDS,
            'checklist' => $this->captureChecklist(),
        ];
    }

    /** @return array{template:EventTemplate,version:EventTemplateVersion,created:bool} */
    public function capture(
        int $sourceEventId,
        User|int $actor,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);
        $requestHash = null;

        try {
            return DB::transaction(function () use (
                $tenantId,
                $sourceEventId,
                $actor,
                $idempotencyHash,
                &$requestHash,
            ): array {
                $source = $this->support->sourceEvent($tenantId, $sourceEventId, true);
                $persistedActor = $this->support->actor($tenantId, $actor, true);
                $this->support->authorizeManager($persistedActor, $source);
                $requestHash = $this->manifest->hash([
                    'action' => EventTemplateAuditAction::Captured->value,
                    'source_event_id' => $sourceEventId,
                    'actor_user_id' => (int) $persistedActor->id,
                ]);
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Captured,
                    $requestHash,
                    true,
                );
                if ($replay !== null) {
                    return $this->captureResultFromAudit($tenantId, $replay);
                }

                $payload = $this->manifest->capture($source);
                $payloadHash = $this->manifest->payloadHash($payload);
                $now = CarbonImmutable::now('UTC');
                $templateId = (int) DB::table('event_templates')->insertGetId([
                    'tenant_id' => $tenantId,
                    'public_id' => (string) Str::uuid(),
                    'source_event_id' => $sourceEventId,
                    'current_version' => 1,
                    'status' => EventTemplateStatus::Active->value,
                    'created_by_user_id' => (int) $persistedActor->id,
                    'archived_by_user_id' => null,
                    'archived_at' => null,
                    'archive_reason' => null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $versionId = $this->insertVersion(
                    $tenantId,
                    $templateId,
                    $source,
                    1,
                    (int) $persistedActor->id,
                    $idempotencyHash,
                    $requestHash,
                    $payload,
                    $payloadHash,
                    $now,
                );
                $this->insertAudit(
                    $tenantId,
                    $templateId,
                    $versionId,
                    1,
                    $sourceEventId,
                    null,
                    EventTemplateAuditAction::Captured,
                    (int) $persistedActor->id,
                    $idempotencyHash,
                    $requestHash,
                    [
                        'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
                        'payload_hash' => $payloadHash,
                        'copied_fields' => EventTemplateManifest::COPIED_FIELDS,
                        'skipped_fields' => EventTemplateManifest::SKIPPED_FIELDS,
                    ],
                    $now,
                );

                return [
                    'template' => $this->templateModel($tenantId, $templateId),
                    'version' => $this->versionModel($tenantId, $versionId),
                    'created' => true,
                ];
            }, 3);
        } catch (QueryException $exception) {
            if ($requestHash !== null && $this->isUniqueConflict($exception)) {
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Captured,
                    $requestHash,
                );
                if ($replay !== null) {
                    return $this->captureResultFromAudit($tenantId, $replay);
                }
            }

            throw $exception;
        }
    }

    /** @return array{template:EventTemplate,version:EventTemplateVersion,changed:bool} */
    public function revise(
        int $templateId,
        User|int $actor,
        int $expectedVersion,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);
        $requestHash = null;

        try {
            return DB::transaction(function () use (
                $tenantId,
                $templateId,
                $actor,
                $expectedVersion,
                $idempotencyHash,
                &$requestHash,
            ): array {
                $template = $this->template($tenantId, $templateId, true);
                $source = $this->support->sourceEvent(
                    $tenantId,
                    (int) $template->source_event_id,
                    true,
                );
                $persistedActor = $this->support->actor($tenantId, $actor, true);
                $this->support->authorizeManager($persistedActor, $source);
                $requestHash = $this->manifest->hash([
                    'action' => EventTemplateAuditAction::Revised->value,
                    'template_id' => $templateId,
                    'source_event_id' => (int) $source->id,
                    'actor_user_id' => (int) $persistedActor->id,
                    'expected_version' => $expectedVersion,
                ]);
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Revised,
                    $requestHash,
                    true,
                );
                if ($replay !== null) {
                    return $this->revisionResultFromAudit($tenantId, $replay);
                }
                $this->assertActiveTemplate($template);
                if ($expectedVersion <= 0 || (int) $template->current_version !== $expectedVersion) {
                    throw new EventTemplateException('event_template_version_conflict');
                }

                $payload = $this->manifest->capture($source);
                $payloadHash = $this->manifest->payloadHash($payload);
                $newVersion = $expectedVersion + 1;
                $now = CarbonImmutable::now('UTC');
                $versionId = $this->insertVersion(
                    $tenantId,
                    $templateId,
                    $source,
                    $newVersion,
                    (int) $persistedActor->id,
                    $idempotencyHash,
                    $requestHash,
                    $payload,
                    $payloadHash,
                    $now,
                );
                $updated = DB::table('event_templates')
                    ->where('tenant_id', $tenantId)
                    ->where('id', $templateId)
                    ->where('status', EventTemplateStatus::Active->value)
                    ->where('current_version', $expectedVersion)
                    ->update([
                        'current_version' => $newVersion,
                        'updated_at' => $now,
                    ]);
                if ($updated !== 1) {
                    throw new EventTemplateException('event_template_version_conflict');
                }
                $this->insertAudit(
                    $tenantId,
                    $templateId,
                    $versionId,
                    $newVersion,
                    (int) $source->id,
                    null,
                    EventTemplateAuditAction::Revised,
                    (int) $persistedActor->id,
                    $idempotencyHash,
                    $requestHash,
                    [
                        'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
                        'payload_hash' => $payloadHash,
                        'copied_fields' => EventTemplateManifest::COPIED_FIELDS,
                        'skipped_fields' => EventTemplateManifest::SKIPPED_FIELDS,
                    ],
                    $now,
                );

                return [
                    'template' => $this->templateModel($tenantId, $templateId),
                    'version' => $this->versionModel($tenantId, $versionId),
                    'changed' => true,
                ];
            }, 3);
        } catch (QueryException $exception) {
            if ($requestHash !== null && $this->isUniqueConflict($exception)) {
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Revised,
                    $requestHash,
                );
                if ($replay !== null) {
                    return $this->revisionResultFromAudit($tenantId, $replay);
                }
            }

            throw $exception;
        }
    }

    /** @return array{template:EventTemplate,changed:bool} */
    public function archive(
        int $templateId,
        User|int $actor,
        int $expectedVersion,
        string $reason,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $reason = trim($reason);
        if ($reason === '' || mb_strlen($reason) > 500) {
            throw new EventTemplateException('event_template_archive_reason_invalid');
        }
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);

        return DB::transaction(function () use (
            $tenantId,
            $templateId,
            $actor,
            $expectedVersion,
            $reason,
            $idempotencyHash,
        ): array {
            $template = $this->template($tenantId, $templateId, true);
            $source = $this->support->sourceEvent(
                $tenantId,
                (int) $template->source_event_id,
                true,
            );
            $persistedActor = $this->support->actor($tenantId, $actor, true);
            $this->support->authorizeManager($persistedActor, $source);
            $requestHash = $this->manifest->hash([
                'action' => EventTemplateAuditAction::Archived->value,
                'template_id' => $templateId,
                'source_event_id' => (int) $source->id,
                'actor_user_id' => (int) $persistedActor->id,
                'expected_version' => $expectedVersion,
                'reason' => $reason,
            ]);
            $replay = $this->auditReplay(
                $tenantId,
                $idempotencyHash,
                EventTemplateAuditAction::Archived,
                $requestHash,
                true,
            );
            if ($replay !== null) {
                return [
                    'template' => $this->templateModel($tenantId, $templateId),
                    'changed' => false,
                ];
            }
            $this->assertActiveTemplate($template);
            if ($expectedVersion <= 0 || (int) $template->current_version !== $expectedVersion) {
                throw new EventTemplateException('event_template_version_conflict');
            }
            $version = $this->versionByNumber($tenantId, $templateId, $expectedVersion);
            $now = CarbonImmutable::now('UTC');
            $updated = DB::table('event_templates')
                ->where('tenant_id', $tenantId)
                ->where('id', $templateId)
                ->where('status', EventTemplateStatus::Active->value)
                ->where('current_version', $expectedVersion)
                ->update([
                    'status' => EventTemplateStatus::Archived->value,
                    'archived_by_user_id' => (int) $persistedActor->id,
                    'archived_at' => $now,
                    'archive_reason' => $reason,
                    'updated_at' => $now,
                ]);
            if ($updated !== 1) {
                throw new EventTemplateException('event_template_version_conflict');
            }
            $this->insertAudit(
                $tenantId,
                $templateId,
                (int) $version->id,
                $expectedVersion,
                (int) $source->id,
                null,
                EventTemplateAuditAction::Archived,
                (int) $persistedActor->id,
                $idempotencyHash,
                $requestHash,
                ['archive_reason_recorded' => true],
                $now,
            );

            return [
                'template' => $this->templateModel($tenantId, $templateId),
                'changed' => true,
            ];
        }, 3);
    }

    /**
     * @param DateTimeInterface|string $startTime
     * @param DateTimeInterface|string|null $endTime
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    public function previewMaterialization(
        int $templateId,
        int $versionNumber,
        User|int $actor,
        DateTimeInterface|string $startTime,
        DateTimeInterface|string|null $endTime,
        array $overrides = [],
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $plan = $this->materializationPlan(
            $tenantId,
            $templateId,
            $versionNumber,
            $actor,
            $startTime,
            $endTime,
            $overrides,
            false,
        );
        $this->assertMaterializationCurrent($plan['template'], $versionNumber);

        return $this->previewFromPlan($plan);
    }

    /**
     * @param DateTimeInterface|string $startTime
     * @param DateTimeInterface|string|null $endTime
     * @param array<string,mixed> $overrides
     * @return array{event:Event,materialization:EventTemplateMaterialization,created:bool}
     */
    public function materialize(
        int $templateId,
        int $versionNumber,
        User|int $actor,
        DateTimeInterface|string $startTime,
        DateTimeInterface|string|null $endTime,
        array $overrides,
        string $idempotencyKey,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $idempotencyHash = $this->support->idempotencyHash($idempotencyKey);
        $requestHash = null;

        try {
            return DB::transaction(function () use (
                $tenantId,
                $templateId,
                $versionNumber,
                $actor,
                $startTime,
                $endTime,
                $overrides,
                $idempotencyHash,
                &$requestHash,
            ): array {
                $plan = $this->materializationPlan(
                    $tenantId,
                    $templateId,
                    $versionNumber,
                    $actor,
                    $startTime,
                    $endTime,
                    $overrides,
                    true,
                );
                // Materializing creates a new event, so it must obey the same
                // community "who may create events" rule as POST /v2/events
                // (F-589). Checked before the idempotent replay so a member who
                // has lost the right cannot re-obtain a result either.
                if (! $this->eventConfiguration->canCreate($tenantId, (int) $plan['actor']->id)) {
                    throw new EventTemplateException('event_template_authorization_denied');
                }
                $requestHash = $this->materializationRequestHash($plan);
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Materialized,
                    $requestHash,
                    true,
                );
                if ($replay !== null) {
                    return $this->materializationResultFromAudit($tenantId, $replay);
                }
                $this->assertMaterializationCurrent($plan['template'], $versionNumber);

                /** @var Event $event */
                $event = EventService::create(
                    (int) $plan['actor']->id,
                    $plan['writer_payload'],
                );
                $this->assertFreshDraft($tenantId, (int) $plan['actor']->id, $event);
                $now = CarbonImmutable::now('UTC');
                $materializationId = (int) DB::table('event_template_materializations')
                    ->insertGetId([
                        'tenant_id' => $tenantId,
                        'template_id' => $templateId,
                        'template_version_id' => (int) $plan['version']->id,
                        'template_version_number' => $versionNumber,
                        'source_event_id' => (int) $plan['source']->id,
                        'created_event_id' => (int) $event->id,
                        'materialized_by_user_id' => (int) $plan['actor']->id,
                        'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
                        'template_payload_hash' => (string) $plan['version']->payload_hash,
                        'effective_payload_hash' => $plan['effective_payload_hash'],
                        'idempotency_hash' => $idempotencyHash,
                        'request_hash' => $requestHash,
                        'schedule_start_utc' => $plan['schedule']['start_utc'],
                        'schedule_end_utc' => $plan['schedule']['end_utc'],
                        'schedule_timezone' => $plan['schedule']['timezone'],
                        'schedule_all_day' => $plan['schedule']['all_day'],
                        'override_fields' => $this->json($plan['override_fields']),
                        'federation_normalized' => true,
                        'created_at' => $now,
                    ]);
                $this->insertAudit(
                    $tenantId,
                    $templateId,
                    (int) $plan['version']->id,
                    $versionNumber,
                    (int) $plan['source']->id,
                    (int) $event->id,
                    EventTemplateAuditAction::Materialized,
                    (int) $plan['actor']->id,
                    $idempotencyHash,
                    $requestHash,
                    [
                        'materialization_id' => $materializationId,
                        'effective_payload_hash' => $plan['effective_payload_hash'],
                        'override_fields' => $plan['override_fields'],
                        'federation_normalized' => true,
                        'publication_workflow' => 'fresh_draft',
                    ],
                    $now,
                );

                return [
                    'event' => $event->fresh() ?? $event,
                    'materialization' => $this->materializationModel(
                        $tenantId,
                        $materializationId,
                    ),
                    'created' => true,
                ];
            }, 3);
        } catch (QueryException $exception) {
            if ($requestHash !== null && $this->isUniqueConflict($exception)) {
                $replay = $this->auditReplay(
                    $tenantId,
                    $idempotencyHash,
                    EventTemplateAuditAction::Materialized,
                    $requestHash,
                );
                if ($replay !== null) {
                    return $this->materializationResultFromAudit($tenantId, $replay);
                }
            }

            throw $exception;
        }
    }

    /**
     * @param DateTimeInterface|string $startTime
     * @param DateTimeInterface|string|null $endTime
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    private function materializationPlan(
        int $tenantId,
        int $templateId,
        int $versionNumber,
        User|int $actor,
        DateTimeInterface|string $startTime,
        DateTimeInterface|string|null $endTime,
        array $overrides,
        bool $lock,
    ): array {
        if ($versionNumber <= 0) {
            throw new EventTemplateException('event_template_version_not_found');
        }
        $template = $this->template($tenantId, $templateId, $lock);
        $source = $this->support->sourceEvent(
            $tenantId,
            (int) $template->source_event_id,
            $lock,
        );
        $persistedActor = $this->support->actor($tenantId, $actor, $lock);
        $this->support->authorizeManager($persistedActor, $source);
        $version = $this->versionByNumber($tenantId, $templateId, $versionNumber, $lock);
        $payload = $this->verifiedPayload($template, $version, $source);
        $effective = $this->manifest->materializationPayload($payload, $overrides);
        $effectivePayload = $effective['payload'];
        $schedule = $this->support->schedule(
            $startTime,
            $endTime,
            (string) $effectivePayload['timezone'],
            (bool) $effectivePayload['all_day'],
        );
        $writerPayload = [
            ...$effectivePayload,
            // Preserve the normalized instant across non-UTC event timezones.
            // A naive SQL datetime string would be interpreted again as local
            // wall time by EventService's canonical writer.
            'start_time' => $schedule['start_utc']->format('Y-m-d\TH:i:s\Z'),
            'end_time' => $schedule['end_utc']?->format('Y-m-d\TH:i:s\Z'),
            'timezone' => $schedule['timezone'],
            'all_day' => $schedule['all_day'],
            'federated_visibility' => 'none',
        ];
        $overrideValues = [];
        foreach ($effective['override_fields'] as $field) {
            $overrideValues[$field] = $effectivePayload[$field];
        }

        return [
            'template' => $template,
            'version' => $version,
            'source' => $source,
            'actor' => $persistedActor,
            'payload' => $payload,
            'effective_payload' => $effectivePayload,
            'effective_payload_hash' => $this->manifest->hash([
                'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
                'writer_payload' => $writerPayload,
            ]),
            'override_fields' => $effective['override_fields'],
            'override_values' => $overrideValues,
            'schedule' => $schedule,
            'writer_payload' => $writerPayload,
        ];
    }

    /** @param array<string,mixed> $plan */
    private function previewFromPlan(array $plan): array
    {
        return [
            'template_id' => (int) $plan['template']->id,
            'template_version_id' => (int) $plan['version']->id,
            'template_version_number' => (int) $plan['version']->version_number,
            'source_event_id' => (int) $plan['source']->id,
            'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
            'template_payload_hash' => (string) $plan['version']->payload_hash,
            'effective_payload_hash' => $plan['effective_payload_hash'],
            'effective_payload' => $plan['effective_payload'],
            'schedule' => [
                'start_utc' => $plan['schedule']['start_utc']->format('Y-m-d\TH:i:s\Z'),
                'end_utc' => $plan['schedule']['end_utc']?->format('Y-m-d\TH:i:s\Z'),
                'timezone' => $plan['schedule']['timezone'],
                'all_day' => $plan['schedule']['all_day'],
            ],
            'copied_fields' => EventTemplateManifest::COPIED_FIELDS,
            'skipped_fields' => EventTemplateManifest::SKIPPED_FIELDS,
            'override_fields' => $plan['override_fields'],
            'checklist' => [
                ['code' => 'event_template_check_source_manage', 'passed' => true],
                ['code' => 'event_template_check_version_current', 'passed' => true],
                ['code' => 'event_template_check_allowlist_exact', 'passed' => true],
                ['code' => 'event_template_check_schedule_valid', 'passed' => true],
                ['code' => 'event_template_check_federation_none', 'passed' => true],
                ['code' => 'event_template_check_canonical_writer', 'passed' => true],
            ],
            'will_create' => [
                'publication_status' => 'draft',
                'operational_status' => 'scheduled',
                'recurring' => false,
                'publish' => false,
                'register' => false,
                'notify' => false,
                'federate' => false,
            ],
        ];
    }

    /** @param array<string,mixed> $plan */
    private function materializationRequestHash(array $plan): string
    {
        return $this->manifest->hash([
            'action' => EventTemplateAuditAction::Materialized->value,
            'template_id' => (int) $plan['template']->id,
            'template_version_id' => (int) $plan['version']->id,
            'template_version_number' => (int) $plan['version']->version_number,
            'source_event_id' => (int) $plan['source']->id,
            'actor_user_id' => (int) $plan['actor']->id,
            'schedule' => [
                'start_utc' => $plan['schedule']['start_utc']->format('Y-m-d H:i:s'),
                'end_utc' => $plan['schedule']['end_utc']?->format('Y-m-d H:i:s'),
                'timezone' => $plan['schedule']['timezone'],
                'all_day' => $plan['schedule']['all_day'],
            ],
            'overrides' => $plan['override_values'],
        ]);
    }

    /** @return array<string,mixed> */
    private function verifiedPayload(
        EventTemplate $template,
        EventTemplateVersion $version,
        Event $source,
    ): array {
        $payload = $version->payload;
        if (! is_array($payload)
            || (int) $version->schema_version !== EventTemplateManifest::SCHEMA_VERSION
            || (int) $version->template_id !== (int) $template->id
            || (int) $version->source_event_id !== (int) $source->id
            || $version->copied_fields !== EventTemplateManifest::COPIED_FIELDS
            || $version->skipped_fields !== EventTemplateManifest::SKIPPED_FIELDS) {
            throw new EventTemplateException('event_template_snapshot_integrity_invalid');
        }
        try {
            $calculated = $this->manifest->payloadHash($payload);
        } catch (EventTemplateException) {
            throw new EventTemplateException('event_template_snapshot_integrity_invalid');
        }
        if (! hash_equals((string) $version->payload_hash, $calculated)) {
            throw new EventTemplateException('event_template_snapshot_integrity_invalid');
        }

        return $payload;
    }

    private function assertMaterializationCurrent(
        EventTemplate $template,
        int $versionNumber,
    ): void {
        $this->assertActiveTemplate($template);
        if ((int) $template->current_version !== $versionNumber) {
            throw new EventTemplateException('event_template_version_stale');
        }
    }

    private function assertFreshDraft(int $tenantId, int $actorId, Event $event): void
    {
        if ((int) $event->getAttribute('tenant_id') !== $tenantId
            || (int) $event->getAttribute('user_id') !== $actorId
            || (string) $event->getRawOriginal('status') !== 'draft'
            || (string) $event->getRawOriginal('publication_status') !== 'draft'
            || (string) $event->getRawOriginal('operational_status') !== 'scheduled'
            || (bool) $event->getRawOriginal('is_recurring_template')
            || $event->getRawOriginal('parent_event_id') !== null
            || $event->getRawOriginal('series_id') !== null
            || (string) $event->getRawOriginal('federated_visibility') !== 'none') {
            throw new EventTemplateException('event_template_materialized_event_invalid');
        }
    }

    private function assertActiveTemplate(EventTemplate $template): void
    {
        if ((string) $template->getRawOriginal('status') !== EventTemplateStatus::Active->value) {
            throw new EventTemplateException('event_template_archived');
        }
    }

    /** @return list<array{code:string,passed:bool}> */
    private function captureChecklist(): array
    {
        return [
            ['code' => 'event_template_check_source_manage', 'passed' => true],
            ['code' => 'event_template_check_allowlist_exact', 'passed' => true],
            ['code' => 'event_template_check_private_records_skipped', 'passed' => true],
            ['code' => 'event_template_check_versioned_snapshot', 'passed' => true],
        ];
    }

    /**
     * @param array<string,mixed> $payload
     */
    private function insertVersion(
        int $tenantId,
        int $templateId,
        Event $source,
        int $versionNumber,
        int $actorId,
        string $idempotencyHash,
        string $requestHash,
        array $payload,
        string $payloadHash,
        CarbonImmutable $now,
    ): int {
        return (int) DB::table('event_template_versions')->insertGetId([
            'tenant_id' => $tenantId,
            'template_id' => $templateId,
            'source_event_id' => (int) $source->id,
            'version_number' => $versionNumber,
            'schema_version' => EventTemplateManifest::SCHEMA_VERSION,
            'payload' => $this->json($payload),
            'payload_hash' => $payloadHash,
            'copied_fields' => $this->json(EventTemplateManifest::COPIED_FIELDS),
            'skipped_fields' => $this->json(EventTemplateManifest::SKIPPED_FIELDS),
            'source_lifecycle_version' => max(
                0,
                (int) $source->getRawOriginal('lifecycle_version'),
            ),
            'source_calendar_sequence' => max(
                0,
                (int) $source->getRawOriginal('calendar_sequence'),
            ),
            'source_updated_at' => $source->getRawOriginal('updated_at'),
            'captured_by_user_id' => $actorId,
            'capture_idempotency_hash' => $idempotencyHash,
            'capture_request_hash' => $requestHash,
            'created_at' => $now,
        ]);
    }

    /** @param array<string,mixed> $metadata */
    private function insertAudit(
        int $tenantId,
        int $templateId,
        ?int $versionId,
        int $versionNumber,
        int $sourceEventId,
        ?int $materializedEventId,
        EventTemplateAuditAction $action,
        int $actorId,
        string $idempotencyHash,
        string $requestHash,
        array $metadata,
        CarbonImmutable $now,
    ): void {
        DB::table('event_template_audit')->insert([
            'tenant_id' => $tenantId,
            'template_id' => $templateId,
            'template_version_id' => $versionId,
            'template_version_number' => $versionNumber,
            'source_event_id' => $sourceEventId,
            'materialized_event_id' => $materializedEventId,
            'action' => $action->value,
            'actor_user_id' => $actorId,
            'idempotency_hash' => $idempotencyHash,
            'request_hash' => $requestHash,
            'metadata' => $this->json($metadata),
            'created_at' => $now,
        ]);
    }

    private function auditReplay(
        int $tenantId,
        string $idempotencyHash,
        EventTemplateAuditAction $action,
        string $requestHash,
        bool $lock = false,
    ): ?EventTemplateAudit {
        $query = EventTemplateAudit::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('idempotency_hash', $idempotencyHash);
        if ($lock) {
            $query->lockForUpdate();
        }
        $audit = $query->first();
        if ($audit === null) {
            return null;
        }
        if ((string) $audit->getRawOriginal('action') !== $action->value
            || ! hash_equals((string) $audit->request_hash, $requestHash)) {
            throw new EventTemplateException('event_template_idempotency_conflict');
        }

        return $audit;
    }

    /** @return array{template:EventTemplate,version:EventTemplateVersion,created:bool} */
    private function captureResultFromAudit(int $tenantId, EventTemplateAudit $audit): array
    {
        if ($audit->template_version_id === null) {
            throw new EventTemplateException('event_template_idempotency_evidence_invalid');
        }

        return [
            'template' => $this->templateModel($tenantId, (int) $audit->template_id),
            'version' => $this->versionModel($tenantId, (int) $audit->template_version_id),
            'created' => false,
        ];
    }

    /** @return array{template:EventTemplate,version:EventTemplateVersion,changed:bool} */
    private function revisionResultFromAudit(int $tenantId, EventTemplateAudit $audit): array
    {
        if ($audit->template_version_id === null) {
            throw new EventTemplateException('event_template_idempotency_evidence_invalid');
        }

        return [
            'template' => $this->templateModel($tenantId, (int) $audit->template_id),
            'version' => $this->versionModel($tenantId, (int) $audit->template_version_id),
            'changed' => false,
        ];
    }

    /** @return array{event:Event,materialization:EventTemplateMaterialization,created:bool} */
    private function materializationResultFromAudit(
        int $tenantId,
        EventTemplateAudit $audit,
    ): array {
        if ($audit->materialized_event_id === null) {
            throw new EventTemplateException('event_template_idempotency_evidence_invalid');
        }
        $materialization = EventTemplateMaterialization::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('template_id', (int) $audit->template_id)
            ->where('created_event_id', (int) $audit->materialized_event_id)
            ->first();
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $audit->materialized_event_id)
            ->first();
        if ($materialization === null || $event === null) {
            throw new EventTemplateException('event_template_idempotency_evidence_invalid');
        }

        return [
            'event' => $event,
            'materialization' => $materialization,
            'created' => false,
        ];
    }

    private function template(
        int $tenantId,
        int $templateId,
        bool $lock = false,
    ): EventTemplate {
        $query = EventTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($templateId);
        if ($lock) {
            $query->lockForUpdate();
        }
        $template = $query->first();
        if ($template === null) {
            throw new EventTemplateException('event_template_not_found');
        }

        return $template;
    }

    private function versionByNumber(
        int $tenantId,
        int $templateId,
        int $versionNumber,
        bool $lock = false,
    ): EventTemplateVersion {
        $query = EventTemplateVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('template_id', $templateId)
            ->where('version_number', $versionNumber);
        if ($lock) {
            $query->lockForUpdate();
        }
        $version = $query->first();
        if ($version === null) {
            throw new EventTemplateException('event_template_version_not_found');
        }

        return $version;
    }

    private function templateModel(int $tenantId, int $templateId): EventTemplate
    {
        return EventTemplate::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($templateId);
    }

    private function versionModel(int $tenantId, int $versionId): EventTemplateVersion
    {
        return EventTemplateVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($versionId);
    }

    private function materializationModel(
        int $tenantId,
        int $materializationId,
    ): EventTemplateMaterialization {
        return EventTemplateMaterialization::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->findOrFail($materializationId);
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
            'event_templates',
            'event_template_versions',
            'event_template_materializations',
            'event_template_audit',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventTemplateException('event_template_schema_unavailable');
            }
        }
    }

    private function isUniqueConflict(QueryException $exception): bool
    {
        $state = (string) ($exception->errorInfo[0] ?? $exception->getCode());
        $driverCode = (int) ($exception->errorInfo[1] ?? 0);

        return in_array($state, ['23000', '23505'], true)
            && in_array($driverCode, [0, 1062, 1555, 2067], true);
    }
}
