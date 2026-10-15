<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventNotificationDeliveryMode;
use App\Exceptions\EventRecurrenceRevisionException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use DateTimeImmutable;
use DateTimeZone;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use JsonException;
use Throwable;
use App\Support\Authorization\ManagerDelegate;

/**
 * Preview-first, effective-dated recurring-series blueprint revisions.
 *
 * Recurrence identity is immutable. This service only changes the inherited
 * blueprint projected onto a concrete identity at or after the selected
 * boundary. Rule-shape changes remain fail-closed until an operator can
 * explicitly reconcile participant-bearing ordinal ambiguity.
 */
final class EventRecurrenceRevisionService
{
    private const REVISION_TABLE = 'event_recurrence_revisions';
    private const OCCURRENCE_LEDGER = 'event_recurrence_occurrence_ledger';
    private const RULE_ENGINE = 'sabre-vobject';
    private const RULE_ENGINE_VERSION = '2';

    /** @var list<string> */
    private const DIRECT_PATCH_FIELDS = [
        'title',
        'description',
        'location',
        'latitude',
        'longitude',
        'max_attendees',
        'is_online',
        'online_link',
        'video_url',
        'allow_remote_attendance',
        'is_public_listing',
        'category_id',
        'all_day',
        'accessibility_step_free',
        'accessibility_toilet',
        'accessibility_hearing_loop',
        'accessibility_quiet_space',
        'accessibility_seating',
        'accessibility_parking',
        'accessibility_parking_details',
        'accessibility_transit_details',
        'accessibility_assistance_contact',
        'accessibility_notes',
    ];

    /** @var list<string> */
    private const SCHEDULE_PATCH_FIELDS = [
        'timezone',
        'local_start_time',
        'local_end_time',
    ];

    /** @var list<string> */
    private const RULE_SHAPE_PATCH_FIELDS = [
        'recurrence_rrule',
        'recurrence_exdates',
        'recurrence_rdates',
    ];

    /** @var list<string> */
    private const UNSUPPORTED_EFFECTIVE_FIELDS = [
        'group_id',
        'series_id',
        'poll_ids',
        'image_url',
        'cover_image',
        'federated_visibility',
    ];

    public function __construct(
        private readonly EventRecurrenceRevisionTokenService $tokens,
        private readonly EventPolicy $policy,
        private readonly EventDomainOutboxService $outbox,
    ) {}

    /**
     * @param array<string,mixed> $rawPatch
     * @return array<string,mixed>
     */
    public function preview(int $occurrenceId, int $actorId, array $rawPatch): array
    {
        $tenantId = $this->tenantId();
        $this->assertRevisionRolloutEnabled();
        $patch = $this->normalizePatch($rawPatch);
        $this->validateReferences($tenantId, $patch);
        $patchHash = $this->hash($patch);

        $preview = DB::transaction(function () use (
            $tenantId,
            $occurrenceId,
            $actorId,
            $patch,
            $patchHash,
        ): array {
            $context = $this->lockedContext(
                $tenantId,
                $occurrenceId,
                $actorId,
                false,
            );
            $impact = $this->impact(
                $tenantId,
                $context['root'],
                $context['rule'],
                $context['selected'],
                $context['occurrences'],
                $patch,
            );
            $checksum = $this->materializedChecksum($context['all_occurrences']);
            $currentRevision = (int) ($context['rule']->effective_revision_version ?? 0);
            $claims = [
                'tenant_id' => $tenantId,
                'actor_user_id' => $actorId,
                'root_event_id' => (int) $context['root']->id,
                'selected_event_id' => (int) $context['selected']->id,
                'selected_recurrence_id' => (string) $context['selected']->recurrence_id,
                'patch_hash' => $patchHash,
                'root_calendar_sequence' => (int) ($context['root']->calendar_sequence ?? 0),
                'rule_hash' => (string) $context['rule']->rule_hash,
                'rule_version' => $currentRevision,
                'revision_version' => $currentRevision,
                'materialized_set_version' => (int) ($context['rule']->materialized_set_version ?? 0),
                'materialized_checksum' => $checksum,
                'previewed_at' => now()->toIso8601String(),
            ];

            return [
                'preview_token' => $this->tokens->issue($claims),
                'preview_expires_at' => now()->addSeconds($this->previewTtlSeconds())->toIso8601String(),
                'scope' => 'this_and_future',
                'selected_event_id' => (int) $context['selected']->id,
                'root_event_id' => (int) $context['root']->id,
                'effective_from_utc' => $this->recurrenceIdToUtc(
                    (string) $context['selected']->recurrence_id,
                ),
                'can_commit' => $impact['blocking_conflicts'] === [],
                'impact' => $impact,
            ];
        }, 3);

        return $preview;
    }

    /**
     * @param array<string,mixed> $rawPatch
     * @return array<string,mixed>
     */
    public function commit(
        int $occurrenceId,
        int $actorId,
        array $rawPatch,
        string $previewToken,
        string $idempotencyKey,
    ): array {
        $tenantId = $this->tenantId();
        $patch = $this->normalizePatch($rawPatch);
        $patchHash = $this->hash($patch);
        $idempotencyKey = trim($idempotencyKey);
        if ($idempotencyKey === '' || mb_strlen($idempotencyKey) > 191) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_idempotency_invalid');
        }

        // Authenticated decryption occurs before database work. Expiry is
        // checked after replay lookup so a lost successful response remains
        // safely replayable with the original semantic request.
        $claims = $this->tokens->decode($previewToken, false);
        $this->assertTokenRequestScope(
            $claims,
            $tenantId,
            $actorId,
            $occurrenceId,
            $patchHash,
        );
        $requestHash = $this->hash([
            'tenant_id' => $tenantId,
            'actor_user_id' => $actorId,
            'root_event_id' => (int) $claims['root_event_id'],
            'selected_event_id' => $occurrenceId,
            'selected_recurrence_id' => (string) $claims['selected_recurrence_id'],
            'patch' => $patch,
        ]);
        $idempotencyHash = hash('sha256', implode('|', [
            'event-recurrence-revision-v1',
            (string) $tenantId,
            (string) $claims['root_event_id'],
            $idempotencyKey,
        ]));

        $result = DB::transaction(function () use (
            $tenantId,
            $occurrenceId,
            $actorId,
            $patch,
            $patchHash,
            $claims,
            $requestHash,
            $idempotencyHash,
        ): array {
            // Replay is resolved before mutable occurrence state. The original
            // encrypted request scope, authenticated actor and immutable
            // request hash are sufficient to return a lost successful result
            // even after later rolling materialization or edits.
            $replayRoot = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $claims['root_event_id'])
                ->lockForUpdate()
                ->first(['id']);
            $replayRule = DB::table('event_recurrence_rules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $claims['root_event_id'])
                ->lockForUpdate()
                ->first(['id']);
            $existing = DB::table(self::REVISION_TABLE)
                ->where('tenant_id', $tenantId)
                ->where('root_event_id', (int) $claims['root_event_id'])
                ->where('idempotency_hash', $idempotencyHash)
                ->lockForUpdate()
                ->first();
            if ($existing !== null) {
                if ($replayRoot === null
                    || $replayRule === null
                    || ! hash_equals((string) $existing->request_hash, $requestHash)
                    || ! hash_equals((string) $existing->patch_hash, $patchHash)
                    || (int) $existing->actor_user_id !== $actorId) {
                    throw new EventRecurrenceRevisionException('event_recurrence_revision_idempotency_conflict');
                }

                return $this->revisionResult($existing, true);
            }

            $this->assertRevisionRolloutEnabled();

            $context = $this->lockedContext(
                $tenantId,
                $occurrenceId,
                $actorId,
                true,
            );
            if ((int) $context['root']->id !== (int) $claims['root_event_id']
                || ! hash_equals(
                    (string) $context['selected']->recurrence_id,
                    (string) $claims['selected_recurrence_id'],
                )) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_token_scope_invalid');
            }

            if (now()->getTimestamp() > (int) ($claims['expires_at'] ?? 0)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_token_expired');
            }
            $this->assertCurrentPreviewState($context, $claims);
            // Resolve mutable tenant-owned references only for genuinely new
            // work, after the canonical series lock. A successful commit must
            // remain replayable even if a referenced category is later
            // retired or the rollout flag is switched off.
            $this->validateReferences($tenantId, $patch, true);

            $impact = $this->impact(
                $tenantId,
                $context['root'],
                $context['rule'],
                $context['selected'],
                $context['occurrences'],
                $patch,
            );
            if ($impact['blocking_conflicts'] !== []) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_resolution_required');
            }

