<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Payload-free, read-only operational health snapshot for the Events module.
 *
 * High-cardinality identifiers, notification payloads and reminder recipients
 * intentionally never leave this service. Operators receive only aggregate
 * counts and ages; events:integrity-audit remains the controlled diagnostic.
 */
final class EventHealthService
{
    public function __construct(
        private readonly EventIntegrityAuditService $integrityAudit,
        private readonly EventNotificationOutboxDiagnostics $outboxDiagnostics,
        private readonly EventRecurrenceMaterializationService $recurrenceMaterializer,
    ) {}

    /** @return array<string,mixed> */
    public function snapshot(?int $tenantId = null, int $maxOverdueSeconds = 600): array
    {
        $maxOverdueSeconds = max(60, min($maxOverdueSeconds, 86_400));
        $integrity = $this->integrityAudit->run($tenantId, 1);
        $outbox = $this->outboxDiagnostics->snapshot($tenantId);
        $domainOutbox = $this->domainOutboxOwnershipSnapshot($tenantId);
        $reminders = $this->reminderSnapshot($tenantId);
        $waitlist = $this->waitlistSnapshot($tenantId, $maxOverdueSeconds);
        $recurrence = $this->recurrenceSnapshot($tenantId);
        $requiredSchema = $this->requiredSchemaSnapshot();

        $integrityCodes = [];
        foreach ((array) ($integrity['issues'] ?? []) as $issue) {
            if (! is_array($issue)) {
                continue;
            }
            $integrityCodes[(string) $issue['code']] = [
                'severity' => (string) $issue['severity'],
                'count' => (int) $issue['count'],
            ];
        }
        ksort($integrityCodes);

        $deliveryConfiguration = EventNotificationDeliveryModeResolver::inspect($tenantId);
        $deliveryMode = $deliveryConfiguration['resolved_mode'];
        $deliveryConfigurationInvalid = ! $deliveryConfiguration['global_configuration_valid']
            || $deliveryConfiguration['tenant_configuration_valid'] === false
            || $deliveryConfiguration['tenant_override_lookup_failed'];
        $channelConfigurationInvalid = ! (bool) ($outbox['channel_configuration']['valid'] ?? false);
        $authoritativeConsumerMisconfigured = $deliveryMode === 'outbox_authoritative'
            && ! (bool) ($outbox['consumer_enabled'] ?? false);
        $notificationUnhealthy = ! (bool) ($outbox['schema_available'] ?? false)
            || (int) ($outbox['dead_lettered'] ?? 0) > 0
            || (int) ($outbox['terminal_delivery_failures'] ?? 0) > 0
            || (int) ($outbox['stale_processing'] ?? 0) > 0
            || (int) ($outbox['oldest_deliverable_age_seconds'] ?? 0) > $maxOverdueSeconds
            || $deliveryConfigurationInvalid
            || $channelConfigurationInvalid
            || $authoritativeConsumerMisconfigured;
        $reminderUnhealthy = ! $reminders['schema_available']
            || $reminders['oldest_overdue_age_seconds'] > $maxOverdueSeconds;
        $waitlistUnhealthy = ! $waitlist['schema_available']
            || $waitlist['overdue_expired_active_offers'] > 0;
        $domainOutboxUnhealthy = ! $domainOutbox['schema_available']
            || $domainOutbox['unowned_authoritative_facts'] > 0
            || $domainOutbox['invalid_authoritative_statuses'] > 0;
        $schemaUnhealthy = $requiredSchema['missing'] !== [];
        $healthy = ! (bool) $integrity['blocking']
            && ! $notificationUnhealthy
            && ! $reminderUnhealthy
            && ! $waitlistUnhealthy
            && ! $domainOutboxUnhealthy
            && ! $recurrence['unhealthy']
            && ! $schemaUnhealthy;

        return [
            'read_only' => true,
            'payload_free' => true,
            'generated_at' => now()->toIso8601String(),
            'tenant_id' => $tenantId,
            'healthy' => $healthy,
            'max_overdue_seconds' => $maxOverdueSeconds,
            'schema' => $requiredSchema,
            'integrity' => [
                'blocking' => (bool) $integrity['blocking'],
                'issue_types' => (int) $integrity['issue_types'],
                'critical_rows' => (int) $integrity['issues_by_severity']['critical'],
                'warning_rows' => (int) $integrity['issues_by_severity']['warning'],
                'issues' => $integrityCodes,
            ],
            'notifications' => [
                ...$outbox,
                'delivery_mode' => $deliveryMode,
                'delivery_configuration' => $deliveryConfiguration,
                'delivery_configuration_invalid' => $deliveryConfigurationInvalid,
                'channel_configuration_invalid' => $channelConfigurationInvalid,
                'authoritative_consumer_misconfigured' => $authoritativeConsumerMisconfigured,
                'unhealthy' => $notificationUnhealthy,
            ],
            'domain_outbox' => [
                ...$domainOutbox,
                'unhealthy' => $domainOutboxUnhealthy,
            ],
            'reminders' => [
                ...$reminders,
                'unhealthy' => $reminderUnhealthy,
            ],
            'waitlist' => [
                ...$waitlist,
                'unhealthy' => $waitlistUnhealthy,
            ],
            'recurrence' => $recurrence,
        ];
    }