            $rootId = (int) $context['root']->id;
            $revisionVersion = (int) ($context['rule']->effective_revision_version ?? 0) + 1;
            $materializedSetVersion = (int) ($context['rule']->materialized_set_version ?? 0) + 1;
            $rootSequence = max(0, (int) ($context['root']->calendar_sequence ?? 0)) + 1;
            $checksumBefore = $this->materializedChecksum($context['all_occurrences']);
            $changedEventIds = [];
            $notificationEventIds = [];
            $changedFields = [];
            $scheduleChangedEventIds = [];

            foreach ($context['occurrences'] as $row) {
                $projection = $this->projectRow($row, $patch);
                if ($projection['blocking_conflicts'] !== []) {
                    throw new EventRecurrenceRevisionException('event_recurrence_revision_resolution_required');
                }
                $changes = $projection['changes'];
                if ($changes === []) {
                    continue;
                }

                $event = Event::withoutGlobalScopes()
                    ->where('tenant_id', $tenantId)
                    ->whereKey((int) $row->id)
                    ->first();
                if ($event === null
                    || (int) $event->getAttribute('parent_event_id') !== $rootId
                    || (string) $event->getAttribute('recurrence_id') !== (string) $row->recurrence_id) {
                    throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
                }

                $nextSequence = max(0, (int) ($row->calendar_sequence ?? 0)) + 1;
                $nextFederationVersion = max(1, (int) ($row->federation_version ?? 1)) + 1;
                $event->forceFill(array_merge($changes, [
                    'calendar_sequence' => $nextSequence,
                    'federation_version' => $nextFederationVersion,
                    'updated_at' => now(),
                ]));
                $event->save();

                $changedEventIds[] = (int) $row->id;
                if ((string) ($row->publication_status ?? '') === 'published') {
                    $notificationEventIds[] = (int) $row->id;
                }
                foreach (array_keys($changes) as $field) {
                    $changedFields[$field] = true;
                }
                if (array_intersect(array_keys($changes), ['start_time', 'end_time', 'timezone']) !== []) {
                    $scheduleChangedEventIds[] = (int) $row->id;
                }
                $overrideFields = $this->overrideFields($row->recurrence_override_fields ?? null);
                $this->appendOccurrenceLedger(
                    $tenantId,
                    $rootId,
                    (int) $row->id,
                    (string) $row->recurrence_id,
                    (string) $row->occurrence_key,
                    $overrideFields === [] ? 'materialized' : 'customized',
                    $revisionVersion,
                    $actorId,
                    [
                        'source' => 'effective_revision',
                        'changed_fields' => array_values(array_keys($changes)),
                        'skipped_override_fields' => $projection['skipped_override_fields'],
                    ],
                    $event->getRawOriginal('start_time'),
                    $event->getRawOriginal('end_time'),
                );

                if ((bool) app(EventConfigurationService::class)->value(
                        'federation_sharing_enabled',
                        true,
                        $tenantId,
                    )
                    && (string) $event->getAttribute('federated_visibility') !== 'none'
                    && Schema::hasTable('event_federation_deliveries')
                    && Schema::hasTable('federation_external_partners')) {
                    app(EventFederationPublisher::class)->publish($event);
                }
            }