    /** @return array<string,mixed> */
    private function recurrenceSnapshot(?int $tenantId): array
    {
        $configuration = $this->recurrenceMaterializer->configuration();
        $schemaAvailable = $this->recurrenceMaterializer->schemaAvailable();
        $snapshot = [
            'schema_available' => $schemaAvailable,
            'configuration' => $configuration,
            'active_v2_never' => 0,
            'paused_pending_review' => 0,
            'paused_postponed' => 0,
            'due' => 0,
            'overdue' => 0,
            'failed' => 0,
            'active_legacy_never_blockers' => 0,
            'rule_contract_violations' => 0,
            'child_lifecycle_divergence' => 0,
            'child_engine_divergence' => 0,
            'occurrence_identity_gaps' => 0,
            'recurrence_identity_violations' => 0,
            'v2_missing_recurrence_id' => 0,
            'override_evidence_violations' => 0,
            'occurrence_ledger_gaps' => 0,
            'occurrence_ledger_stale' => 0,
            'revision_version_drift' => 0,
            'oldest_heartbeat_age_seconds' => 0,
            'rollout_state' => 'schema_unavailable',
            'v2_continuity_blocked' => false,
            'unhealthy' => ! $schemaAvailable || ! $configuration['valid'],
        ];
        $evidence = $this->recurrenceEvidenceSnapshot($tenantId);
        $snapshot = array_merge($snapshot, $evidence);
        $snapshot['unhealthy'] = $snapshot['unhealthy']
            || $snapshot['recurrence_identity_violations'] > 0
            || $snapshot['v2_missing_recurrence_id'] > 0
            || $snapshot['override_evidence_violations'] > 0;
        if (! $schemaAvailable || ! $configuration['valid']) {
            return $snapshot;
        }

        $active = DB::table('event_recurrence_rules as rule')
            ->join('events as root', function ($join): void {
                $join->on('root.id', '=', 'rule.event_id')
                    ->on('root.tenant_id', '=', 'rule.tenant_id');
            })
            ->where('rule.ends_type', 'never')
            ->where('root.is_recurring_template', 1)
            ->where('root.publication_status', '!=', 'archived')
            ->whereNotIn('root.operational_status', ['cancelled', 'completed'])
            ->when($tenantId !== null, static fn ($query) => $query->where('rule.tenant_id', $tenantId));
        $v2 = (clone $active)
            ->where('rule.recurrence_engine', EventRecurrenceService::ENGINE)
            ->where('rule.recurrence_engine_version', EventRecurrenceService::ENGINE_VERSION)
            ->where('root.recurrence_engine', EventRecurrenceService::ENGINE)
            ->where('root.recurrence_engine_version', EventRecurrenceService::ENGINE_VERSION);
        $legacy = (clone $active)->where(function ($engine): void {
            $engine->whereNull('rule.recurrence_engine')
                ->orWhere('rule.recurrence_engine', '!=', EventRecurrenceService::ENGINE)
                ->orWhereNull('rule.recurrence_engine_version')
                ->orWhere('rule.recurrence_engine_version', '!=', EventRecurrenceService::ENGINE_VERSION)
                ->orWhereNull('root.recurrence_engine')
                ->orWhere('root.recurrence_engine', '!=', EventRecurrenceService::ENGINE)
                ->orWhereNull('root.recurrence_engine_version')
                ->orWhere('root.recurrence_engine_version', '!=', EventRecurrenceService::ENGINE_VERSION);
        });

        $eligibleV2 = (clone $v2)
            ->whereIn('root.publication_status', ['draft', 'published'])
            ->where('root.operational_status', 'scheduled');
        $target = now()->addDays($configuration['lookahead_days']);
        $dueBefore = $target->copy()->subDays($configuration['refresh_margin_days']);
        $heartbeatBefore = now()->subHours($configuration['overdue_grace_hours']);
        $due = (clone $eligibleV2)
            ->where(function ($coverage) use ($dueBefore): void {
                $coverage->whereNotNull('rule.materialization_resume_at')
                    ->orWhereNull('rule.materialized_through_at')
                    ->orWhere('rule.materialized_through_at', '<', $dueBefore);
            });
        $overdue = (clone $due)->where(function ($heartbeat) use ($heartbeatBefore): void {
            $heartbeat->where(function ($attempted) use ($heartbeatBefore): void {
                $attempted->whereNotNull('rule.materialization_last_attempted_at')
                    ->where('rule.materialization_last_attempted_at', '<=', $heartbeatBefore);
            })->orWhere(function ($neverAttempted) use ($heartbeatBefore): void {
                $neverAttempted->whereNull('rule.materialization_last_attempted_at')
                    ->where(function ($created) use ($heartbeatBefore): void {
                        $created->whereNull('rule.created_at')
                            ->orWhere('rule.created_at', '<=', $heartbeatBefore);
                    });
            });
        });
        $failed = (clone $eligibleV2)->whereNotNull('rule.materialization_error_code');

        $ruleContract = DB::table('event_recurrence_rules as rule')
            ->leftJoin('events as root', 'root.id', '=', 'rule.event_id')
            ->when($tenantId !== null, static fn ($query) => $query->where('rule.tenant_id', $tenantId))
            ->where(function ($invalid): void {
                $invalid->whereNull('root.id')
                    ->orWhereColumn('root.tenant_id', '!=', 'rule.tenant_id')
                    ->orWhere('root.is_recurring_template', '!=', 1);
            });
        $duplicateRuleGroups = DB::table('event_recurrence_rules as duplicate_rule')
            ->when($tenantId !== null, static fn ($query) => $query->where('duplicate_rule.tenant_id', $tenantId))
            ->groupBy('duplicate_rule.tenant_id', 'duplicate_rule.event_id')
            ->havingRaw('COUNT(*) > 1')
            ->select(['duplicate_rule.tenant_id', 'duplicate_rule.event_id']);
        $childBase = DB::table('events as child')
            ->join('events as root', function ($join): void {
                $join->on('root.id', '=', 'child.parent_event_id')
                    ->on('root.tenant_id', '=', 'child.tenant_id');
            })
            ->whereNotNull('child.parent_event_id')
            ->when($tenantId !== null, static fn ($query) => $query->where('child.tenant_id', $tenantId));
        $v2Children = (clone $childBase)
            ->where('child.recurrence_engine', EventRecurrenceService::ENGINE)
            ->where('child.recurrence_engine_version', EventRecurrenceService::ENGINE_VERSION);
        $ledgerGaps = (clone $v2Children)
            ->leftJoin('event_recurrence_occurrence_ledger as occurrence_ledger', function ($join): void {
                $join->on('occurrence_ledger.tenant_id', '=', 'child.tenant_id')
                    ->on('occurrence_ledger.root_event_id', '=', 'child.parent_event_id')
                    ->on('occurrence_ledger.event_id', '=', 'child.id')
                    ->on('occurrence_ledger.recurrence_id', '=', 'child.recurrence_id');
            })
            ->whereNull('occurrence_ledger.id');
        $latestLedgerVersions = DB::table('event_recurrence_occurrence_ledger')
            ->select(['tenant_id', 'root_event_id', 'event_id'])
            ->selectRaw('MAX(state_version) AS state_version')
            ->groupBy('tenant_id', 'root_event_id', 'event_id');
        $staleLedger = (clone $v2Children)
            ->joinSub($latestLedgerVersions, 'latest_ledger_version', function ($join): void {
                $join->on('latest_ledger_version.tenant_id', '=', 'child.tenant_id')
                    ->on('latest_ledger_version.root_event_id', '=', 'child.parent_event_id')
                    ->on('latest_ledger_version.event_id', '=', 'child.id');
            })
            ->join('event_recurrence_occurrence_ledger as latest_ledger', function ($join): void {
                $join->on('latest_ledger.tenant_id', '=', 'latest_ledger_version.tenant_id')
                    ->on('latest_ledger.root_event_id', '=', 'latest_ledger_version.root_event_id')
                    ->on('latest_ledger.event_id', '=', 'latest_ledger_version.event_id')
                    ->on('latest_ledger.state_version', '=', 'latest_ledger_version.state_version');
            })
            ->where(function ($stale): void {
                $stale->whereRaw('NOT (latest_ledger.start_time_utc <=> child.start_time)')
                    ->orWhereRaw('NOT (latest_ledger.end_time_utc <=> child.end_time)')
                    ->orWhere(function ($state): void {
                        $state->where(function ($customized): void {
                            $customized->where(function ($evidence): void {
                                $evidence->where('child.is_recurrence_exception', 1)
                                    ->orWhere('child.recurrence_override_version', '>', 0);
                            })->where('latest_ledger.state', '!=', 'customized');
                        })->orWhere(function ($materialized): void {
                            $materialized->where('child.is_recurrence_exception', 0)
                                ->where('child.recurrence_override_version', 0)
                                ->where('latest_ledger.state', '!=', 'materialized');
                        });
                    });
            });
        $maxRevision = DB::table('event_recurrence_revisions')
            ->select(['tenant_id', 'root_event_id'])
            ->selectRaw('MAX(revision_version) AS revision_version')
            ->groupBy('tenant_id', 'root_event_id');
        $revisionDrift = DB::table('event_recurrence_rules as versioned_rule')
            ->leftJoinSub($maxRevision, 'latest_revision', function ($join): void {
                $join->on('latest_revision.tenant_id', '=', 'versioned_rule.tenant_id')
                    ->on('latest_revision.root_event_id', '=', 'versioned_rule.event_id');
            })
            ->whereRaw('versioned_rule.effective_revision_version <> COALESCE(latest_revision.revision_version, 0)')
            ->when($tenantId !== null, static fn ($query) => $query->where('versioned_rule.tenant_id', $tenantId));

        $oldestHeartbeat = (clone $v2)->min('rule.materialization_last_attempted_at');
        $snapshot['active_v2_never'] = (clone $v2)->count();
        $snapshot['paused_pending_review'] = (clone $v2)
            ->where('root.publication_status', 'pending_review')
            ->count();
        $snapshot['paused_postponed'] = (clone $v2)
            ->where('root.operational_status', 'postponed')
            ->count();
        $snapshot['due'] = (clone $due)->count();
        $snapshot['overdue'] = (clone $overdue)->count();
        $snapshot['failed'] = (clone $failed)->count();
        $snapshot['active_legacy_never_blockers'] = (clone $legacy)->count();
        $snapshot['rule_contract_violations'] = (clone $ruleContract)->count()
            + DB::query()->fromSub($duplicateRuleGroups, 'duplicate_recurrence_rule_groups')->count();
        $snapshot['child_lifecycle_divergence'] = (clone $childBase)
            ->where(function ($different): void {
                $different->whereNull('child.publication_status')
                    ->orWhereNull('child.operational_status')
                    ->orWhere(function ($publication): void {
                        $publication->where('root.publication_status', 'draft')
                            ->where('child.publication_status', 'published');
                    })
                    ->orWhere(function ($publication): void {
                        $publication->where('root.publication_status', 'pending_review')
                            ->whereNotIn('child.publication_status', ['pending_review', 'archived']);
                    })
                    ->orWhere(function ($publication): void {
                        $publication->where('root.publication_status', 'published')
                            ->whereIn('child.publication_status', ['draft', 'pending_review']);
                    })
                    ->orWhere(function ($publication): void {
                        $publication->where('root.publication_status', 'archived')
                            ->where('child.publication_status', '!=', 'archived');
                    })
                    ->orWhere(function ($operational): void {
                        $operational->whereIn('root.operational_status', ['cancelled', 'completed'])
                            ->whereIn('child.operational_status', ['scheduled', 'postponed']);
                    });
            })
            ->count();
        $snapshot['child_engine_divergence'] = (clone $childBase)
            ->where(function ($different): void {
                $different->whereColumn('child.recurrence_engine', '!=', 'root.recurrence_engine')
                    ->orWhereColumn('child.recurrence_engine_version', '!=', 'root.recurrence_engine_version')
                    ->orWhereNull('child.recurrence_engine')
                    ->orWhereNull('child.recurrence_engine_version');
            })
            ->count();
        $snapshot['occurrence_identity_gaps'] = (clone $v2Children)
            ->where(function ($missing): void {
                $missing->whereNull('child.recurrence_id')
                    ->orWhereRaw("child.recurrence_id NOT REGEXP '^[0-9]{8}T[0-9]{6}Z$'");
            })
            ->distinct()
            ->count('child.id');
        $snapshot['occurrence_ledger_gaps'] = (clone $ledgerGaps)
            ->distinct()
            ->count('child.id');
        $snapshot['occurrence_ledger_stale'] = (clone $staleLedger)
            ->distinct()
            ->count('child.id');
        $snapshot['revision_version_drift'] = (clone $revisionDrift)->count();
        $snapshot['oldest_heartbeat_age_seconds'] = $this->ageInSeconds($oldestHeartbeat);
        $rolloutEnabled = $configuration['enabled'] && $configuration['engine_v2_writer_enabled'];
        // 🔴 The v2 writer is now PERMANENTLY on — the legacy engine has been
        // removed, so engine_v2_enabled defaults true and no longer gates
        // creation. "Writer on, materialization off" is therefore the NORMAL
        // resting state, not a mixed one; treating it as misconfigured reported
        // every installation as unhealthy the moment the engine switch went on.
        // The one genuinely incoherent combination remains: materialization ON
        // with the writer OFF, which would run the cron with nothing able to
        // write. That still falls through to 'misconfigured' below.
        $rolloutDisabled = ! $configuration['enabled'];
        $snapshot['v2_continuity_blocked'] = ! $rolloutEnabled
            && (clone $eligibleV2)->count() > 0;
        $snapshot['rollout_state'] = $rolloutEnabled
            ? 'enabled'
            : ($rolloutDisabled
                ? ($snapshot['v2_continuity_blocked'] ? 'disabled_with_v2_roots' : 'disabled')
                : 'misconfigured');
        $snapshot['unhealthy'] = ! $configuration['valid']
            || (! $rolloutEnabled && ! $rolloutDisabled)
            || $snapshot['v2_continuity_blocked']
            || $snapshot['overdue'] > 0
            || $snapshot['failed'] > 0
            || ($rolloutEnabled && $snapshot['active_legacy_never_blockers'] > 0)
            || $snapshot['rule_contract_violations'] > 0
            || $snapshot['child_lifecycle_divergence'] > 0
            || $snapshot['child_engine_divergence'] > 0;
        $snapshot['unhealthy'] = $snapshot['unhealthy']
            || $snapshot['occurrence_identity_gaps'] > 0
            || $snapshot['recurrence_identity_violations'] > 0
            || $snapshot['v2_missing_recurrence_id'] > 0
            || $snapshot['override_evidence_violations'] > 0
            || $snapshot['occurrence_ledger_gaps'] > 0
            || $snapshot['occurrence_ledger_stale'] > 0
            || $snapshot['revision_version_drift'] > 0;

        return $snapshot;
    }

    /**
     * Validate the recurrence identity and override evidence that materializers
     * rely on. This intentionally returns counts only: no event or actor
     * identifiers leave the health boundary.
     *
     * @return array{recurrence_identity_violations:int,v2_missing_recurrence_id:int,override_evidence_violations:int}
     */
    private function recurrenceEvidenceSnapshot(?int $tenantId): array
    {
        $empty = [
            'recurrence_identity_violations' => 0,
            'v2_missing_recurrence_id' => 0,
            'override_evidence_violations' => 0,
        ];
        $required = [
            'recurrence_id',
            'is_recurrence_exception',
            'recurrence_override_fields',
            'recurrence_override_version',
            'recurrence_override_updated_at',
            'recurrence_override_updated_by',
        ];
        if (! Schema::hasTable('events')) {
            return $empty;
        }
        foreach ($required as $column) {
            if (! Schema::hasColumn('events', $column)) {
                return $empty;
            }
        }

        $counts = $empty;
        $query = DB::table('events')
            ->when($tenantId !== null, static fn ($builder) => $builder->where('tenant_id', $tenantId))
            ->where(static function ($relevant): void {
                $relevant->whereNotNull('parent_event_id')
                    ->orWhereNotNull('recurrence_id')
                    ->orWhere('is_recurrence_exception', 1)
                    ->orWhereNotNull('recurrence_override_fields')
                    ->orWhere('recurrence_override_version', '>', 0)
                    ->orWhereNotNull('recurrence_override_updated_at')
                    ->orWhereNotNull('recurrence_override_updated_by');
            })
            ->select([
                'id',
                'tenant_id',
                'parent_event_id',
                'is_recurring_template',
                'recurrence_engine',
                'recurrence_engine_version',
                'recurrence_id',
                'is_recurrence_exception',
                'recurrence_override_fields',
                'recurrence_override_version',
                'recurrence_override_updated_at',
                'recurrence_override_updated_by',
            ]);

        $query->chunkById(500, function ($rows) use (&$counts): void {
            $parentIdsByTenant = [];
            $actorIdsByTenant = [];
            foreach ($rows as $row) {
                $rowTenantId = (int) $row->tenant_id;
                $parentId = max(0, (int) ($row->parent_event_id ?? 0));
                $actorId = max(0, (int) ($row->recurrence_override_updated_by ?? 0));
                if ($parentId > 0) {
                    $parentIdsByTenant[$rowTenantId][$parentId] = true;
                }
                if ($actorId > 0) {
                    $actorIdsByTenant[$rowTenantId][$actorId] = true;
                }
            }

            $validParents = [];
            $validActors = [];
            foreach ($parentIdsByTenant as $rowTenantId => $parentSet) {
                foreach (DB::table('events')
                    ->where('tenant_id', (int) $rowTenantId)
                    ->whereIn('id', array_keys($parentSet))
                    ->where('is_recurring_template', 1)
                    ->pluck('id') as $parentId) {
                    $validParents[(int) $rowTenantId][(int) $parentId] = true;
                }
            }
            foreach ($actorIdsByTenant as $rowTenantId => $actorSet) {
                foreach (DB::table('users')
                    ->where('tenant_id', (int) $rowTenantId)
                    ->whereIn('id', array_keys($actorSet))
                    ->pluck('id') as $actorId) {
                    $validActors[(int) $rowTenantId][(int) $actorId] = true;
                }
            }

            foreach ($rows as $row) {
                $rowTenantId = (int) $row->tenant_id;
                $parentId = max(0, (int) ($row->parent_event_id ?? 0));
                $recurrenceId = $row->recurrence_id === null
                    ? null
                    : trim((string) $row->recurrence_id);
                $isV2Concrete = $parentId > 0
                    && (string) ($row->recurrence_engine ?? '') === EventRecurrenceService::ENGINE
                    && (string) ($row->recurrence_engine_version ?? '') === EventRecurrenceService::ENGINE_VERSION;
                if ($isV2Concrete && ($recurrenceId === null || $recurrenceId === '')) {
                    $counts['v2_missing_recurrence_id']++;
                }
                if ($recurrenceId !== null && (
                    preg_match('/^[0-9]{8}T[0-9]{6}Z$/D', $recurrenceId) !== 1
                    || $parentId <= 0
                    || (bool) $row->is_recurring_template
                    || ! $isV2Concrete
                    || ! isset($validParents[$rowTenantId][$parentId])
                )) {
                    $counts['recurrence_identity_violations']++;
                }

                $isException = (bool) $row->is_recurrence_exception;
                $version = (int) ($row->recurrence_override_version ?? 0);
                $actorId = max(0, (int) ($row->recurrence_override_updated_by ?? 0));
                $hasUpdatedAt = $row->recurrence_override_updated_at !== null;
                $rawFields = $row->recurrence_override_fields;
                $fields = null;
                if (is_string($rawFields) && trim($rawFields) !== '') {
                    try {
                        $decoded = json_decode($rawFields, true, 64, JSON_THROW_ON_ERROR);
                        $fields = is_array($decoded) ? $decoded : null;
                    } catch (\JsonException) {
                        $fields = null;
                    }
                } elseif (is_array($rawFields)) {
                    $fields = $rawFields;
                }
                $validFields = is_array($fields)
                    && $fields !== []
                    && array_is_list($fields);
                if ($validFields) {
                    $seenFields = [];
                    foreach ($fields as $field) {
                        if (! is_string($field)
                            || isset($seenFields[$field])
                            || ! in_array($field, EventService::RECURRENCE_OVERRIDE_FIELD_ALLOWLIST, true)) {
                            $validFields = false;
                            break;
                        }
                        $seenFields[$field] = true;
                    }
                }
                $consistentException = $isException
                    && is_string($recurrenceId)
                    && preg_match('/^[0-9]{8}T[0-9]{6}Z$/D', $recurrenceId) === 1
                    && $parentId > 0
                    && isset($validParents[$rowTenantId][$parentId])
                    && $validFields
                    && $version > 0
                    && $hasUpdatedAt
                    && $actorId > 0
                    && isset($validActors[$rowTenantId][$actorId]);
                $consistentOrdinary = ! $isException
                    && $rawFields === null
                    && $version === 0
                    && ! $hasUpdatedAt
                    && $actorId === 0;
                if (! $consistentException && ! $consistentOrdinary) {
                    $counts['override_evidence_violations']++;
                }
            }
        }, 'id');

        return $counts;
    }