            $ruleUpdated = DB::table('event_recurrence_rules')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $rootId)
                ->where('effective_revision_version', $revisionVersion - 1)
                ->where('materialized_set_version', $materializedSetVersion - 1)
                ->update([
                    'effective_revision_version' => $revisionVersion,
                    'materialized_set_version' => $materializedSetVersion,
                    'updated_at' => now(),
                ]);
            if ($ruleUpdated !== 1) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
            }

            $rootUpdated = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', $rootId)
                ->where('calendar_sequence', $rootSequence - 1)
                ->update([
                    'calendar_sequence' => $rootSequence,
                    'federation_version' => max(
                        1,
                        (int) ($context['root']->federation_version ?? 1),
                    ) + 1,
                    'updated_at' => now(),
                ]);
            if ($rootUpdated !== 1) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
            }

            $freshRows = $this->seriesRows(
                $tenantId,
                $rootId,
                (string) $context['selected']->recurrence_id,
                true,
            );
            $checksumAfter = $this->materializedChecksum($freshRows);
            $recipientIds = $this->recipientIds($tenantId, $notificationEventIds);
            $impactSummary = [
                'candidate_count' => count($context['occurrences']),
                'changed_count' => count($changedEventIds),
                'changed_event_ids' => $changedEventIds,
                'unique_recipient_count' => (int) $impact['unique_recipient_count'],
                // This is intentionally distinct from the impact audience:
                // only recipients attached to published, changed concrete
                // occurrences are eligible for the aggregate notification.
                'notification_recipient_count' => count($recipientIds),
                'customized_conflict_count' => count($impact['customized_exception_conflicts']),
            ];
            $now = now();
            $revisionId = (int) DB::table(self::REVISION_TABLE)->insertGetId([
                'tenant_id' => $tenantId,
                'root_event_id' => $rootId,
                'revision_version' => $revisionVersion,
                'effective_from_recurrence_id' => (string) $context['selected']->recurrence_id,
                'effective_from_utc' => $this->recurrenceIdToUtc(
                    (string) $context['selected']->recurrence_id,
                ),
                'effective_until_recurrence_id' => null,
                'effective_until_utc' => null,
                'canonical_timezone' => (string) ($context['root']->timezone ?: 'UTC'),
                'canonical_rrule' => (string) $context['rule']->rrule,
                'rule_hash' => (string) $context['rule']->rule_hash,
                'blueprint_patch' => $this->canonicalJson($patch),
                'patch_hash' => $patchHash,
                'actor_user_id' => $actorId,
                'root_calendar_sequence' => $rootSequence,
                'rule_version' => $revisionVersion,
                'materialized_set_version' => $materializedSetVersion,
                'materialized_checksum_before' => $checksumBefore,
                'materialized_checksum_after' => $checksumAfter,
                'idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'impact_summary' => $this->canonicalJson($impactSummary),
                'previewed_at' => (string) $claims['previewed_at'],
                'created_at' => $now,
            ]);

            $outboxId = null;
            if ($notificationEventIds !== []
                && (string) ($context['root']->publication_status ?? '') === 'published') {
                $normalizedChangedFields = $this->notificationFields(array_keys($changedFields));
                if ($normalizedChangedFields !== []) {
                    $outbox = $this->outbox->record(
                        $tenantId,
                        $rootId,
                        $rootSequence,
                        'event.updated',
                        "event-recurrence-revision:{$tenantId}:{$rootId}:v{$revisionVersion}",
                        [
                            'schema_version' => 1,
                            'tenant_id' => $tenantId,
                            'event_id' => $rootId,
                            'actor_user_id' => $actorId,
                            'organizer_user_id' => (int) $context['root']->user_id,
                            'presentation_event_id' => (int) $notificationEventIds[0],
                            'calendar_sequence' => $rootSequence,
                            'changed_fields' => $normalizedChangedFields,
                            'recurrence_scope' => 'this_and_future',
                            'affected_recipient_user_ids' => $recipientIds,
                            'metadata' => [
                                'series' => [
                                    'root_event_id' => $rootId,
                                    'member_type' => 'template',
                                    'affected_event_ids' => $notificationEventIds,
                                    'recipient_count' => count($recipientIds),
                                    'effective_from_event_id' => (int) $context['selected']->id,
                                    'presentation_event_id' => (int) $notificationEventIds[0],
                                    'preference_event_id' => (int) $notificationEventIds[0],
                                    'revision_version' => $revisionVersion,
                                ],
                            ],
                            'occurred_at' => $now->toIso8601String(),
                        ],
                        EventNotificationDeliveryMode::OutboxAuthoritative,
                    );
                    $outboxId = (int) $outbox['id'];
                }
            }

            if ($scheduleChangedEventIds !== []) {
                $this->scheduleReminderReconciliation($tenantId, $scheduleChangedEventIds);
            }

            $stored = DB::table(self::REVISION_TABLE)->where('id', $revisionId)->first();
            if ($stored === null) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
            }
            $response = $this->revisionResult($stored, false);
            $response['changed_event_ids'] = $changedEventIds;
            $response['changed_count'] = count($changedEventIds);
            $response['notification_recipient_count'] = count($recipientIds);
            $response['notification_outbox_id'] = $outboxId;

            return $response;
        }, 5);

        return $result;
    }

    /**
     * Deterministic rolling-materializer integration point.
     *
     * @param array<string,mixed> $rootAttributes
     * @return array<string,mixed>
     */
    public function effectiveBlueprint(
        int $tenantId,
        int $rootId,
        string $recurrenceId,
        string $startUtc,
        array $rootAttributes,
    ): array {
        if ($tenantId <= 0
            || $rootId <= 0
            || ! $this->validRecurrenceId($recurrenceId)
            || ! Schema::hasTable(self::REVISION_TABLE)) {
            return $rootAttributes;
        }

        $revisions = DB::table(self::REVISION_TABLE)
            ->where('tenant_id', $tenantId)
            ->where('root_event_id', $rootId)
            ->where('effective_from_recurrence_id', '<=', $recurrenceId)
            ->where(static function (Builder $query) use ($recurrenceId): void {
                $query->whereNull('effective_until_recurrence_id')
                    ->orWhere('effective_until_recurrence_id', '>', $recurrenceId);
            })
            ->orderBy('revision_version')
            ->get(['blueprint_patch']);
        if ($revisions->isEmpty()) {
            return $rootAttributes;
        }

        $blueprint = $rootAttributes;
        $timezone = $this->safeTimezone((string) ($blueprint['timezone'] ?? 'UTC'));
        $date = (new DateTimeImmutable($startUtc, new DateTimeZone('UTC')))
            ->setTimezone($timezone)
            ->format('Y-m-d');
        $row = (object) array_merge($blueprint, [
            'occurrence_date' => $date,
            'recurrence_override_fields' => null,
        ]);

        foreach ($revisions as $revision) {
            $patch = $this->decodeJsonObject($revision->blueprint_patch ?? null);
            $projection = $this->projectRow($row, $patch);
            if ($projection['blocking_conflicts'] !== []) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_resolution_required');
            }
            $blueprint = array_merge($blueprint, $projection['changes']);
            $row = (object) array_merge((array) $row, $projection['changes']);
        }

        return $blueprint;
    }

    /**
     * Replay-safe append-only occurrence evidence for the rolling writer.
     *
     * @param array<string,mixed> $metadata
     */
    public function recordOccurrenceState(
        int $tenantId,
        int $rootId,
        int $eventId,
        string $recurrenceId,
        string $occurrenceKey,
        string $state = 'materialized',
        ?int $revisionVersion = null,
        ?int $actorUserId = null,
        array $metadata = [],
    ): void {
        if (! Schema::hasTable(self::OCCURRENCE_LEDGER)) {
            return;
        }
        if ($tenantId <= 0
            || $rootId <= 0
            || $eventId <= 0
            || ! $this->validRecurrenceId($recurrenceId)
            || ! in_array($state, ['materialized', 'customized', 'excluded', 'retired'], true)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_occurrence_identity_invalid');
        }

        DB::transaction(function () use (
            $tenantId,
            $rootId,
            $eventId,
            $recurrenceId,
            $occurrenceKey,
            $state,
            $revisionVersion,
            $actorUserId,
            $metadata,
        ): void {
            $event = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', $eventId)
                ->where('parent_event_id', $rootId)
                ->where('recurrence_id', $recurrenceId)
                ->where('occurrence_key', $occurrenceKey)
                ->first(['start_time', 'end_time']);
            if ($event === null) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_occurrence_identity_invalid');
            }
            $latest = DB::table(self::OCCURRENCE_LEDGER)
                ->where('tenant_id', $tenantId)
                ->where('root_event_id', $rootId)
                ->where('event_id', $eventId)
                ->orderByDesc('state_version')
                ->lockForUpdate()
                ->first();
            if ($latest !== null
                && ((string) $latest->recurrence_id !== $recurrenceId
                    || (string) $latest->occurrence_key !== $occurrenceKey)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_occurrence_identity_invalid');
            }
            if ($latest !== null
                && (string) $latest->state === $state
                && $this->nullableInt($latest->revision_version) === $revisionVersion
                && $this->nullableString($latest->start_time_utc) === $this->nullableString($event->start_time)
                && $this->nullableString($latest->end_time_utc) === $this->nullableString($event->end_time)) {
                return;
            }

            $this->appendOccurrenceLedger(
                $tenantId,
                $rootId,
                $eventId,
                $recurrenceId,
                $occurrenceKey,
                $state,
                $revisionVersion,
                $actorUserId,
                $metadata,
                $this->nullableString($event->start_time),
                $this->nullableString($event->end_time),
                $latest === null ? 1 : ((int) $latest->state_version + 1),
            );
            if ($latest === null) {
                $advanced = DB::table('event_recurrence_rules')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', $rootId)
                    ->increment('materialized_set_version', 1, ['updated_at' => now()]);
                if ($advanced !== 1) {
                    throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
                }
            }
        }, 3);
    }

    /**
     * @return array{root:object,rule:object,selected:object,occurrences:list<object>,all_occurrences:list<object>}
     */
    private function lockedContext(
        int $tenantId,
        int $occurrenceId,
        int $actorId,
        bool $exclusive,
    ): array {
        $this->assertSchema();
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->first();
        $selectedProbe = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($occurrenceId)
            ->first();
        if ($actor === null) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_actor_invalid');
        }
        if ($selectedProbe === null) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_not_found');
        }
        $rootId = (int) $selectedProbe->getAttribute('parent_event_id');
        if ($rootId <= 0
            || (bool) $selectedProbe->getAttribute('is_recurring_template')
            || (string) $selectedProbe->getAttribute('recurrence_engine') !== self::RULE_ENGINE
            || (string) $selectedProbe->getAttribute('recurrence_engine_version') !== self::RULE_ENGINE_VERSION
            || ! $this->validRecurrenceId((string) $selectedProbe->getAttribute('recurrence_id'))) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_concrete_occurrence_required');
        }

        $rootQuery = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $rootId);
        $root = $exclusive ? $rootQuery->lockForUpdate()->first() : $rootQuery->sharedLock()->first();
        if ($root === null
            || ! (bool) $root->is_recurring_template
            || (string) $root->recurrence_engine !== self::RULE_ENGINE
            || (string) $root->recurrence_engine_version !== self::RULE_ENGINE_VERSION) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_not_found');
        }

        $ruleQuery = DB::table('event_recurrence_rules')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $rootId);
        $rule = $exclusive ? $ruleQuery->lockForUpdate()->first() : $ruleQuery->sharedLock()->first();
        if ($rule === null
            || (string) $rule->recurrence_engine !== self::RULE_ENGINE
            || (string) $rule->recurrence_engine_version !== self::RULE_ENGINE_VERSION
            || ! is_string($rule->rule_hash)
            || preg_match('/^[0-9a-f]{64}$/D', $rule->rule_hash) !== 1) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_rule_invalid');
        }

        $boundary = (string) $selectedProbe->getAttribute('recurrence_id');
        $occurrences = $this->seriesRows($tenantId, $rootId, $boundary, $exclusive);
        $selected = collect($occurrences)->first(
            static fn (object $row): bool => (int) $row->id === $occurrenceId,
        );
        if ($selected === null
            || (string) $selected->recurrence_id !== (string) $selectedProbe->getAttribute('recurrence_id')) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_state_conflict');
        }

        $rootModel = Event::withoutGlobalScopes()->where('tenant_id', $tenantId)->whereKey($rootId)->first();
        $selectedModel = Event::withoutGlobalScopes()->where('tenant_id', $tenantId)->whereKey($occurrenceId)->first();
        if ($rootModel === null
            || $selectedModel === null
            || ! $this->policy->manage($actor, $rootModel)
            || ! $this->policy->manage($actor, $selectedModel)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_authorization_denied');
        }
        if ((string) ($root->publication_status ?? '') === 'pending_review'
            || collect($occurrences)->contains(
                static fn (object $row): bool => (string) ($row->publication_status ?? '') === 'pending_review',
            )) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_review_pending');
        }

        return [
            'root' => $root,
            'rule' => $rule,
            'selected' => $selected,
            'occurrences' => $occurrences,
            // The rule-level materialized_set_version fingerprints inserts and
            // retirements outside this bounded window. The checksum binds the
            // mutable rows at/after the selected boundary only, so long-lived
            // historical series remain revisable.
            'all_occurrences' => $occurrences,
        ];
    }

    /** @return list<object> */
    private function seriesRows(
        int $tenantId,
        int $rootId,
        string $boundaryRecurrenceId,
        bool $exclusive,
    ): array
    {
        $query = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('parent_event_id', $rootId)
            ->where('recurrence_engine', self::RULE_ENGINE)
            ->where('recurrence_engine_version', self::RULE_ENGINE_VERSION)
            ->whereNotNull('recurrence_id')
            ->where('recurrence_id', '>=', $boundaryRecurrenceId)
            ->orderBy('recurrence_id')
            ->orderBy('id')
            ->limit($this->maxAffectedOccurrences() + 1);
        $rows = $exclusive ? $query->lockForUpdate()->get() : $query->sharedLock()->get();
        if ($rows->count() > $this->maxAffectedOccurrences()) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_size_limit');
        }

        return $rows->all();
    }

    /**
     * @param list<object> $occurrences
     * @param array<string,mixed> $patch
     * @return array<string,mixed>
     */
    private function impact(
        int $tenantId,
        object $root,
        object $rule,
        object $selected,
        array $occurrences,
        array $patch,
    ): array {
        unset($root, $rule, $selected);
        $blocking = [];
        if (array_intersect(array_keys($patch), self::RULE_SHAPE_PATCH_FIELDS) !== []) {
            $blocking[] = ['code' => 'schedule_mapping_resolution_required'];
        }
        foreach (array_intersect(array_keys($patch), self::UNSUPPORTED_EFFECTIVE_FIELDS) as $field) {
            $blocking[] = [
                'code' => 'unsupported_effective_field',
                'field' => $field,
            ];
        }

        $affectedIds = [];
        $changedIds = [];
        $moved = [];
        $customized = [];
        $occupancy = array_key_exists('max_attendees', $patch)
            && $patch['max_attendees'] !== null
            ? $this->committedOccupancyByEvent(
                $tenantId,
                array_map(static fn (object $row): int => (int) $row->id, $occurrences),
            )
            : [];
        foreach ($occurrences as $row) {
            $affectedIds[] = (int) $row->id;
            $projection = $this->projectRow($row, $patch);
            foreach ($projection['blocking_conflicts'] as $conflict) {
                $blocking[] = array_merge(['event_id' => (int) $row->id], $conflict);
            }
            if ($projection['skipped_override_fields'] !== []) {
                $customized[] = [
                    'event_id' => (int) $row->id,
                    'skipped_fields' => $projection['skipped_override_fields'],
                ];
            }
            if ($projection['changes'] === []) {
                continue;
            }
            if (array_key_exists('max_attendees', $projection['changes'])
                && $projection['changes']['max_attendees'] !== null
                && (int) $projection['changes']['max_attendees'] < (int) ($occupancy[(int) $row->id] ?? 0)) {
                $blocking[] = [
                    'event_id' => (int) $row->id,
                    'code' => 'capacity_below_committed_occupancy',
                ];
            }
            $changedIds[] = (int) $row->id;
            if (array_intersect(
                array_keys($projection['changes']),
                ['start_time', 'end_time', 'timezone'],
            ) !== []) {
                $moved[] = [
                    'event_id' => (int) $row->id,
                    'occurrence_date' => (string) $row->occurrence_date,
                    'from_start_utc' => (string) $row->start_time,
                    'from_end_utc' => $this->nullableString($row->end_time),
                    'to_start_utc' => (string) ($projection['changes']['start_time'] ?? $row->start_time),
                    'to_end_utc' => array_key_exists('end_time', $projection['changes'])
                        ? $projection['changes']['end_time']
                        : $this->nullableString($row->end_time),
                ];
            }
        }

        $metrics = $this->participantMetrics($tenantId, $changedIds);

        return [
            'affected_event_ids' => $affectedIds,
            'affected_count' => count($affectedIds),
            'changed_event_ids' => $changedIds,
            'changed_count' => count($changedIds),
            'moved_occurrences' => $moved,
            'created_occurrences' => [],
            'retired_occurrences' => [],
            'registrations_count' => $metrics['registrations_count'],
            'waitlist_count' => $metrics['waitlist_count'],
            'ticket_count' => $metrics['ticket_count'],
            'reminder_count' => $metrics['reminder_count'],
            'unique_recipient_count' => $metrics['unique_recipient_count'],
            'customized_exception_conflicts' => $customized,
            'blocking_conflicts' => array_values($blocking),
        ];
    }

    /**
     * @param array<string,mixed> $patch
     * @return array{changes:array<string,mixed>,skipped_override_fields:list<string>,blocking_conflicts:list<array<string,string>>}
     */
    private function projectRow(object $row, array $patch): array
    {
        $overrides = $this->overrideFields($row->recurrence_override_fields ?? null);
        $changes = [];
        $skipped = [];
        $blocking = [];

        foreach (self::DIRECT_PATCH_FIELDS as $field) {
            if (! array_key_exists($field, $patch)) {
                continue;
            }
            if (in_array($field, $overrides, true)) {
                $skipped[] = $field;
                continue;
            }
            $value = $patch[$field];
            if (! $this->valuesEquivalent($row->{$field} ?? null, $value)) {
                $changes[$field] = $value;
            }
        }

        $scheduleRequested = array_intersect(array_keys($patch), self::SCHEDULE_PATCH_FIELDS) !== [];
        if ($scheduleRequested) {
            $currentTimezone = $this->safeTimezone((string) ($row->timezone ?? 'UTC'));
            $timezoneOverridden = in_array('timezone', $overrides, true);
            $targetTimezoneName = $timezoneOverridden
                ? $currentTimezone->getName()
                : (string) ($patch['timezone'] ?? $currentTimezone->getName());
            $targetTimezone = $this->safeTimezone($targetTimezoneName);
            if (array_key_exists('timezone', $patch) && $timezoneOverridden) {
                $skipped[] = 'timezone';
            } elseif ($targetTimezoneName !== $currentTimezone->getName()) {
                $changes['timezone'] = $targetTimezoneName;
            }

            $currentStart = new DateTimeImmutable((string) $row->start_time, new DateTimeZone('UTC'));
            $currentStartLocal = $currentStart->setTimezone($currentTimezone);
            $startOverridden = in_array('start_time', $overrides, true);
            if ($startOverridden
                && (array_key_exists('local_start_time', $patch)
                    || array_key_exists('timezone', $patch))) {
                $skipped[] = 'start_time';
            }
            $targetStart = $currentStart;
            if (! $startOverridden) {
                $startClock = (string) ($patch['local_start_time'] ?? $currentStartLocal->format('H:i:s'));
                $resolved = $this->resolveWallTime(
                    (string) $row->occurrence_date,
                    $startClock,
                    $targetTimezone,
                );
                if ($resolved['conflict'] !== null) {
                    $blocking[] = ['code' => $resolved['conflict'], 'field' => 'local_start_time'];
                } else {
                    $targetStart = $resolved['instant'];
                    $targetStartUtc = $targetStart->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                    if ($targetStartUtc !== (string) $row->start_time) {
                        $changes['start_time'] = $targetStartUtc;
                    }
                }
            }

            $endOverridden = in_array('end_time', $overrides, true);
            if ($endOverridden
                && (array_key_exists('local_end_time', $patch)
                    || array_key_exists('local_start_time', $patch)
                    || array_key_exists('timezone', $patch))) {
                $skipped[] = 'end_time';
            } elseif (! $endOverridden) {
                $currentEnd = ($row->end_time ?? null) !== null
                    ? new DateTimeImmutable((string) $row->end_time, new DateTimeZone('UTC'))
                    : null;
                if (array_key_exists('local_end_time', $patch)) {
                    if ($patch['local_end_time'] === null) {
                        if ($currentEnd !== null) {
                            $changes['end_time'] = null;
                        }
                    } else {
                        $endDate = (string) $row->occurrence_date;
                        $endClock = (string) $patch['local_end_time'];
                        $startClock = $targetStart->setTimezone($targetTimezone)->format('H:i:s');
                        if ($endClock <= $startClock) {
                            $endDate = (new DateTimeImmutable($endDate, $targetTimezone))
                                ->modify('+1 day')->format('Y-m-d');
                        }
                        $resolvedEnd = $this->resolveWallTime($endDate, $endClock, $targetTimezone);
                        if ($resolvedEnd['conflict'] !== null) {
                            $blocking[] = ['code' => $resolvedEnd['conflict'], 'field' => 'local_end_time'];
                        } else {
                            $endUtc = $resolvedEnd['instant']->setTimezone(new DateTimeZone('UTC'))
                                ->format('Y-m-d H:i:s');
                            if ($endUtc !== $this->nullableString($row->end_time ?? null)) {
                                $changes['end_time'] = $endUtc;
                            }
                        }
                    }
                } elseif ($currentEnd !== null && isset($changes['start_time'])) {
                    $duration = max(0, $currentEnd->getTimestamp() - $currentStart->getTimestamp());
                    $endUtc = $targetStart->modify("+{$duration} seconds")
                        ->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d H:i:s');
                    if ($endUtc !== (string) $row->end_time) {
                        $changes['end_time'] = $endUtc;
                    }
                }
            }
        }

        $effectiveLatitude = array_key_exists('latitude', $changes)
            ? $changes['latitude']
            : ($row->latitude ?? null);
        $effectiveLongitude = array_key_exists('longitude', $changes)
            ? $changes['longitude']
            : ($row->longitude ?? null);
        if (($effectiveLatitude === null) !== ($effectiveLongitude === null)) {
            $blocking[] = ['code' => 'coordinate_pair_required', 'field' => 'latitude'];
        }

        $accessibilityFields = [
            'accessibility_step_free',
            'accessibility_toilet',
            'accessibility_hearing_loop',
            'accessibility_quiet_space',
            'accessibility_seating',
            'accessibility_parking',
            'accessibility_parking_details',
            'accessibility_transit_details',
            'accessibility_assistance_contact',
            'accessibility_notes',
        ];
        $hasAccessibilityFacts = false;
        foreach ($accessibilityFields as $field) {
            $effective = array_key_exists($field, $changes)
                ? $changes[$field]
                : ($row->{$field} ?? null);
            $hasAccessibilityFacts = $hasAccessibilityFacts || $effective !== null;
        }
        $effectiveLocation = array_key_exists('location', $changes)
            ? $changes['location']
            : ($row->location ?? null);
        if ($hasAccessibilityFacts && ($effectiveLocation === null || trim((string) $effectiveLocation) === '')) {
            $blocking[] = ['code' => 'venue_location_required', 'field' => 'location'];
        }

        $effectiveAllDay = array_key_exists('all_day', $changes)
            ? (bool) $changes['all_day']
            : (bool) ($row->all_day ?? false);
        if ($effectiveAllDay) {
            $effectiveTimezone = $this->safeTimezone((string) (
                $changes['timezone'] ?? ($row->timezone ?? 'UTC')
            ));
            $effectiveStart = new DateTimeImmutable(
                (string) ($changes['start_time'] ?? $row->start_time),
                new DateTimeZone('UTC'),
            );
            $effectiveEndValue = array_key_exists('end_time', $changes)
                ? $changes['end_time']
                : ($row->end_time ?? null);
            $effectiveEnd = $effectiveEndValue !== null
                ? new DateTimeImmutable((string) $effectiveEndValue, new DateTimeZone('UTC'))
                : null;
            if ($effectiveStart->setTimezone($effectiveTimezone)->format('H:i:s') !== '00:00:00'
                || $effectiveEnd === null
                || $effectiveEnd <= $effectiveStart
                || $effectiveEnd->setTimezone($effectiveTimezone)->format('H:i:s') !== '00:00:00') {
                $blocking[] = ['code' => 'all_day_boundary_invalid', 'field' => 'all_day'];
            }
        }

        $skipped = array_values(array_unique($skipped));
        sort($skipped);

        return [
            'changes' => $changes,
            'skipped_override_fields' => $skipped,
            'blocking_conflicts' => $blocking,
        ];
    }

    /** @return array{instant:DateTimeImmutable,conflict:?string} */
    private function resolveWallTime(string $date, string $time, DateTimeZone $timezone): array
    {
        $wall = "{$date} {$time}";
        $naive = DateTimeImmutable::createFromFormat(
            '!Y-m-d H:i:s',
            $wall,
            new DateTimeZone('UTC'),
        );
        if (! $naive instanceof DateTimeImmutable || $naive->format('Y-m-d H:i:s') !== $wall) {
            return ['instant' => new DateTimeImmutable('@0'), 'conflict' => 'wall_time_nonexistent'];
        }

        $offsets = [];
        foreach ($timezone->getTransitions(
            $naive->getTimestamp() - 172800,
            $naive->getTimestamp() + 172800,
        ) ?: [] as $transition) {
            $offsets[(int) $transition['offset']] = true;
        }
        $candidates = [];
        foreach (array_keys($offsets) as $offset) {
            $candidate = (new DateTimeImmutable('@' . ($naive->getTimestamp() - $offset)))
                ->setTimezone($timezone);
            if ($candidate->format('Y-m-d H:i:s') === $wall) {
                $candidates[$candidate->getTimestamp()] = $candidate;
            }
        }
        if ($candidates === []) {
            return ['instant' => new DateTimeImmutable('@0'), 'conflict' => 'wall_time_nonexistent'];
        }
        if (count($candidates) > 1) {
            return ['instant' => reset($candidates), 'conflict' => 'wall_time_ambiguous'];
        }

        return ['instant' => reset($candidates), 'conflict' => null];
    }

    /** @param list<object> $rows */
    private function materializedChecksum(array $rows): string
    {
        $projection = [];
        foreach ($rows as $row) {
            $projection[] = [
                'id' => (int) $row->id,
                'recurrence_id' => (string) $row->recurrence_id,
                'occurrence_key' => (string) $row->occurrence_key,
                'start_time' => (string) $row->start_time,
                'end_time' => $this->nullableString($row->end_time),
                'calendar_sequence' => (int) ($row->calendar_sequence ?? 0),
                'lifecycle_version' => (int) ($row->lifecycle_version ?? 0),
                'override_version' => (int) ($row->recurrence_override_version ?? 0),
                'override_fields' => $this->overrideFields($row->recurrence_override_fields ?? null),
                'publication_status' => (string) ($row->publication_status ?? ''),
                'operational_status' => (string) ($row->operational_status ?? ''),
            ];
        }

        return $this->hash($projection);
    }

    /** @param list<int> $eventIds @return array<int,int> */
    private function committedOccupancyByEvent(int $tenantId, array $eventIds): array
    {
        $occupancy = array_fill_keys($eventIds, 0);
        if ($eventIds === []) {
            return $occupancy;
        }
        if (Schema::hasTable('event_registrations')) {
            $rows = DB::table('event_registrations')
                ->select('event_id')
                ->selectRaw('COALESCE(SUM(party_size), 0) AS occupied')
                ->where('tenant_id', $tenantId)
                ->whereIn('event_id', $eventIds)
                ->where('registration_state', 'confirmed')
                ->groupBy('event_id')
                ->get();
            foreach ($rows as $row) {
                $occupancy[(int) $row->event_id] = max(
                    $occupancy[(int) $row->event_id] ?? 0,
                    (int) $row->occupied,
                );
            }
        }
        if (Schema::hasTable('event_rsvps')) {
            $rows = DB::table('event_rsvps')
                ->select('event_id')
                ->selectRaw('COUNT(*) AS occupied')
                ->where('tenant_id', $tenantId)
                ->whereIn('event_id', $eventIds)
                ->where('status', 'going')
                ->groupBy('event_id')
                ->get();
            foreach ($rows as $row) {
                $occupancy[(int) $row->event_id] = max(
                    $occupancy[(int) $row->event_id] ?? 0,
                    (int) $row->occupied,
                );
            }
        }
        if (Schema::hasTable('event_ticket_entitlements')) {
            $rows = DB::table('event_ticket_entitlements')
                ->select('event_id')
                ->selectRaw('COALESCE(SUM(units), 0) AS occupied')
                ->where('tenant_id', $tenantId)
                ->whereIn('event_id', $eventIds)
                ->where('status', 'confirmed')
                ->groupBy('event_id')
                ->get();
            foreach ($rows as $row) {
                $occupancy[(int) $row->event_id] = max(
                    $occupancy[(int) $row->event_id] ?? 0,
                    (int) $row->occupied,
                );
            }
        }

        return $occupancy;
    }

    /**
     * @param list<int> $eventIds
     * @return array{registrations_count:int,waitlist_count:int,ticket_count:int,reminder_count:int,unique_recipient_count:int}
     */
    private function participantMetrics(int $tenantId, array $eventIds): array
    {
        if ($eventIds === []) {
            return [
                'registrations_count' => 0,
                'waitlist_count' => 0,
                'ticket_count' => 0,
                'reminder_count' => 0,
                'unique_recipient_count' => 0,
            ];
        }
        $registrations = 0;
        $waitlist = 0;
        $tickets = 0;
        $reminders = 0;
        if (Schema::hasTable('event_registrations')) {
            $registrations = DB::table('event_registrations')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->whereIn('registration_state', ['invited', 'pending', 'confirmed'])->count();
        }
        if (Schema::hasTable('event_rsvps')) {
            $registrations += DB::table('event_rsvps')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->whereIn('status', ['going', 'interested', 'maybe', 'invited', 'waitlisted'])->count();
        }
        if (Schema::hasTable('event_waitlist_entries')) {
            $waitlist = DB::table('event_waitlist_entries')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->whereIn('queue_state', ['waiting', 'offered'])->count();
        }
        if (Schema::hasTable('event_waitlist')) {
            $waitlist += DB::table('event_waitlist')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->where('status', 'waiting')->count();
        }
        if (Schema::hasTable('event_ticket_entitlements')) {
            $tickets = DB::table('event_ticket_entitlements')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->where('status', 'confirmed')->sum('units');
        }
        if (Schema::hasTable('event_reminder_schedules')) {
            $reminders = DB::table('event_reminder_schedules')
                ->where('tenant_id', $tenantId)->whereIn('event_id', $eventIds)
                ->whereIn('status', ['pending', 'queued'])->count();
        }

        return [
            'registrations_count' => (int) $registrations,
            'waitlist_count' => (int) $waitlist,
            'ticket_count' => (int) $tickets,
            'reminder_count' => (int) $reminders,
            'unique_recipient_count' => count($this->recipientIds($tenantId, $eventIds)),
        ];
    }

    /** @param list<int> $eventIds @return list<int> */
    private function recipientIds(int $tenantId, array $eventIds): array
    {
        if ($eventIds === []) {
            return [];
        }
        $ids = collect();
        foreach ([
            ['event_registrations', 'registration_state', ['invited', 'pending', 'confirmed']],
            ['event_rsvps', 'status', ['going', 'interested', 'maybe', 'invited', 'waitlisted']],
            ['event_waitlist_entries', 'queue_state', ['waiting', 'offered']],
            ['event_waitlist', 'status', ['waiting']],
            ['event_staff_assignments', 'status', ['active']],
        ] as [$table, $stateColumn, $states]) {
            if (! Schema::hasTable($table)) {
                continue;
            }
            $ids = $ids->merge(DB::table($table)
                ->where('tenant_id', $tenantId)
                ->whereIn('event_id', $eventIds)
                ->whereIn($stateColumn, $states)
                ->pluck('user_id'));
        }

        return $ids->map(static fn (mixed $id): int => (int) $id)
            ->filter(static fn (int $id): bool => $id > 0)
            ->unique()->sort()->values()->all();
    }

    /** @param array<string,mixed> $claims */
    private function assertTokenRequestScope(
        array $claims,
        int $tenantId,
        int $actorId,
        int $occurrenceId,
        string $patchHash,
    ): void {
        foreach ([
            'tenant_id',
            'actor_user_id',
            'root_event_id',
            'selected_event_id',
            'root_calendar_sequence',
            'rule_version',
            'revision_version',
            'materialized_set_version',
        ] as $claim) {
            if (! is_int($claims[$claim] ?? null)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_token_invalid');
            }
        }
        foreach ([
            'selected_recurrence_id',
            'patch_hash',
            'rule_hash',
            'materialized_checksum',
            'previewed_at',
        ] as $claim) {
            if (! is_string($claims[$claim] ?? null) || $claims[$claim] === '') {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_token_invalid');
            }
        }
        if ((int) $claims['tenant_id'] !== $tenantId
            || (int) $claims['actor_user_id'] !== $actorId
            || (int) $claims['selected_event_id'] !== $occurrenceId
            || ! hash_equals((string) $claims['patch_hash'], $patchHash)
            || ! $this->validRecurrenceId((string) $claims['selected_recurrence_id'])) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_token_scope_invalid');
        }
    }

    /** @param array<string,mixed> $claims @param array<string,mixed> $context */
    private function assertCurrentPreviewState(array $context, array $claims): void
    {
        $checksum = $this->materializedChecksum($context['all_occurrences']);
        if ((int) ($context['root']->calendar_sequence ?? 0) !== (int) $claims['root_calendar_sequence']
            || (string) $context['rule']->rule_hash !== (string) $claims['rule_hash']
            || (int) ($context['rule']->effective_revision_version ?? 0) !== (int) $claims['rule_version']
            || (int) ($context['rule']->effective_revision_version ?? 0) !== (int) $claims['revision_version']
            || (int) ($context['rule']->materialized_set_version ?? 0) !== (int) $claims['materialized_set_version']
            || ! hash_equals($checksum, (string) $claims['materialized_checksum'])) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_preview_stale');
        }
    }

    /** @return array<string,mixed> */
    private function revisionResult(object $row, bool $replay): array
    {
        $impact = $this->decodeJsonObject($row->impact_summary ?? null);
        $outboxId = DB::table('event_domain_outbox')
            ->where('tenant_id', (int) $row->tenant_id)
            ->where('idempotency_key', sprintf(
                'event-recurrence-revision:%d:%d:v%d',
                (int) $row->tenant_id,
                (int) $row->root_event_id,
                (int) $row->revision_version,
            ))
            ->value('id');

        return [
            'revision_id' => (int) $row->id,
            'root_event_id' => (int) $row->root_event_id,
            'revision_version' => (int) $row->revision_version,
            'effective_from_utc' => (string) $row->effective_from_utc,
            'changed_event_ids' => array_values(array_map(
                'intval',
                is_array($impact['changed_event_ids'] ?? null)
                    ? $impact['changed_event_ids']
                    : [],
            )),
            'changed_count' => (int) ($impact['changed_count'] ?? 0),
            'notification_recipient_count' => (int) (
                $impact['notification_recipient_count']
                    ?? $impact['unique_recipient_count']
                    ?? 0
            ),
            'notification_outbox_id' => $outboxId !== null ? (int) $outboxId : null,
            'idempotent_replay' => $replay,
            'created_at' => (string) $row->created_at,
        ];
    }

    /**
     * @param array<string,mixed> $metadata
     */
    private function appendOccurrenceLedger(
        int $tenantId,
        int $rootId,
        int $eventId,
        string $recurrenceId,
        string $occurrenceKey,
        string $state,
        ?int $revisionVersion,
        ?int $actorUserId,
        array $metadata,
        mixed $startTime,
        mixed $endTime,
        ?int $knownStateVersion = null,
    ): void {
        $stateVersion = $knownStateVersion ?? ((int) DB::table(self::OCCURRENCE_LEDGER)
            ->where('tenant_id', $tenantId)
            ->where('root_event_id', $rootId)
            ->where('event_id', $eventId)
            ->lockForUpdate()
            ->max('state_version') + 1);
        DB::table(self::OCCURRENCE_LEDGER)->insert([
            'tenant_id' => $tenantId,
            'root_event_id' => $rootId,
            'event_id' => $eventId,
            'recurrence_id' => $recurrenceId,
            'occurrence_key' => $occurrenceKey,
            'state' => $state,
            'state_version' => max(1, $stateVersion),
            'revision_version' => $revisionVersion,
            'start_time_utc' => $this->nullableString($startTime),
            'end_time_utc' => $this->nullableString($endTime),
            'actor_user_id' => $actorUserId,
            'metadata' => $this->canonicalJson($metadata),
            'created_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $rawPatch @return array<string,mixed> */
    private function normalizePatch(array $rawPatch): array
    {
        $allowed = array_merge(
            self::DIRECT_PATCH_FIELDS,
            self::SCHEDULE_PATCH_FIELDS,
            self::RULE_SHAPE_PATCH_FIELDS,
            self::UNSUPPORTED_EFFECTIVE_FIELDS,
        );
        foreach (array_keys($rawPatch) as $field) {
            if (! is_string($field) || ! in_array($field, $allowed, true)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
            }
        }
        if ($rawPatch === [] || count($rawPatch) > 32) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        // Same rule as EventService: the public-listing choice is only
        // accepted while the community advertises events publicly.
        if (! TenantContext::hasFeature('public_events')) {
            unset($rawPatch['is_public_listing']);
        }

        $patch = [];
        foreach ($rawPatch as $field => $value) {
            $patch[$field] = match ($field) {
                'title' => $this->requiredString($value, 255),
                'description' => $this->requiredString($value, 10000, false),
                'location' => $this->nullableTrimmedString($value, 255),
                'online_link' => $this->nullableHttpUrl($value),
                'video_url' => $this->nullableHttpUrl($value),
                'latitude' => $this->nullableCoordinate($value, -90.0, 90.0),
                'longitude' => $this->nullableCoordinate($value, -180.0, 180.0),
                'max_attendees' => $this->nullablePositiveInt($value),
                'category_id' => $this->nullablePositiveInt($value),
                'is_online', 'allow_remote_attendance', 'is_public_listing', 'all_day' => $this->normalizeBoolean($value),
                'accessibility_step_free',
                'accessibility_toilet',
                'accessibility_hearing_loop',
                'accessibility_quiet_space',
                'accessibility_seating',
                'accessibility_parking' => $this->normalizeNullableBoolean($value),
                'accessibility_parking_details',
                'accessibility_transit_details' => $this->nullableTrimmedString($value, 1000),
                'accessibility_assistance_contact' => $this->nullableTrimmedString($value, 500),
                'accessibility_notes' => $this->nullableTrimmedString($value, 4000),
                'timezone' => $this->safeTimezone((string) $value)->getName(),
                'local_start_time' => $this->normalizeClock($value, false),
                'local_end_time' => $this->normalizeClock($value, true),
                'recurrence_rrule' => $this->requiredString($value, 2048),
                'recurrence_exdates', 'recurrence_rdates' => $this->normalizeStringList($value),
                'group_id', 'series_id' => $this->nullablePositiveInt($value),
                'poll_ids' => $this->normalizePositiveIntList($value),
                'image_url', 'cover_image' => $this->nullableTrimmedString($value, 512),
                'federated_visibility' => $this->requiredString($value, 16),
                default => throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid'),
            };
        }
        ksort($patch);

        return $patch;
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_tenant_required');
        }
        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_feature_disabled');
            }
        } catch (EventRecurrenceRevisionException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_feature_disabled');
        }

        return $tenantId;
    }

    private function assertSchema(): void
    {
        foreach ([self::REVISION_TABLE, self::OCCURRENCE_LEDGER] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_schema_unavailable');
            }
        }
        foreach (['effective_revision_version', 'materialized_set_version'] as $column) {
            if (! Schema::hasColumn('event_recurrence_rules', $column)) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_schema_unavailable');
            }
        }
    }

    private function assertRevisionRolloutEnabled(): void
    {
        if (! (bool) config('events.recurrence.engine_v2_enabled', false)) {
            throw new EventRecurrenceRevisionException(
                'event_recurrence_revision_rollout_disabled',
            );
        }
    }

    private function recurrenceIdToUtc(string $recurrenceId): string
    {
        $date = DateTimeImmutable::createFromFormat(
            '!Ymd\THis\Z',
            $recurrenceId,
            new DateTimeZone('UTC'),
        );
        if (! $date instanceof DateTimeImmutable
            || $date->format('Ymd\THis\Z') !== $recurrenceId) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_occurrence_identity_invalid');
        }

        return $date->format('Y-m-d H:i:s');
    }

    private function validRecurrenceId(string $recurrenceId): bool
    {
        return preg_match('/^[0-9]{8}T[0-9]{6}Z$/D', $recurrenceId) === 1;
    }

    /** @return list<string> */
    private function overrideFields(mixed $value): array
    {
        if ($value === null || $value === '') {
            return [];
        }
        if (is_string($value)) {
            try {
                $value = json_decode($value, true, 64, JSON_THROW_ON_ERROR);
            } catch (JsonException) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_override_invalid');
            }
        }
        if (! is_array($value) || ! array_is_list($value)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_override_invalid');
        }
        $fields = [];
        foreach ($value as $field) {
            if (! is_string($field) || $field === '' || mb_strlen($field) > 64) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_override_invalid');
            }
            $fields[] = $field;
        }
        $fields = array_values(array_unique($fields));
        sort($fields);

        return $fields;
    }

    /** @return array<string,mixed> */
    private function decodeJsonObject(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (! is_string($value) || $value === '') {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_evidence_invalid');
        }
        try {
            $decoded = json_decode($value, true, 64, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_evidence_invalid');
        }
        if (! is_array($decoded)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_evidence_invalid');
        }

        return $decoded;
    }

    /** @param array<string,mixed>|list<mixed> $value */
    private function hash(array $value): string
    {
        return hash('sha256', $this->canonicalJson($value));
    }

    private function canonicalJson(mixed $value): string
    {
        $normalized = $this->canonicalize($value);
        try {
            return json_encode(
                $normalized,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            );
        } catch (JsonException) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_evidence_invalid');
        }
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
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

    private function safeTimezone(string $timezone): DateTimeZone
    {
        try {
            return new DateTimeZone(trim($timezone));
        } catch (Throwable) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_timezone_invalid');
        }
    }

    private function requiredString(mixed $value, int $max, bool $nonEmpty = true): string
    {
        if (! is_string($value) || mb_strlen($value) > $max) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $value = trim($value);
        if ($nonEmpty && $value === '') {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }

        return $value;
    }

    private function nullableTrimmedString(mixed $value, int $max): ?string
    {
        if ($value === null) {
            return null;
        }
        if (! is_string($value) || mb_strlen($value) > $max) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }

    private function nullableHttpUrl(mixed $value): ?string
    {
        $url = $this->nullableTrimmedString($value, 512);
        if ($url === null) {
            return null;
        }
        $parts = parse_url($url);
        if (filter_var($url, FILTER_VALIDATE_URL) === false
            || ! is_array($parts)
            || ! in_array(strtolower((string) ($parts['scheme'] ?? '')), ['http', 'https'], true)
            || trim((string) ($parts['host'] ?? '')) === '') {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }

        return $url;
    }

    private function normalizeBoolean(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        if (is_int($value) && in_array($value, [0, 1], true)) {
            return $value === 1;
        }

        throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
    }

    private function normalizeNullableBoolean(mixed $value): ?bool
    {
        return $value === null ? null : $this->normalizeBoolean($value);
    }

    private function nullableCoordinate(mixed $value, float $minimum, float $maximum): ?float
    {
        if ($value === null) {
            return null;
        }
        if (! is_int($value) && ! is_float($value) && ! is_string($value)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        if (! is_numeric($value)) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $coordinate = (float) $value;
        if (! is_finite($coordinate) || $coordinate < $minimum || $coordinate > $maximum) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }

        return $coordinate;
    }

    private function nullablePositiveInt(mixed $value): ?int
    {
        if ($value === null) {
            return null;
        }
        if (! is_int($value) || $value <= 0) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }

        return $value;
    }

    /** @param array<string,mixed> $patch */
    private function validateReferences(
        int $tenantId,
        array $patch,
        bool $lockForUpdate = false,
    ): void
    {
        $categoryId = $patch['category_id'] ?? null;
        if ($categoryId === null) {
            return;
        }
        if (! Schema::hasTable('categories')
            || ! Schema::hasColumn('categories', 'tenant_id')) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $query = DB::table('categories')
            ->where('tenant_id', $tenantId)
            ->where('id', (int) $categoryId);
        if (Schema::hasColumn('categories', 'type')) {
            $query->whereIn('type', ['event', 'events']);
        }
        if (Schema::hasColumn('categories', 'is_active')) {
            $query->where('is_active', 1);
        }
        if ($lockForUpdate) {
            $query->lockForUpdate();
        }
        if (! $query->exists()) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
    }

    private function normalizeClock(mixed $value, bool $nullable): ?string
    {
        if ($nullable && $value === null) {
            return null;
        }
        if (! is_string($value)
            || preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/D', $value) !== 1) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }

        return strlen($value) === 5 ? $value . ':00' : $value;
    }

    /** @return list<string> */
    private function normalizeStringList(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > 500) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $result = [];
        foreach ($value as $item) {
            if (! is_string($item) || trim($item) === '' || mb_strlen($item) > 64) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
            }
            $result[] = trim($item);
        }
        sort($result);

        return array_values(array_unique($result));
    }

    /** @return list<int> */
    private function normalizePositiveIntList(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) > 100) {
            throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
        }
        $result = [];
        foreach ($value as $item) {
            if (! is_int($item) || $item <= 0) {
                throw new EventRecurrenceRevisionException('event_recurrence_revision_patch_invalid');
            }
            $result[] = $item;
        }
        sort($result);

        return array_values(array_unique($result));
    }

    private function valuesEquivalent(mixed $current, mixed $target): bool
    {
        if ($target === null) {
            return $current === null || $current === '';
        }
        if (is_bool($target)) {
            return (bool) $current === $target;
        }
        if (is_int($target)) {
            return (int) $current === $target;
        }

        return (string) $current === (string) $target;
    }

    /** @param list<string> $fields @return list<string> */
    private function notificationFields(array $fields): array
    {
        $normalized = [];
        foreach ($fields as $field) {
            $normalized[] = match ($field) {
                'latitude', 'longitude' => 'location',
                'video_url' => 'online_link',
                'accessibility_step_free',
                'accessibility_toilet',
                'accessibility_hearing_loop',
                'accessibility_quiet_space',
                'accessibility_seating',
                'accessibility_parking',
                'accessibility_parking_details',
                'accessibility_transit_details',
                'accessibility_assistance_contact',
                'accessibility_notes' => 'venue_accessibility',
                default => $field,
            };
        }
        $normalized = array_values(array_unique(array_filter(
            $normalized,
            static fn (string $field): bool => in_array($field, [
                'title',
                'start_time',
                'end_time',
                'timezone',
                'all_day',
                'location',
                'is_online',
                'online_link',
                'allow_remote_attendance',
                'max_attendees',
                'venue_accessibility',
            ], true),
        )));
        sort($normalized);

        return $normalized;
    }

    /** @param list<int> $eventIds */
    private function scheduleReminderReconciliation(int $tenantId, array $eventIds): void
    {
        DB::afterCommit(static function () use ($tenantId, $eventIds): void {
            TenantContext::runForTenant($tenantId, static function () use ($eventIds): void {
                $service = app(EventReminderScheduleService::class);
                foreach (array_values(array_unique($eventIds)) as $eventId) {
                    $service->reconcileEventSchedule($eventId);
                }
            });
        });
    }

    private function maxAffectedOccurrences(): int
    {
        return max(1, min((int) config(
            'events.recurrence.revisions.max_affected_occurrences',
            1000,
        ), 5000));
    }

    private function previewTtlSeconds(): int
    {
        return max(60, min((int) config(
            'events.recurrence.revisions.preview_ttl_seconds',
            600,
        ), 3600));
    }

    private function nullableString(mixed $value): ?string
    {
        return $value === null ? null : (string) $value;
    }

    private function nullableInt(mixed $value): ?int
    {
        return $value === null ? null : (int) $value;
    }
}