    /**
     * @return array{
     *   schema_available:bool,
     *   unowned_authoritative_facts:int,
     *   oldest_unowned_age_seconds:int,
     *   invalid_authoritative_statuses:int,
     *   oldest_invalid_status_age_seconds:int
     * }
     */
    private function domainOutboxOwnershipSnapshot(?int $tenantId): array
    {
        if (! Schema::hasTable('event_domain_outbox')
            || ! Schema::hasColumn('event_domain_outbox', 'action')
            || ! Schema::hasColumn('event_domain_outbox', 'production_mode')
            || ! Schema::hasColumn('event_domain_outbox', 'status')) {
            return [
                'schema_available' => false,
                'unowned_authoritative_facts' => 0,
                'oldest_unowned_age_seconds' => 0,
                'invalid_authoritative_statuses' => 0,
                'oldest_invalid_status_age_seconds' => 0,
            ];
        }

        // Only the notification consumer is active in this rollout. An
        // authoritative fact outside its exact ownership boundary has no
        // worker and must block cutover instead of aging silently forever.
        $unowned = DB::table('event_domain_outbox')
            ->whereIn('status', ['pending', 'processing', 'dead_letter'])
            ->when($tenantId !== null, static fn ($query) => $query->where('tenant_id', $tenantId));
        EventNotificationOutboxScope::applyUnowned($unowned);
        $oldest = (clone $unowned)->min('created_at');
        $invalidStatus = DB::table('event_domain_outbox')
            ->where('production_mode', 'outbox_authoritative')
            ->where(static function ($status): void {
                $status->whereNull('status')
                    ->orWhereNotIn('status', ['pending', 'processing', 'processed', 'dead_letter']);
            })
            ->when($tenantId !== null, static fn ($query) => $query->where('tenant_id', $tenantId));
        $oldestInvalid = (clone $invalidStatus)->min('created_at');

        return [
            'schema_available' => true,
            'unowned_authoritative_facts' => (clone $unowned)->count(),
            'oldest_unowned_age_seconds' => $this->ageInSeconds($oldest),
            'invalid_authoritative_statuses' => (clone $invalidStatus)->count(),
            'oldest_invalid_status_age_seconds' => $this->ageInSeconds($oldestInvalid),
        ];
    }

    /** @return array{schema_available:bool,overdue_pending:int,oldest_overdue_age_seconds:int} */
    private function reminderSnapshot(?int $tenantId): array
    {
        if (! Schema::hasTable('event_reminders')
            || ! Schema::hasColumn('event_reminders', 'scheduled_for')
            || ! Schema::hasColumn('event_reminders', 'status')) {
            return [
                'schema_available' => false,
                'overdue_pending' => 0,
                'oldest_overdue_age_seconds' => 0,
            ];
        }

        $due = DB::table('event_reminders')
            ->where('status', 'pending')
            ->where('scheduled_for', '<=', now())
            ->when($tenantId !== null, static fn ($query) => $query->where('tenant_id', $tenantId));
        $oldest = (clone $due)->min('scheduled_for');

        return [
            'schema_available' => true,
            'overdue_pending' => (clone $due)->count(),
            'oldest_overdue_age_seconds' => $this->ageInSeconds($oldest),
        ];
    }

    /**
     * @return array{
     *   schema_available:bool,
     *   expired_active_offers:int,
     *   overdue_expired_active_offers:int,
     *   oldest_expiry_age_seconds:int
     * }
     */
    private function waitlistSnapshot(?int $tenantId, int $maxOverdueSeconds): array
    {
        if (! Schema::hasTable('event_waitlist_entries')
            || ! Schema::hasColumn('event_waitlist_entries', 'queue_state')
            || ! Schema::hasColumn('event_waitlist_entries', 'offer_expires_at')) {
            return [
                'schema_available' => false,
                'expired_active_offers' => 0,
                'overdue_expired_active_offers' => 0,
                'oldest_expiry_age_seconds' => 0,
            ];
        }

        $expired = DB::table('event_waitlist_entries')
            ->where('queue_state', 'offered')
            ->whereNotNull('offer_expires_at')
            ->where('offer_expires_at', '<=', now())
            ->when($tenantId !== null, static fn ($query) => $query->where('tenant_id', $tenantId));
        $oldest = (clone $expired)->min('offer_expires_at');
        $overdue = (clone $expired)
            ->where('offer_expires_at', '<=', now()->subSeconds($maxOverdueSeconds));

        return [
            'schema_available' => true,
            'expired_active_offers' => (clone $expired)->count(),
            'overdue_expired_active_offers' => $overdue->count(),
            'oldest_expiry_age_seconds' => $this->ageInSeconds($oldest),
        ];
    }

    /** @return array{available:list<string>,missing:list<string>} */
    private function requiredSchemaSnapshot(): array
    {
        $required = [
            'events',
            'event_domain_outbox',
            'event_notification_deliveries',
            'event_notification_outbox_replays',
            'event_status_history',
            'event_series',
            'event_recurrence_rules',
            'event_recurrence_revisions',
            'event_recurrence_occurrence_ledger',
            'event_registrations',
            'event_registration_history',
            'event_waitlist_entries',
            'event_waitlist_entry_history',
            'event_waitlist_offer_envelopes',
            'event_waitlist_offer_envelope_access',
            'event_reminders',
            'event_attendance',
            'event_attendance_activity',
            'event_attendance_credit_claims',
            'event_staff_assignments',
            'event_staff_assignment_history',
            'event_calendar_feed_tokens',
        ];
        $available = [];
        $missing = [];
        foreach ($required as $table) {
            if (Schema::hasTable($table)) {
                $available[] = $table;
            } else {
                $missing[] = $table;
            }
        }

        return ['available' => $available, 'missing' => $missing];
    }

    private function ageInSeconds(mixed $timestamp): int
    {
        if ($timestamp === null || $timestamp === '') {
            return 0;
        }

        $instant = CarbonImmutable::parse((string) $timestamp);

        return max(0, now()->getTimestamp() - $instant->getTimestamp());
    }
}
