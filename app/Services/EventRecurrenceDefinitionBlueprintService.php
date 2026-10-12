<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\EventRecurrenceDefinitionBlueprintException;
use App\Exceptions\EventRecurrenceRevisionException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use JsonException;
use App\Support\Authorization\ManagerDelegate;

/**
 * Explicit, versioned definition capture for newly materialized V2 occurrences.
 *
 * Manifests contain configuration only. Participant, transaction, delivery,
 * attendance, reminder and analytics facts are outside this boundary.
 */
final class EventRecurrenceDefinitionBlueprintService
{
    public const SCHEMA_VERSION = 1;
    public const BLUEPRINTS = 'event_recurrence_definition_blueprints';
    public const APPLICATIONS = 'event_recurrence_definition_applications';

    /** @var list<string> */
    private const SECTION_ORDER = [
        'agenda',
        'ticket_types',
        'registration',
        'safety',
        'staff',
    ];

    /** @var array<string,list<string>> */
    private const SECTION_TABLES = [
        'agenda' => [
            'event_sessions', 'event_session_speakers',
            'event_session_resources', 'event_session_history',
        ],
        'ticket_types' => ['event_ticket_types', 'event_ticket_type_history'],
        'registration' => [
            'event_registration_settings', 'event_registration_settings_history',
            'event_registration_form_versions', 'event_registration_form_questions',
        ],
        'safety' => [
            'event_safety_requirements', 'event_safety_requirement_versions',
            'event_safety_requirement_history',
        ],
        'staff' => ['event_staff_assignments', 'event_staff_assignment_history'],
    ];

    private ?bool $schemaAvailableCache = null;

    public function __construct(
        private readonly EventPolicy $policy,
        private readonly EventRecurrenceRevisionTokenService $tokens,
    ) {}

    public function schemaAvailable(): bool
    {
        if ($this->schemaAvailableCache !== null) {
            return $this->schemaAvailableCache;
        }
        try {
            $columns = [
                self::BLUEPRINTS => [
                    'id', 'tenant_id', 'root_event_id', 'source_event_id',
                    'source_recurrence_id', 'source_occurrence_key', 'blueprint_version',
                    'schema_version', 'effective_from_recurrence_id', 'selected_sections',
                    'manifest', 'manifest_hash', 'idempotency_hash', 'request_hash',
                    'captured_by_user_id', 'created_at',
                ],
                self::APPLICATIONS => [
                    'id', 'tenant_id', 'root_event_id', 'event_id', 'recurrence_id',
                    'blueprint_id', 'blueprint_version', 'manifest_hash',
                    'application_hash', 'applied_counts', 'status',
                    'applied_by_user_id', 'created_at',
                ],
            ];
            foreach ($columns as $table => $required) {
                if (! Schema::hasTable($table)) {
                    return $this->schemaAvailableCache = false;
                }
                foreach ($required as $column) {
                    if (! Schema::hasColumn($table, $column)) {
                        return $this->schemaAvailableCache = false;
                    }
                }
            }

            $triggers = [
                'trg_ev_rec_def_bp_no_update' => [self::BLUEPRINTS, 'UPDATE'],
                'trg_ev_rec_def_bp_no_delete' => [self::BLUEPRINTS, 'DELETE'],
                'trg_ev_rec_def_app_no_update' => [self::APPLICATIONS, 'UPDATE'],
                'trg_ev_rec_def_app_no_delete' => [self::APPLICATIONS, 'DELETE'],
            ];
            foreach ($triggers as $name => [$table, $operation]) {
                if (! DB::table('information_schema.triggers')
                    ->where('trigger_schema', DB::getDatabaseName())
                    ->where('trigger_name', $name)
                    ->where('event_object_table', $table)
                    ->where('event_manipulation', $operation)
                    ->exists()) {
                    return $this->schemaAvailableCache = false;
                }
            }

            $indexes = [
                'uq_ev_rec_def_bp_version' => [self::BLUEPRINTS, 0],
                'uq_ev_rec_def_bp_scope' => [self::BLUEPRINTS, 0],
                'uq_ev_rec_def_bp_idempotency' => [self::BLUEPRINTS, 0],
                'idx_ev_rec_def_bp_effective' => [self::BLUEPRINTS, 1],
                'uq_ev_rec_def_app_event' => [self::APPLICATIONS, 0],
                'uq_ev_rec_def_app_recurrence' => [self::APPLICATIONS, 0],
                'idx_ev_rec_def_app_root' => [self::APPLICATIONS, 1],
            ];
            foreach ($indexes as $name => [$table, $nonUnique]) {
                if (! DB::table('information_schema.statistics')
                    ->where('table_schema', DB::getDatabaseName())
                    ->where('table_name', $table)
                    ->where('index_name', $name)
                    ->where('non_unique', $nonUnique)
                    ->exists()) {
                    return $this->schemaAvailableCache = false;
                }
            }

            $constraints = [
                'fk_ev_rec_def_bp_tenant' => [self::BLUEPRINTS, 'FOREIGN KEY'],
                'fk_ev_rec_def_bp_root' => [self::BLUEPRINTS, 'FOREIGN KEY'],
                'fk_ev_rec_def_bp_source' => [self::BLUEPRINTS, 'FOREIGN KEY'],
                'fk_ev_rec_def_app_tenant' => [self::APPLICATIONS, 'FOREIGN KEY'],
                'fk_ev_rec_def_app_root' => [self::APPLICATIONS, 'FOREIGN KEY'],
                'fk_ev_rec_def_app_event' => [self::APPLICATIONS, 'FOREIGN KEY'],
                'fk_ev_rec_def_app_blueprint' => [self::APPLICATIONS, 'FOREIGN KEY'],
                'chk_ev_rec_def_bp_versions' => [self::BLUEPRINTS, 'CHECK'],
                'chk_ev_rec_def_bp_source_id' => [self::BLUEPRINTS, 'CHECK'],
                'chk_ev_rec_def_bp_effective_id' => [self::BLUEPRINTS, 'CHECK'],
                'chk_ev_rec_def_bp_hashes' => [self::BLUEPRINTS, 'CHECK'],
                'chk_ev_rec_def_app_version' => [self::APPLICATIONS, 'CHECK'],
                'chk_ev_rec_def_app_recurrence' => [self::APPLICATIONS, 'CHECK'],
                'chk_ev_rec_def_app_hashes' => [self::APPLICATIONS, 'CHECK'],
                'chk_ev_rec_def_app_status' => [self::APPLICATIONS, 'CHECK'],
            ];
            foreach ($constraints as $name => [$table, $type]) {
                if (! DB::table('information_schema.table_constraints')
                    ->where('constraint_schema', DB::getDatabaseName())
                    ->where('table_name', $table)
                    ->where('constraint_name', $name)
                    ->where('constraint_type', $type)
                    ->exists()) {
                    return $this->schemaAvailableCache = false;
                }
            }

            return $this->schemaAvailableCache = true;
        } catch (\Throwable) {
            return $this->schemaAvailableCache = false;
        }
    }

    /**
     * @param array<string,mixed> $rawSections
     * @return array<string,mixed>
     */
    public function preview(
        int $sourceEventId,
        int $actorUserId,
        string $effectiveFromRecurrenceId,
        array $rawSections,
    ): array {
        $this->assertRolloutAvailable();
        $context = $this->context(
            $sourceEventId,
            $actorUserId,
            $effectiveFromRecurrenceId,
            $rawSections,
            false,
        );
        $built = $this->buildManifest(
            $context['tenant_id'],
            $context['root'],
            $context['source'],
            $context['effective_from_recurrence_id'],
            $context['sections'],
            false,
        );
        $requestHash = $this->requestHash($context);
        $blueprintSetVersion = (int) DB::table(self::BLUEPRINTS)
            ->where('tenant_id', $context['tenant_id'])
            ->where('root_event_id', (int) $context['root']->id)
            ->max('blueprint_version');
        $token = $this->issueToken([
            'purpose' => 'event_recurrence_definition_blueprint',
            'tenant_id' => $context['tenant_id'],
            'root_event_id' => (int) $context['root']->id,
            'source_event_id' => (int) $context['source']->id,
            'source_recurrence_id' => (string) $context['source']->recurrence_id,
            'actor_user_id' => (int) $context['actor']->id,
            'effective_from_recurrence_id' => $context['effective_from_recurrence_id'],
            'sections' => $context['sections'],
            'request_hash' => $requestHash,
            'manifest_hash' => $built['manifest_hash'],
            'blueprint_set_version' => $blueprintSetVersion,
        ]);
        $tokenClaims = $this->decodeToken($token, false);

        return [
            'schema_version' => self::SCHEMA_VERSION,
            'root_event_id' => (int) $context['root']->id,
            'source_event_id' => (int) $context['source']->id,
            'source_recurrence_id' => (string) $context['source']->recurrence_id,
            'effective_from_recurrence_id' => $context['effective_from_recurrence_id'],
            'selected_sections' => $context['sections'],
            'manifest_hash' => $built['manifest_hash'],
            'blueprint_set_version' => $blueprintSetVersion,
            'counts' => $built['counts'],
            'conflicts' => $built['conflicts'],
            'can_commit' => $built['conflicts'] === [],
            'preview_token' => $token,
            'preview_expires_at' => CarbonImmutable::createFromTimestampUTC(
                (int) $tokenClaims['expires_at'],
            )->toIso8601String(),
        ];
    }

    /**
     * @param array<string,mixed> $rawSections
     * @return array<string,mixed>
     */
    public function commit(
        int $sourceEventId,
        int $actorUserId,
        string $effectiveFromRecurrenceId,
        array $rawSections,
        string $previewToken,
        string $idempotencyKey,
    ): array {
        $idempotencyKey = trim($idempotencyKey);
        if ($idempotencyKey === '' || mb_strlen($idempotencyKey) > 191) {
            $this->fail('event_recurrence_definition_idempotency_invalid');
        }
        if (! $this->schemaAvailable()) {
            $this->fail('event_recurrence_definition_schema_unavailable');
        }
        $tenantId = (int) TenantContext::getId();
        if ($tenantId <= 0) {
            $this->fail('event_recurrence_definition_tenant_required');
        }
        $sections = $this->normalizeSections($rawSections);
        $effectiveFromRecurrenceId = trim($effectiveFromRecurrenceId);
        if (! $this->validRecurrenceId($effectiveFromRecurrenceId)) {
            $this->fail('event_recurrence_definition_effective_identity_invalid');
        }
        $claims = $this->decodeToken($previewToken);
        if (($claims['purpose'] ?? null) !== 'event_recurrence_definition_blueprint'
            || (int) ($claims['tenant_id'] ?? 0) !== $tenantId
            || (int) ($claims['source_event_id'] ?? 0) !== $sourceEventId
            || (int) ($claims['actor_user_id'] ?? 0) !== $actorUserId
            || ($claims['effective_from_recurrence_id'] ?? null) !== $effectiveFromRecurrenceId
            || ($claims['sections'] ?? null) !== $sections
            || (int) ($claims['root_event_id'] ?? 0) <= 0
            || ! $this->validRecurrenceId((string) ($claims['source_recurrence_id'] ?? ''))
            || ! is_string($claims['request_hash'] ?? null)
            || ! is_string($claims['manifest_hash'] ?? null)
            || ! is_int($claims['blueprint_set_version'] ?? null)
            || (int) $claims['blueprint_set_version'] < 0) {
            $this->fail('event_recurrence_definition_token_invalid');
        }
        $boundRequestHash = $this->requestFingerprint(
            $tenantId,
            (int) $claims['root_event_id'],
            $sourceEventId,
            (string) $claims['source_recurrence_id'],
            $actorUserId,
            $effectiveFromRecurrenceId,
            $sections,
        );
        if (! hash_equals((string) $claims['request_hash'], $boundRequestHash)) {
            $this->fail('event_recurrence_definition_token_invalid');
        }
        $idempotencyHash = hash('sha256', $idempotencyKey);

        return DB::transaction(function () use (
            $sourceEventId,
            $actorUserId,
            $effectiveFromRecurrenceId,
            $sections,
            $claims,
            $tenantId,
            $boundRequestHash,
            $idempotencyHash,
        ): array {
            $rootLock = DB::table('events')
                ->where('tenant_id', $tenantId)
                ->where('id', (int) $claims['root_event_id'])
                ->lockForUpdate()
                ->first(['id']);
            if ($rootLock === null) {
                $this->fail('event_recurrence_definition_root_invalid');
            }
            $replay = DB::table(self::BLUEPRINTS)
                ->where('tenant_id', $tenantId)
                ->where('root_event_id', (int) $claims['root_event_id'])
                ->where('idempotency_hash', $idempotencyHash)
                ->lockForUpdate()
                ->first();
            if ($replay !== null) {
                if (! hash_equals((string) $replay->request_hash, $boundRequestHash)
                    || ! hash_equals((string) $replay->manifest_hash, (string) $claims['manifest_hash'])) {
                    $this->fail('event_recurrence_definition_idempotency_conflict');
                }

                return $this->commitResult($replay, true);
            }

            $currentBlueprintSetVersion = (int) DB::table(self::BLUEPRINTS)
                ->where('tenant_id', $tenantId)
                ->where('root_event_id', (int) $claims['root_event_id'])
                ->max('blueprint_version');
            if ($currentBlueprintSetVersion !== (int) $claims['blueprint_set_version']) {
                $this->fail('event_recurrence_definition_preview_stale');
            }

            // Only new work crosses the rollout and mutable authorization
            // boundary. An exact immutable replay remains available during a
            // flag rollback or after the manager's capabilities change.
            $this->assertRolloutAvailable();
            $context = $this->context(
                $sourceEventId,
                $actorUserId,
                $effectiveFromRecurrenceId,
                $sections,
                true,
            );
            $requestHash = $this->requestHash($context);
            if (! hash_equals($boundRequestHash, $requestHash)) {
                $this->fail('event_recurrence_definition_preview_stale');
            }
            $built = $this->buildManifest(
                $context['tenant_id'],
                $context['root'],
                $context['source'],
                $context['effective_from_recurrence_id'],
                $context['sections'],
                true,
            );
            if ($built['conflicts'] !== []) {
                $this->fail('event_recurrence_definition_conflict');
            }
            $expectedClaims = [
                'purpose' => 'event_recurrence_definition_blueprint',
                'tenant_id' => $context['tenant_id'],
                'root_event_id' => (int) $context['root']->id,
                'source_event_id' => (int) $context['source']->id,
                'source_recurrence_id' => (string) $context['source']->recurrence_id,
                'actor_user_id' => (int) $context['actor']->id,
                'effective_from_recurrence_id' => $context['effective_from_recurrence_id'],
                'sections' => $context['sections'],
                'request_hash' => $requestHash,
                'manifest_hash' => $built['manifest_hash'],
                'blueprint_set_version' => $currentBlueprintSetVersion,
            ];
            foreach ($expectedClaims as $key => $expected) {
                if (! array_key_exists($key, $claims) || $claims[$key] !== $expected) {
                    $this->fail('event_recurrence_definition_preview_stale');
                }
            }

            $version = $currentBlueprintSetVersion + 1;
            $blueprintId = (int) DB::table(self::BLUEPRINTS)->insertGetId([
                'tenant_id' => $context['tenant_id'],
                'root_event_id' => (int) $context['root']->id,
                'source_event_id' => (int) $context['source']->id,
                'source_recurrence_id' => (string) $context['source']->recurrence_id,
                'source_occurrence_key' => (string) $context['source']->occurrence_key,
                'blueprint_version' => $version,
                'schema_version' => self::SCHEMA_VERSION,
                'effective_from_recurrence_id' => $context['effective_from_recurrence_id'],
                'selected_sections' => $this->canonicalJson($context['sections']),
                'manifest' => $built['manifest_json'],
                'manifest_hash' => $built['manifest_hash'],
                'idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'captured_by_user_id' => (int) $context['actor']->id,
                'created_at' => now(),
            ]);
            $row = DB::table(self::BLUEPRINTS)->where('id', $blueprintId)->first();
            if ($row === null) {
                $this->fail('event_recurrence_definition_persistence_failed');
            }

            return $this->commitResult($row, false, $built['counts']);
        }, 3);
    }

    /**
     * Immutable manager history. Manifests and identity-bearing definition
     * values are never returned by this projection.
     *
     * @return array{items:list<array<string,mixed>>,next_before_version:?int}
     */
    public function history(
        int $sourceEventId,
        int $actorUserId,
        int $limit = 25,
        ?int $beforeVersion = null,
    ): array {
        if (! $this->schemaAvailable()) {
            $this->fail('event_recurrence_definition_schema_unavailable');
        }
        $tenantId = (int) TenantContext::getId();
        if ($tenantId <= 0) {
            $this->fail('event_recurrence_definition_tenant_required');
        }
        /** @var Event|null $source */
        $source = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($sourceEventId)
            ->first();
        if ($source === null || ! $this->validSource($source)) {
            $this->fail('event_recurrence_definition_source_invalid');
        }
        /** @var Event|null $root */
        $root = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $source->getRawOriginal('parent_event_id'))
            ->first();
        /** @var User|null $actor */
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorUserId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->first();
        if ($root === null || ! (bool) $root->getRawOriginal('is_recurring_template')) {
            $this->fail('event_recurrence_definition_root_invalid');
        }
        if ($actor === null) {
            $this->fail('event_recurrence_definition_actor_invalid');
        }
        if (! $this->policy->manage($actor, $source) || ! $this->policy->manage($actor, $root)) {
            $this->fail('event_recurrence_definition_authorization_denied');
        }
        $limit = max(1, min($limit, 100));
        if ($beforeVersion !== null && $beforeVersion <= 0) {
            $this->fail('event_recurrence_definition_history_cursor_invalid');
        }
        $rows = DB::table(self::BLUEPRINTS)
            ->where('tenant_id', $tenantId)
            ->where('root_event_id', (int) $root->getKey())
            ->when($beforeVersion !== null, static fn (Builder $query) =>
                $query->where('blueprint_version', '<', $beforeVersion))
            ->orderByDesc('blueprint_version')
            ->limit($limit + 1)
            ->get();
        $hasMore = $rows->count() > $limit;
        $page = $rows->take($limit);
        $items = $page->map(fn (object $row): array => [
            'blueprint_id' => (int) $row->id,
            'blueprint_version' => (int) $row->blueprint_version,
            'schema_version' => (int) $row->schema_version,
            'effective_from_recurrence_id' => (string) $row->effective_from_recurrence_id,
            'source_event_id' => (int) $row->source_event_id,
            'source_recurrence_id' => (string) $row->source_recurrence_id,
            'selected_sections' => $this->decodeObject($row->selected_sections),
            'counts' => $this->manifestCounts($row->manifest),
            'manifest_hash' => (string) $row->manifest_hash,
            'captured_by_user_id' => $row->captured_by_user_id !== null
                ? (int) $row->captured_by_user_id
                : null,
            'created_at' => (string) $row->created_at,
        ])->values()->all();

        return [
            'items' => $items,
            'next_before_version' => $hasMore && $items !== []
                ? (int) $items[array_key_last($items)]['blueprint_version']
                : null,
        ];
    }

    /**
     * Apply one effective definition version to a newly inserted occurrence.
     * Existing occurrences are never entered through this method.
     *
     * @return array<string,mixed>|null
     */
    public function applyToNewOccurrence(
        object $root,
        object $event,
        string $recurrenceId,
    ): ?array {
        if (! $this->rolloutEnabled()) {
            return null;
        }
        if (! $this->schemaAvailable()) {
            $this->fail('event_recurrence_definition_schema_unavailable');
        }
        if (DB::transactionLevel() < 1) {
            $this->fail('event_recurrence_definition_transaction_required');
        }
        $tenantId = (int) ($root->tenant_id ?? 0);
        $rootId = (int) ($root->id ?? 0);
        $eventId = (int) ($event->id ?? 0);
        if ($tenantId <= 0
            || $rootId <= 0
            || $eventId <= 0
            || (int) ($event->tenant_id ?? 0) !== $tenantId
            || (int) ($event->parent_event_id ?? 0) !== $rootId
            || (string) ($event->recurrence_id ?? '') !== $recurrenceId
            || ! $this->validRecurrenceId($recurrenceId)) {
            $this->fail('event_recurrence_definition_occurrence_invalid');
        }
        $existing = DB::table(self::APPLICATIONS)
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->first();
        if ($existing !== null) {
            return $this->applicationResult($existing, true);
        }
        $blueprint = DB::table(self::BLUEPRINTS)
            ->where('tenant_id', $tenantId)
            ->where('root_event_id', $rootId)
            ->where('effective_from_recurrence_id', '<=', $recurrenceId)
            ->orderByDesc('effective_from_recurrence_id')
            ->orderByDesc('blueprint_version')
            ->lockForUpdate()
            ->first();
        if ($blueprint === null) {
            return null;
        }
        if ((int) $blueprint->schema_version !== self::SCHEMA_VERSION) {
            $this->fail('event_recurrence_definition_schema_version_unsupported');
        }
        $manifest = $this->decodeObject($blueprint->manifest);
        if (! hash_equals((string) $blueprint->manifest_hash, hash('sha256', $this->canonicalJson($manifest)))) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $actorId = $this->applicationActorId($tenantId, (int) ($root->user_id ?? 0));
        if ($actorId === null) {
            $this->fail('event_recurrence_definition_actor_unavailable');
        }
        $sections = $this->normalizeSections($this->decodeObject($blueprint->selected_sections));
        $this->assertSectionSchema($sections);
        $counts = $this->emptyCounts();
        foreach (self::SECTION_ORDER as $section) {
            if (! $sections[$section]) {
                continue;
            }
            $definition = $manifest['definitions'][$section] ?? null;
            if (! is_array($definition)) {
                $this->fail('event_recurrence_definition_manifest_invalid');
            }
            $sectionCounts = match ($section) {
                'agenda' => $this->applyAgenda($tenantId, $event, $definition, $actorId, (int) $blueprint->id),
                'ticket_types' => $this->applyTickets($tenantId, $event, $definition, $actorId, (int) $blueprint->id),
                'registration' => $this->applyRegistration($tenantId, $event, $definition, $actorId, (int) $blueprint->id),
                'safety' => $this->applySafety($tenantId, $event, $definition, $actorId, (int) $blueprint->id),
                'staff' => $this->applyStaff($tenantId, $event, $definition, $actorId, (int) $blueprint->id),
                default => [],
            };
            foreach ($sectionCounts as $key => $value) {
                $counts[$key] = ($counts[$key] ?? 0) + $value;
            }
        }
        $applicationHash = hash('sha256', $this->canonicalJson([
            'blueprint_id' => (int) $blueprint->id,
            'blueprint_version' => (int) $blueprint->blueprint_version,
            'event_id' => $eventId,
            'manifest_hash' => (string) $blueprint->manifest_hash,
            'recurrence_id' => $recurrenceId,
            'root_event_id' => $rootId,
            'counts' => $counts,
        ]));
        $applicationId = (int) DB::table(self::APPLICATIONS)->insertGetId([
            'tenant_id' => $tenantId,
            'root_event_id' => $rootId,
            'event_id' => $eventId,
            'recurrence_id' => $recurrenceId,
            'blueprint_id' => (int) $blueprint->id,
            'blueprint_version' => (int) $blueprint->blueprint_version,
            'manifest_hash' => (string) $blueprint->manifest_hash,
            'application_hash' => $applicationHash,
            'applied_counts' => $this->canonicalJson($counts),
            'status' => 'applied',
            'applied_by_user_id' => $actorId,
            'created_at' => now(),
        ]);
        $row = DB::table(self::APPLICATIONS)->where('id', $applicationId)->first();
        if ($row === null) {
            $this->fail('event_recurrence_definition_persistence_failed');
        }

        return $this->applicationResult($row, false);
    }

    /**
     * @param array<string,mixed> $rawSections
     * @return array{tenant_id:int,root:Event,source:Event,actor:User,effective_from_recurrence_id:string,sections:array<string,bool>}
     */
    private function context(
        int $sourceEventId,
        int $actorUserId,
        string $effectiveFromRecurrenceId,
        array $rawSections,
        bool $lock,
    ): array {
        $tenantId = (int) TenantContext::getId();
        if ($tenantId <= 0) {
            $this->fail('event_recurrence_definition_tenant_required');
        }
        $sections = $this->normalizeSections($rawSections);
        // Resolve only the parent identity first. Every mutating recurrence
        // path then follows the canonical root -> source -> subordinate rows
        // lock order, preventing inversion with materialization/revisions.
        $sourceProbe = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($sourceEventId)
            ->first();
        if (! $sourceProbe instanceof Event || ! $this->validSource($sourceProbe)) {
            $this->fail('event_recurrence_definition_source_invalid');
        }
        $rootQuery = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $sourceProbe->getRawOriginal('parent_event_id'));
        if ($lock) {
            $rootQuery->lockForUpdate();
        }
        /** @var Event|null $root */
        $root = $rootQuery->first();
        if ($root === null
            || ! (bool) $root->getRawOriginal('is_recurring_template')
            || (string) $root->getRawOriginal('recurrence_engine') !== EventRecurrenceService::ENGINE
            || (string) $root->getRawOriginal('recurrence_engine_version') !== EventRecurrenceService::ENGINE_VERSION) {
            $this->fail('event_recurrence_definition_root_invalid');
        }
        $sourceQuery = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($sourceEventId);
        if ($lock) {
            $sourceQuery->lockForUpdate();
        }
        /** @var Event|null $source */
        $source = $sourceQuery->first();
        if ($source === null
            || ! $this->validSource($source)
            || (int) $source->getRawOriginal('parent_event_id') !== (int) $root->getKey()) {
            $this->fail('event_recurrence_definition_source_invalid');
        }
        /** @var User|null $actor */
        $actor = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorUserId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->when($lock, static fn ($query) => $query->lockForUpdate())
            ->first();
        if ($actor === null) {
            $this->fail('event_recurrence_definition_actor_invalid');
        }
        if (! $this->policy->manage($actor, $source) || ! $this->policy->manage($actor, $root)) {
            $this->fail('event_recurrence_definition_authorization_denied');
        }
        $this->authorizeSections($actor, $source, $sections);
        $effectiveFromRecurrenceId = trim($effectiveFromRecurrenceId);
        if (! $this->validRecurrenceId($effectiveFromRecurrenceId)
            || strcmp($effectiveFromRecurrenceId, (string) $source->getRawOriginal('recurrence_id')) < 0) {
            $this->fail('event_recurrence_definition_effective_identity_invalid');
        }
        $this->assertSectionSchema($sections);

        return [
            'tenant_id' => $tenantId,
            'root' => $root,
            'source' => $source,
            'actor' => $actor,
            'effective_from_recurrence_id' => $effectiveFromRecurrenceId,
            'sections' => $sections,
        ];
    }

    private function validSource(Event $source): bool
    {
        return (int) $source->getRawOriginal('is_recurring_template') === 0
            && (int) $source->getRawOriginal('parent_event_id') > 0
            && (string) $source->getRawOriginal('recurrence_engine') === EventRecurrenceService::ENGINE
            && (string) $source->getRawOriginal('recurrence_engine_version') === EventRecurrenceService::ENGINE_VERSION
            && $this->validRecurrenceId((string) $source->getRawOriginal('recurrence_id'));
    }

    /** @param array<string,bool> $sections */
    private function authorizeSections(User $actor, Event $source, array $sections): void
    {
        $allowed = [
            'agenda' => $this->policy->manageAgenda($actor, $source),
            'ticket_types' => $this->policy->manageFinance($actor, $source),
            'registration' => $this->policy->manageRegistration($actor, $source),
            'safety' => $this->policy->manage($actor, $source),
            'staff' => $this->policy->manageStaff($actor, $source),
        ];
        foreach ($sections as $section => $selected) {
            if ($selected && ! $allowed[$section]) {
                $this->fail('event_recurrence_definition_authorization_denied');
            }
        }
    }

    /**
     * @param array<string,bool> $sections
     * @return array{manifest:array<string,mixed>,manifest_json:string,manifest_hash:string,counts:array<string,int>,conflicts:list<array<string,mixed>>}
     */
    private function buildManifest(
        int $tenantId,
        Event $root,
        Event $source,
        string $effectiveFromRecurrenceId,
        array $sections,
        bool $lock,
    ): array {
        $counts = $this->emptyCounts();
        $conflicts = [];
        $definitions = [];
        foreach (self::SECTION_ORDER as $section) {
            if (! $sections[$section]) {
                $definitions[$section] = [];
                continue;
            }
            [$definition, $sectionCounts, $sectionConflicts] = match ($section) {
                'agenda' => $this->captureAgenda($tenantId, $source, $lock),
                'ticket_types' => $this->captureTickets($tenantId, $source, $lock),
                'registration' => $this->captureRegistration($tenantId, $source, $lock),
                'safety' => $this->captureSafety($tenantId, $source, $lock),
                'staff' => $this->captureStaff($tenantId, $source, $lock),
                default => [[], [], []],
            };
            $definitions[$section] = $definition;
            foreach ($sectionCounts as $key => $value) {
                $counts[$key] = ($counts[$key] ?? 0) + $value;
            }
            array_push($conflicts, ...$sectionConflicts);
        }
        $manifest = [
            'schema_version' => self::SCHEMA_VERSION,
            'source' => [
                'root_event_id' => (int) $root->getKey(),
                'event_id' => (int) $source->getKey(),
                'recurrence_id' => (string) $source->getRawOriginal('recurrence_id'),
                'occurrence_key' => (string) $source->getRawOriginal('occurrence_key'),
                'start_time_utc' => $this->utcString($source->getRawOriginal('start_time')),
                'timezone' => (string) ($source->getRawOriginal('timezone') ?: 'UTC'),
            ],
            'effective_from_recurrence_id' => $effectiveFromRecurrenceId,
            'selected_sections' => $sections,
            'definitions' => $definitions,
        ];
        $json = $this->canonicalJson($manifest);

        return [
            'manifest' => $manifest,
            'manifest_json' => $json,
            'manifest_hash' => hash('sha256', $json),
            'counts' => $counts,
            'conflicts' => $conflicts,
        ];
    }

    /** @return array{array<string,mixed>,array<string,int>,list<array<string,mixed>>} */
    private function captureAgenda(int $tenantId, Event $source, bool $lock): array
    {
        $limit = $this->limit('max_sessions', 100);
        $query = DB::table('event_sessions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey())
            ->where('status', 'scheduled')
            ->orderBy('starts_at_utc')->orderBy('position')->orderBy('id')
            ->limit($limit + 1);
        $sessions = $this->lock($query, $lock)->get();
        $conflicts = [];
        if ($sessions->count() > $limit) {
            $conflicts[] = $this->conflict('agenda', 'definition_limit_exceeded', $sessions->count());
            $sessions = $sessions->take($limit);
        }
        $eventStart = $this->instant($source->getRawOriginal('start_time'));
        $definitions = [];
        $speakerCount = 0;
        $resourceCount = 0;
        foreach ($sessions as $session) {
            $speakers = $this->lock(DB::table('event_session_speakers')
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $source->getKey())
                ->where('session_id', (int) $session->id)
                ->orderBy('position')->orderBy('id'), $lock)->get();
            if ($speakers->count() > $this->limit('max_speakers_per_session', 50)) {
                $conflicts[] = $this->conflict('agenda', 'speaker_limit_exceeded', $speakers->count());
            }
            $speakerDefinitions = [];
            foreach ($speakers->take($this->limit('max_speakers_per_session', 50)) as $speaker) {
                $userId = $speaker->user_id !== null ? (int) $speaker->user_id : null;
                if ($userId !== null && ! $this->activeUserExists($tenantId, $userId, $lock)) {
                    $conflicts[] = $this->conflict('agenda', 'invalid_speaker_reference', 1);
                    continue;
                }
                $speakerDefinitions[] = [
                    'user_id' => $userId,
                    'display_name' => $speaker->display_name,
                    'role_label' => $speaker->role_label,
                    'position' => (int) $speaker->position,
                ];
            }
            $resources = $this->lock(DB::table('event_session_resources')
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $source->getKey())
                ->where('session_id', (int) $session->id)
                ->orderBy('position')->orderBy('id'), $lock)->get();
            if ($resources->count() > $this->limit('max_resources_per_session', 50)) {
                $conflicts[] = $this->conflict('agenda', 'resource_limit_exceeded', $resources->count());
            }
            $resourceDefinitions = [];
            foreach ($resources->take($this->limit('max_resources_per_session', 50)) as $resource) {
                $resourceDefinitions[] = [
                    'resource_type' => (string) $resource->resource_type,
                    'visibility' => (string) $resource->visibility,
                    'title' => (string) $resource->title,
                    // The encrypted URL remains encrypted in the manifest.
                    'url_ciphertext' => (string) $resource->url_ciphertext,
                    'position' => (int) $resource->position,
                ];
            }
            $speakerCount += count($speakerDefinitions);
            $resourceCount += count($resourceDefinitions);
            $starts = $this->instant($session->starts_at_utc);
            $ends = $this->instant($session->ends_at_utc);
            $definitions[] = [
                'title' => (string) $session->title,
                'description' => $session->description,
                'session_type' => (string) $session->session_type,
                'visibility' => (string) $session->visibility,
                'capacity' => $session->capacity !== null ? (int) $session->capacity : null,
                'start_offset_seconds' => (int) $eventStart->diffInSeconds($starts, false),
                'duration_seconds' => (int) $starts->diffInSeconds($ends, false),
                'timezone_mode' => (string) $session->timezone
                    === (string) ($source->getRawOriginal('timezone') ?: 'UTC')
                        ? 'inherit_event'
                        : 'fixed',
                'timezone' => (string) $session->timezone
                    === (string) ($source->getRawOriginal('timezone') ?: 'UTC')
                        ? null
                        : (string) $session->timezone,
                'track_name' => $session->track_name,
                'room_name' => $session->room_name,
                'room_key' => $session->room_key,
                'position' => (int) $session->position,
                'speakers' => $speakerDefinitions,
                'resources' => $resourceDefinitions,
            ];
        }

        return [
            ['sessions' => $definitions],
            ['sessions' => count($definitions), 'speakers' => $speakerCount, 'resources' => $resourceCount],
            $conflicts,
        ];
    }

    /** @return array{array<string,mixed>,array<string,int>,list<array<string,mixed>>} */
    private function captureTickets(int $tenantId, Event $source, bool $lock): array
    {
        $limit = $this->limit('max_ticket_types', 100);
        $query = DB::table('event_ticket_types')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey())
            ->where('status', '!=', 'archived')
            ->orderBy('id')->limit($limit + 1);
        $tickets = $this->lock($query, $lock)->get();
        $conflicts = [];
        if ($tickets->count() > $limit) {
            $conflicts[] = $this->conflict('ticket_types', 'definition_limit_exceeded', $tickets->count());
            $tickets = $tickets->take($limit);
        }
        $eventStart = $this->instant($source->getRawOriginal('start_time'));
        $definitions = [];
        foreach ($tickets as $ticket) {
            if ((string) $ticket->kind === 'time_credit' && (string) $ticket->status === 'active') {
                $conflicts[] = $this->conflict(
                    'ticket_types',
                    'unsupported_active_time_credit_ticket',
                    1,
                );
                continue;
            }
            $definitions[] = [
                'name' => (string) $ticket->name,
                'description' => $ticket->description,
                'kind' => (string) $ticket->kind,
                'unit_price_credits' => (string) $ticket->unit_price_credits,
                'allocation_limit' => (int) $ticket->allocation_limit,
                'sales_open_offset_seconds' => (int) $eventStart->diffInSeconds(
                    $this->instant($ticket->sales_opens_at_utc),
                    false,
                ),
                'sales_close_offset_seconds' => (int) $eventStart->diffInSeconds(
                    $this->instant($ticket->sales_closes_at_utc),
                    false,
                ),
                'per_member_limit' => (int) $ticket->per_member_limit,
                'eligibility_policy' => $this->decodeObject($ticket->eligibility_policy),
                'refund_cutoff_offset_seconds' => $ticket->refund_cutoff_at_utc !== null
                    ? (int) $eventStart->diffInSeconds($this->instant($ticket->refund_cutoff_at_utc), false)
                    : null,
                'organizer_cancel_refundable' => (bool) $ticket->organizer_cancel_refundable,
                // Paused is operational state, not a portable definition.
                'desired_status' => (string) $ticket->status === 'active' ? 'active' : 'draft',
            ];
        }

        return [['ticket_types' => $definitions], ['ticket_types' => count($definitions)], $conflicts];
    }

    /** @return array{array<string,mixed>,array<string,int>,list<array<string,mixed>>} */
    private function captureRegistration(int $tenantId, Event $source, bool $lock): array
    {
        $settings = $this->lock(DB::table('event_registration_settings')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey()), $lock)->first();
        if ($settings === null) {
            return [[], [], []];
        }
        $eventStart = $this->instant($source->getRawOriginal('start_time'));
        $definition = [
            'settings' => [
                'status' => (string) $settings->status,
                'approval_mode' => (string) $settings->approval_mode,
                'opens_offset_seconds' => $this->nullableOffset($eventStart, $settings->opens_at_utc),
                'closes_offset_seconds' => $this->nullableOffset($eventStart, $settings->closes_at_utc),
                'cancellation_cutoff_offset_seconds' => $this->nullableOffset(
                    $eventStart,
                    $settings->cancellation_cutoff_at_utc,
                ),
                'per_member_limit' => (int) $settings->per_member_limit,
                'guests_enabled' => (bool) $settings->guests_enabled,
                'max_guests_per_registration' => (int) $settings->max_guests_per_registration,
                'guest_retention_days' => (int) $settings->guest_retention_days,
            ],
            'published_form' => null,
        ];
        $counts = ['registration_settings' => 1];
        $conflicts = [];
        if ((string) $settings->form_state === 'published'
            && $settings->published_form_version !== null) {
            $form = $this->lock(DB::table('event_registration_form_versions')
                ->where('tenant_id', $tenantId)
                ->where('event_id', (int) $source->getKey())
                ->where('version_number', (int) $settings->published_form_version)
                ->where('status', 'published'), $lock)->first();
            if ($form === null) {
                $conflicts[] = $this->conflict('registration', 'published_form_missing', 1);
            } else {
                $questionLimit = $this->limit('max_form_questions', 200);
                $questions = $this->lock(DB::table('event_registration_form_questions')
                    ->where('tenant_id', $tenantId)
                    ->where('event_id', (int) $source->getKey())
                    ->where('form_version_id', (int) $form->id)
                    ->orderBy('position')->orderBy('id')
                    ->limit($questionLimit + 1), $lock)->get();
                if ($questions->count() > $questionLimit) {
                    $conflicts[] = $this->conflict('registration', 'question_limit_exceeded', $questions->count());
                    $questions = $questions->take($questionLimit);
                }
                $questionDefinitions = [];
                foreach ($questions as $question) {
                    $questionDefinitions[] = [
                        'stable_key' => (string) $question->stable_key,
                        'position' => (int) $question->position,
                        'question_type' => (string) $question->question_type,
                        'prompt' => (string) $question->prompt,
                        'help_text' => $question->help_text,
                        'is_required' => (bool) $question->is_required,
                        'data_classification' => (string) $question->data_classification,
                        'purpose' => (string) $question->purpose,
                        'retention_days' => (int) $question->retention_days,
                        'choice_options' => $this->nullableJson($question->choice_options),
                        'validation_rules' => $this->nullableJson($question->validation_rules),
                        'visibility_rules' => $this->nullableJson($question->visibility_rules),
                        'displayed_text' => $question->displayed_text,
                        'displayed_text_version' => $question->displayed_text_version,
                    ];
                }
                $definition['published_form'] = [
                    'name' => (string) $form->name,
                    'description' => $form->description,
                    'questions' => $questionDefinitions,
                ];
                $counts['published_forms'] = 1;
                $counts['form_questions'] = count($questionDefinitions);
            }
        }

        return [$definition, $counts, $conflicts];
    }

    /** @return array{array<string,mixed>,array<string,int>,list<array<string,mixed>>} */
    private function captureSafety(int $tenantId, Event $source, bool $lock): array
    {
        $requirements = $this->lock(DB::table('event_safety_requirements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey())
            ->where('status', 'published'), $lock)->first();
        if ($requirements === null) {
            return [[], [], []];
        }
        $version = $this->lock(DB::table('event_safety_requirement_versions')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey())
            ->where('requirements_id', (int) $requirements->id)
            ->where('version_number', (int) $requirements->published_version), $lock)->first();
        if ($version === null) {
            return [
                [],
                [],
                [$this->conflict('safety', 'published_requirement_version_missing', 1)],
            ];
        }

        return [[
            'published_requirement' => [
                'minimum_age' => $version->minimum_age !== null ? (int) $version->minimum_age : null,
                'guardian_consent_required' => (bool) $version->guardian_consent_required,
                'minor_age_threshold' => $version->minor_age_threshold !== null
                    ? (int) $version->minor_age_threshold
                    : null,
                'code_of_conduct_required' => (bool) $version->code_of_conduct_required,
                'code_of_conduct_text' => $version->code_of_conduct_text,
                'code_of_conduct_text_version' => $version->code_of_conduct_text_version,
                'code_of_conduct_text_hash' => $version->code_of_conduct_text_hash,
                'eligibility_policy_metadata' => $this->decodeObject(
                    $version->eligibility_policy_metadata,
                ),
                'eligibility_policy_hash' => (string) $version->eligibility_policy_hash,
            ],
        ], ['safety_requirements' => 1], []];
    }

    /** @return array{array<string,mixed>,array<string,int>,list<array<string,mixed>>} */
    private function captureStaff(int $tenantId, Event $source, bool $lock): array
    {
        $limit = $this->limit('max_staff_assignments', 100);
        $assignments = $this->lock(DB::table('event_staff_assignments')
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $source->getKey())
            ->where('status', 'active')
            ->where(static function (Builder $expiry): void {
                $expiry->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->orderBy('role')->orderBy('user_id')
            ->limit($limit + 1), $lock)->get();
        $conflicts = [];
        if ($assignments->count() > $limit) {
            $conflicts[] = $this->conflict('staff', 'definition_limit_exceeded', $assignments->count());
            $assignments = $assignments->take($limit);
        }
        $eventStart = $this->instant($source->getRawOriginal('start_time'));
        $definitions = [];
        foreach ($assignments as $assignment) {
            if (! $this->activeUserExists($tenantId, (int) $assignment->user_id, $lock)) {
                $conflicts[] = $this->conflict('staff', 'invalid_staff_reference', 1);
                continue;
            }
            $expiryOffset = $assignment->expires_at !== null
                ? (int) $eventStart->diffInSeconds($this->instant($assignment->expires_at), false)
                : null;
            if ($expiryOffset !== null && $expiryOffset <= 0) {
                $conflicts[] = $this->conflict('staff', 'nonportable_staff_expiry', 1);
                continue;
            }
            $definitions[] = [
                'user_id' => (int) $assignment->user_id,
                'role' => (string) $assignment->role,
                'expires_offset_seconds' => $expiryOffset,
            ];
        }

        return [['assignments' => $definitions], ['staff_assignments' => count($definitions)], $conflicts];
    }

    /** @param array<string,mixed> $definition @return array<string,int> */
    private function applyAgenda(
        int $tenantId,
        object $event,
        array $definition,
        int $actorId,
        int $blueprintId,
    ): array {
        $sessions = $definition['sessions'] ?? [];
        if (! is_array($sessions)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $eventStart = $this->instant($event->start_time);
        $agendaVersion = (int) ($event->agenda_version ?? 0);
        $speakerCount = 0;
        $resourceCount = 0;
        foreach (array_values($sessions) as $index => $session) {
            if (! is_array($session)) {
                $this->fail('event_recurrence_definition_manifest_invalid');
            }
            $start = $eventStart->addSeconds((int) ($session['start_offset_seconds'] ?? 0));
            $duration = (int) ($session['duration_seconds'] ?? 0);
            if ($duration <= 0) {
                $this->fail('event_recurrence_definition_manifest_invalid');
            }
            $now = now();
            $sessionId = (int) DB::table('event_sessions')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'version' => 1,
                'title' => (string) ($session['title'] ?? ''),
                'description' => $session['description'] ?? null,
                'session_type' => (string) ($session['session_type'] ?? 'session'),
                'visibility' => (string) ($session['visibility'] ?? 'public'),
                'capacity' => $session['capacity'] ?? null,
                'status' => 'scheduled',
                'starts_at_utc' => $start->format('Y-m-d H:i:s'),
                'ends_at_utc' => $start->addSeconds($duration)->format('Y-m-d H:i:s'),
                'timezone' => ($session['timezone_mode'] ?? null) === 'inherit_event'
                    ? (string) ($event->timezone ?? 'UTC')
                    : (string) ($session['timezone'] ?? 'UTC'),
                'track_name' => $session['track_name'] ?? null,
                'room_name' => $session['room_name'] ?? null,
                'room_key' => $session['room_key'] ?? null,
                'position' => (int) ($session['position'] ?? ($index + 1)),
                'cancellation_reason' => null,
                'created_by' => $actorId,
                'updated_by' => $actorId,
                'cancelled_by' => null,
                'cancelled_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            foreach (($session['speakers'] ?? []) as $speaker) {
                if (! is_array($speaker)) {
                    $this->fail('event_recurrence_definition_manifest_invalid');
                }
                $userId = isset($speaker['user_id']) ? (int) $speaker['user_id'] : null;
                if ($userId !== null && ! $this->activeUserExists($tenantId, $userId, true)) {
                    $this->fail('event_recurrence_definition_reference_invalid');
                }
                DB::table('event_session_speakers')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => (int) $event->id,
                    'session_id' => $sessionId,
                    'user_id' => $userId,
                    'display_name' => $speaker['display_name'] ?? null,
                    'role_label' => $speaker['role_label'] ?? null,
                    'position' => (int) ($speaker['position'] ?? 0),
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $speakerCount++;
            }
            foreach (($session['resources'] ?? []) as $resource) {
                if (! is_array($resource)) {
                    $this->fail('event_recurrence_definition_manifest_invalid');
                }
                DB::table('event_session_resources')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => (int) $event->id,
                    'session_id' => $sessionId,
                    'resource_type' => (string) ($resource['resource_type'] ?? ''),
                    'visibility' => (string) ($resource['visibility'] ?? 'public'),
                    'title' => (string) ($resource['title'] ?? ''),
                    'url_ciphertext' => (string) ($resource['url_ciphertext'] ?? ''),
                    'position' => (int) ($resource['position'] ?? 1),
                    'created_by' => $actorId,
                    'updated_by' => $actorId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
                $resourceCount++;
            }
            $agendaVersion++;
            DB::table('event_session_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'session_id' => $sessionId,
                'actor_user_id' => $actorId,
                'agenda_version' => $agendaVersion,
                'action' => 'created',
                'idempotency_key' => "rec-def:{$blueprintId}:{$event->id}:agenda:{$index}",
                'request_hash' => hash('sha256', $this->canonicalJson($session)),
                'changed_fields' => $this->canonicalJson(array_keys($session)),
                'affected_session_ids' => $this->canonicalJson([$sessionId]),
                'created_at' => $now,
            ]);
        }
        if ($sessions !== []) {
            DB::table('events')->where('tenant_id', $tenantId)->where('id', (int) $event->id)
                ->update(['agenda_version' => $agendaVersion, 'updated_at' => now()]);
        }

        return ['sessions' => count($sessions), 'speakers' => $speakerCount, 'resources' => $resourceCount];
    }

    /** @param array<string,mixed> $definition @return array<string,int> */
    private function applyTickets(
        int $tenantId,
        object $event,
        array $definition,
        int $actorId,
        int $blueprintId,
    ): array {
        $tickets = $definition['ticket_types'] ?? [];
        if (! is_array($tickets)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $eventStart = $this->instant($event->start_time);
        foreach (array_values($tickets) as $index => $ticket) {
            if (! is_array($ticket)
                || (($ticket['kind'] ?? null) === 'time_credit'
                    && ($ticket['desired_status'] ?? null) === 'active')) {
                $this->fail('event_recurrence_definition_unsupported_ticket');
            }
            $active = ($ticket['desired_status'] ?? 'draft') === 'active';
            $version = $active ? 2 : 1;
            $now = now();
            $ticketId = (int) DB::table('event_ticket_types')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'occurrence_key' => (string) $event->occurrence_key,
                'ticket_version' => $version,
                'name' => (string) ($ticket['name'] ?? ''),
                'description' => $ticket['description'] ?? null,
                'kind' => (string) ($ticket['kind'] ?? 'free'),
                'unit_price_credits' => (string) ($ticket['unit_price_credits'] ?? '0.00'),
                'allocation_limit' => (int) ($ticket['allocation_limit'] ?? 0),
                'sales_opens_at_utc' => $eventStart->addSeconds((int) $ticket['sales_open_offset_seconds'])->format('Y-m-d H:i:s'),
                'sales_closes_at_utc' => $eventStart->addSeconds((int) $ticket['sales_close_offset_seconds'])->format('Y-m-d H:i:s'),
                'event_starts_at_utc_snapshot' => $eventStart->format('Y-m-d H:i:s'),
                'event_timezone_snapshot' => (string) ($event->timezone ?? 'UTC'),
                'per_member_limit' => (int) ($ticket['per_member_limit'] ?? 1),
                'eligibility_policy' => $this->canonicalObjectJson(
                    $ticket['eligibility_policy'] ?? [],
                ),
                'refund_cutoff_at_utc' => isset($ticket['refund_cutoff_offset_seconds'])
                    ? $eventStart->addSeconds((int) $ticket['refund_cutoff_offset_seconds'])->format('Y-m-d H:i:s')
                    : null,
                'organizer_cancel_refundable' => (int) (bool) ($ticket['organizer_cancel_refundable'] ?? false),
                'status' => $active ? 'active' : 'draft',
                'created_by' => $actorId,
                'updated_by' => $actorId,
                'activated_by' => $active ? $actorId : null,
                'paused_by' => null,
                'archived_by' => null,
                'activated_at' => $active ? $now : null,
                'paused_at' => null,
                'archived_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $this->ticketHistory(
                $tenantId,
                (int) $event->id,
                $ticketId,
                1,
                'created',
                $actorId,
                $blueprintId,
                $index,
                $ticket,
            );
            if ($active) {
                $this->ticketHistory(
                    $tenantId,
                    (int) $event->id,
                    $ticketId,
                    2,
                    'activated',
                    $actorId,
                    $blueprintId,
                    $index,
                    ['status' => 'active'],
                );
            }
        }

        return ['ticket_types' => count($tickets)];
    }

    /** @param array<string,mixed> $definition @return array<string,int> */
    private function applyRegistration(
        int $tenantId,
        object $event,
        array $definition,
        int $actorId,
        int $blueprintId,
    ): array {
        if ($definition === []) {
            return [];
        }
        $settings = $definition['settings'] ?? null;
        if (! is_array($settings)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $eventStart = $this->instant($event->start_time);
        $now = now();
        $settingsId = (int) DB::table('event_registration_settings')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => (int) $event->id,
            'occurrence_key' => (string) $event->occurrence_key,
            'revision' => 1,
            'status' => 'draft',
            'approval_mode' => (string) ($settings['approval_mode'] ?? 'auto'),
            'event_starts_at_utc_snapshot' => $eventStart->format('Y-m-d H:i:s'),
            'event_timezone_snapshot' => (string) ($event->timezone ?? 'UTC'),
            'opens_at_utc' => $this->offsetDate($eventStart, $settings['opens_offset_seconds'] ?? null),
            'closes_at_utc' => $this->offsetDate($eventStart, $settings['closes_offset_seconds'] ?? null),
            'cancellation_cutoff_at_utc' => $this->offsetDate(
                $eventStart,
                $settings['cancellation_cutoff_offset_seconds'] ?? null,
            ),
            'per_member_limit' => (int) ($settings['per_member_limit'] ?? 1),
            'guests_enabled' => (int) (bool) ($settings['guests_enabled'] ?? false),
            'max_guests_per_registration' => (int) ($settings['max_guests_per_registration'] ?? 0),
            'guest_retention_days' => (int) ($settings['guest_retention_days'] ?? 30),
            'form_state' => 'none',
            'published_form_version' => null,
            'created_by' => $actorId,
            'updated_by' => $actorId,
            'published_by' => null,
            'published_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $this->registrationHistory(
            $tenantId,
            (int) $event->id,
            $settingsId,
            1,
            'created',
            $actorId,
            $blueprintId,
            $settings,
        );
        $counts = ['registration_settings' => 1];
        $form = $definition['published_form'] ?? null;
        if (is_array($form)) {
            $formId = (int) DB::table('event_registration_form_versions')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'version_number' => 1,
                'revision' => 1,
                'status' => 'draft',
                'name' => (string) ($form['name'] ?? ''),
                'description' => $form['description'] ?? null,
                'definition_hash' => null,
                'created_by' => $actorId,
                'updated_by' => $actorId,
                'published_by' => null,
                'published_at' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            $questions = $form['questions'] ?? [];
            if (! is_array($questions)) {
                $this->fail('event_recurrence_definition_manifest_invalid');
            }
            foreach ($questions as $question) {
                if (! is_array($question)) {
                    $this->fail('event_recurrence_definition_manifest_invalid');
                }
                DB::table('event_registration_form_questions')->insert([
                    'tenant_id' => $tenantId,
                    'event_id' => (int) $event->id,
                    'form_version_id' => $formId,
                    'stable_key' => (string) ($question['stable_key'] ?? ''),
                    'position' => (int) ($question['position'] ?? 0),
                    'question_type' => (string) ($question['question_type'] ?? ''),
                    'prompt' => (string) ($question['prompt'] ?? ''),
                    'help_text' => $question['help_text'] ?? null,
                    'is_required' => (int) (bool) ($question['is_required'] ?? false),
                    'data_classification' => (string) ($question['data_classification'] ?? ''),
                    'purpose' => (string) ($question['purpose'] ?? ''),
                    'retention_days' => (int) ($question['retention_days'] ?? 1),
                    'choice_options' => $this->nullableCanonicalJson($question['choice_options'] ?? null),
                    'validation_rules' => $this->nullableCanonicalObjectJson(
                        $question['validation_rules'] ?? null,
                    ),
                    'visibility_rules' => $this->nullableCanonicalObjectJson(
                        $question['visibility_rules'] ?? null,
                    ),
                    'displayed_text' => $question['displayed_text'] ?? null,
                    'displayed_text_version' => $question['displayed_text_version'] ?? null,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }
            $definitionHash = hash('sha256', $this->canonicalJson($form));
            DB::table('event_registration_form_versions')->where('id', $formId)->update([
                'status' => 'published',
                'definition_hash' => $definitionHash,
                'published_by' => $actorId,
                'published_at' => $now,
                'updated_at' => $now,
            ]);
            $counts['published_forms'] = 1;
            $counts['form_questions'] = count($questions);
        }
        $publishSettings = ($settings['status'] ?? 'draft') === 'published';
        if ($publishSettings || is_array($form)) {
            DB::table('event_registration_settings')->where('id', $settingsId)->update([
                'revision' => 2,
                'status' => $publishSettings ? 'published' : 'draft',
                'form_state' => is_array($form) ? 'published' : 'none',
                'published_form_version' => is_array($form) ? 1 : null,
                'updated_by' => $actorId,
                'published_by' => $publishSettings ? $actorId : null,
                'published_at' => $publishSettings ? $now : null,
                'updated_at' => $now,
            ]);
            $this->registrationHistory(
                $tenantId,
                (int) $event->id,
                $settingsId,
                2,
                $publishSettings ? 'published' : 'form_published',
                $actorId,
                $blueprintId,
                ['form_state' => is_array($form) ? 'published' : 'none'],
            );
        }

        return $counts;
    }

    /** @param array<string,mixed> $definition @return array<string,int> */
    private function applySafety(
        int $tenantId,
        object $event,
        array $definition,
        int $actorId,
        int $blueprintId,
    ): array {
        $requirement = $definition['published_requirement'] ?? null;
        if ($requirement === null) {
            return [];
        }
        if (! is_array($requirement)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $now = now();
        $requirementsId = (int) DB::table('event_safety_requirements')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => (int) $event->id,
            'occurrence_key' => (string) $event->occurrence_key,
            'revision' => 1,
            'current_version' => 1,
            'published_version' => null,
            'status' => 'draft',
            'created_by_user_id' => $actorId,
            'updated_by_user_id' => $actorId,
            'published_by_user_id' => null,
            'published_at' => null,
            'archived_by_user_id' => null,
            'archived_at' => null,
            'created_at' => $now,
            'updated_at' => $now,
        ]);
        $hash = hash('sha256', $this->canonicalJson($requirement));
        $versionId = (int) DB::table('event_safety_requirement_versions')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => (int) $event->id,
            'requirements_id' => $requirementsId,
            'version_number' => 1,
            'minimum_age' => $requirement['minimum_age'] ?? null,
            'guardian_consent_required' => (int) (bool) ($requirement['guardian_consent_required'] ?? false),
            'minor_age_threshold' => $requirement['minor_age_threshold'] ?? null,
            'code_of_conduct_required' => (int) (bool) ($requirement['code_of_conduct_required'] ?? false),
            'code_of_conduct_text' => $requirement['code_of_conduct_text'] ?? null,
            'code_of_conduct_text_version' => $requirement['code_of_conduct_text_version'] ?? null,
            'code_of_conduct_text_hash' => $requirement['code_of_conduct_text_hash'] ?? null,
            'eligibility_policy_metadata' => $this->canonicalObjectJson(
                $requirement['eligibility_policy_metadata'] ?? [],
            ),
            'eligibility_policy_hash' => (string) ($requirement['eligibility_policy_hash'] ?? ''),
            'captured_by_user_id' => $actorId,
            'idempotency_hash' => hash('sha256', "rec-def:{$blueprintId}:{$event->id}:safety:saved"),
            'request_hash' => $hash,
            'created_at' => $now,
        ]);
        $this->safetyHistory(
            $tenantId,
            (int) $event->id,
            $requirementsId,
            $versionId,
            1,
            'saved',
            $actorId,
            $blueprintId,
            $hash,
        );
        DB::table('event_safety_requirements')->where('id', $requirementsId)->update([
            'revision' => 2,
            'published_version' => 1,
            'status' => 'published',
            'updated_by_user_id' => $actorId,
            'published_by_user_id' => $actorId,
            'published_at' => $now,
            'updated_at' => $now,
        ]);
        $this->safetyHistory(
            $tenantId,
            (int) $event->id,
            $requirementsId,
            $versionId,
            2,
            'published',
            $actorId,
            $blueprintId,
            $hash,
        );

        return ['safety_requirements' => 1];
    }

    /** @param array<string,mixed> $definition @return array<string,int> */
    private function applyStaff(
        int $tenantId,
        object $event,
        array $definition,
        int $actorId,
        int $blueprintId,
    ): array {
        $assignments = $definition['assignments'] ?? [];
        if (! is_array($assignments)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        $eventStart = $this->instant($event->start_time);
        foreach (array_values($assignments) as $index => $assignment) {
            if (! is_array($assignment)
                || ! $this->activeUserExists($tenantId, (int) ($assignment['user_id'] ?? 0), true)) {
                $this->fail('event_recurrence_definition_reference_invalid');
            }
            $userId = (int) $assignment['user_id'];
            if ($userId === (int) $event->user_id) {
                // The owner already has implicit authority; duplicating an
                // explicit owner assignment would violate the role boundary.
                continue;
            }
            $now = now();
            $expiry = isset($assignment['expires_offset_seconds'])
                ? $eventStart->addSeconds((int) $assignment['expires_offset_seconds'])
                : null;
            if ($expiry !== null && $expiry->isPast()) {
                $this->fail('event_recurrence_definition_reference_invalid');
            }
            $assignmentId = (int) DB::table('event_staff_assignments')->insertGetId([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'user_id' => $userId,
                'role' => (string) ($assignment['role'] ?? ''),
                'status' => 'active',
                'assignment_version' => 1,
                'granted_at' => $now,
                'granted_by' => $actorId,
                'revoked_at' => null,
                'revoked_by' => null,
                'expires_at' => $expiry,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            DB::table('event_staff_assignment_history')->insert([
                'tenant_id' => $tenantId,
                'event_id' => (int) $event->id,
                'assignment_id' => $assignmentId,
                'user_id' => $userId,
                'role' => (string) $assignment['role'],
                'actor_user_id' => $actorId,
                'assignment_version' => 1,
                'action' => 'granted',
                'idempotency_key' => "rec-def:{$blueprintId}:{$event->id}:staff:{$index}",
                'from_status' => null,
                'to_status' => 'active',
                'previous_expires_at' => null,
                'new_expires_at' => $expiry,
                'metadata' => $this->canonicalJson(['source' => 'recurrence_definition_blueprint']),
                'created_at' => $now,
            ]);
        }

        return ['staff_assignments' => count($assignments)];
    }

    /** @param array<string,mixed> $ticket */
    private function ticketHistory(
        int $tenantId,
        int $eventId,
        int $ticketId,
        int $version,
        string $action,
        int $actorId,
        int $blueprintId,
        int $index,
        array $ticket,
    ): void {
        $key = "rec-def:{$blueprintId}:{$eventId}:ticket:{$index}:{$action}";
        DB::table('event_ticket_type_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'ticket_type_id' => $ticketId,
            'ticket_version' => $version,
            'action' => $action,
            'actor_user_id' => $actorId,
            'idempotency_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', $this->canonicalJson($ticket)),
            'changed_fields' => $this->canonicalJson(array_keys($ticket)),
            'reason' => null,
            'created_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $changed */
    private function registrationHistory(
        int $tenantId,
        int $eventId,
        int $settingsId,
        int $revision,
        string $action,
        int $actorId,
        int $blueprintId,
        array $changed,
    ): void {
        $key = "rec-def:{$blueprintId}:{$eventId}:registration:{$revision}";
        DB::table('event_registration_settings_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'settings_id' => $settingsId,
            'revision' => $revision,
            'action' => $action,
            'actor_user_id' => $actorId,
            'idempotency_hash' => hash('sha256', $key),
            'request_hash' => hash('sha256', $this->canonicalJson($changed)),
            'changed_fields' => $this->canonicalJson(array_keys($changed)),
            'created_at' => now(),
        ]);
    }

    private function safetyHistory(
        int $tenantId,
        int $eventId,
        int $requirementsId,
        int $versionId,
        int $revision,
        string $action,
        int $actorId,
        int $blueprintId,
        string $requestHash,
    ): void {
        DB::table('event_safety_requirement_history')->insert([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'requirements_id' => $requirementsId,
            'requirements_revision' => $revision,
            'requirements_version_id' => $versionId,
            'requirements_version_number' => 1,
            'action' => $action,
            'actor_user_id' => $actorId,
            'idempotency_hash' => hash(
                'sha256',
                "rec-def:{$blueprintId}:{$eventId}:safety:{$action}",
            ),
            'request_hash' => $requestHash,
            'metadata' => $this->canonicalJson(['source' => 'recurrence_definition_blueprint']),
            'created_at' => now(),
        ]);
    }

    /** @param array<string,mixed> $raw @return array<string,bool> */
    private function normalizeSections(array $raw): array
    {
        foreach (array_keys($raw) as $key) {
            if (! is_string($key) || ! in_array($key, self::SECTION_ORDER, true)) {
                $this->fail('event_recurrence_definition_sections_invalid');
            }
        }
        $normalized = [];
        $selected = false;
        foreach (self::SECTION_ORDER as $section) {
            $value = $raw[$section] ?? false;
            if (! is_bool($value)) {
                $this->fail('event_recurrence_definition_sections_invalid');
            }
            $normalized[$section] = $value;
            $selected = $selected || $value;
        }
        if (! $selected) {
            $this->fail('event_recurrence_definition_sections_invalid');
        }

        return $normalized;
    }

    /** @param array<string,bool> $sections */
    private function assertSectionSchema(array $sections): void
    {
        foreach ($sections as $section => $selected) {
            if (! $selected) {
                continue;
            }
            foreach (self::SECTION_TABLES[$section] as $table) {
                if (! Schema::hasTable($table)) {
                    $this->fail('event_recurrence_definition_schema_unavailable');
                }
            }
        }
    }

    private function assertRolloutAvailable(): void
    {
        if (! $this->schemaAvailable()) {
            $this->fail('event_recurrence_definition_schema_unavailable');
        }
        if (! $this->rolloutEnabled()) {
            $this->fail('event_recurrence_definition_rollout_disabled');
        }
    }

    private function rolloutEnabled(): bool
    {
        return config('events.recurrence.engine_v2_enabled', false) === true
            && config('events.recurrence.materialization.enabled', false) === true
            && config('events.recurrence.definition_blueprints.enabled', false) === true;
    }

    /** @param array<string,mixed> $context */
    private function requestHash(array $context): string
    {
        return $this->requestFingerprint(
            (int) $context['tenant_id'],
            (int) $context['root']->id,
            (int) $context['source']->id,
            (string) $context['source']->recurrence_id,
            (int) $context['actor']->id,
            (string) $context['effective_from_recurrence_id'],
            $context['sections'],
        );
    }

    /** @param array<string,bool> $sections */
    private function requestFingerprint(
        int $tenantId,
        int $rootEventId,
        int $sourceEventId,
        string $sourceRecurrenceId,
        int $actorUserId,
        string $effectiveFromRecurrenceId,
        array $sections,
    ): string {
        return hash('sha256', $this->canonicalJson([
            'actor_user_id' => $actorUserId,
            'effective_from_recurrence_id' => $effectiveFromRecurrenceId,
            'root_event_id' => $rootEventId,
            'schema_version' => self::SCHEMA_VERSION,
            'sections' => $sections,
            'source_event_id' => $sourceEventId,
            'source_recurrence_id' => $sourceRecurrenceId,
            'tenant_id' => $tenantId,
        ]));
    }

    /** @param array<string,mixed> $claims */
    private function issueToken(array $claims): string
    {
        try {
            return $this->tokens->issue($claims);
        } catch (EventRecurrenceRevisionException $exception) {
            $this->fail(str_contains($exception->reasonCode, 'key_unavailable')
                ? 'event_recurrence_definition_token_key_unavailable'
                : 'event_recurrence_definition_token_invalid');
        }
    }

    /** @return array<string,mixed> */
    private function decodeToken(string $token, bool $enforceExpiry = true): array
    {
        try {
            return $this->tokens->decode($token, $enforceExpiry);
        } catch (EventRecurrenceRevisionException $exception) {
            $this->fail(match (true) {
                str_contains($exception->reasonCode, 'expired') =>
                    'event_recurrence_definition_token_expired',
                str_contains($exception->reasonCode, 'key_unavailable') =>
                    'event_recurrence_definition_token_key_unavailable',
                default => 'event_recurrence_definition_token_invalid',
            });
        }
    }

    /** @param array<string,int>|null $counts @return array<string,mixed> */
    private function commitResult(object $row, bool $replay, ?array $counts = null): array
    {
        return [
            'blueprint_id' => (int) $row->id,
            'root_event_id' => (int) $row->root_event_id,
            'source_event_id' => (int) $row->source_event_id,
            'source_recurrence_id' => (string) $row->source_recurrence_id,
            'blueprint_version' => (int) $row->blueprint_version,
            'schema_version' => (int) $row->schema_version,
            'effective_from_recurrence_id' => (string) $row->effective_from_recurrence_id,
            'selected_sections' => $this->decodeObject($row->selected_sections),
            'manifest_hash' => (string) $row->manifest_hash,
            'counts' => $counts ?? $this->manifestCounts($row->manifest),
            'idempotent_replay' => $replay,
            'created_at' => (string) $row->created_at,
        ];
    }

    /** @return array<string,mixed> */
    private function applicationResult(object $row, bool $replay): array
    {
        return [
            'application_id' => (int) $row->id,
            'blueprint_id' => (int) $row->blueprint_id,
            'blueprint_version' => (int) $row->blueprint_version,
            'event_id' => (int) $row->event_id,
            'recurrence_id' => (string) $row->recurrence_id,
            'manifest_hash' => (string) $row->manifest_hash,
            'application_hash' => (string) $row->application_hash,
            'counts' => $this->decodeObject($row->applied_counts),
            'idempotent_replay' => $replay,
        ];
    }

    /** @return array<string,int> */
    private function manifestCounts(mixed $manifest): array
    {
        $decoded = $this->decodeObject($manifest);
        $definitions = $decoded['definitions'] ?? [];
        if (! is_array($definitions)) {
            return $this->emptyCounts();
        }

        return [
            'sessions' => count($definitions['agenda']['sessions'] ?? []),
            'speakers' => array_sum(array_map(
                static fn (array $session): int => count($session['speakers'] ?? []),
                $definitions['agenda']['sessions'] ?? [],
            )),
            'resources' => array_sum(array_map(
                static fn (array $session): int => count($session['resources'] ?? []),
                $definitions['agenda']['sessions'] ?? [],
            )),
            'ticket_types' => count($definitions['ticket_types']['ticket_types'] ?? []),
            'registration_settings' => isset($definitions['registration']['settings']) ? 1 : 0,
            'published_forms' => isset($definitions['registration']['published_form']) ? 1 : 0,
            'form_questions' => count($definitions['registration']['published_form']['questions'] ?? []),
            'safety_requirements' => isset($definitions['safety']['published_requirement']) ? 1 : 0,
            'staff_assignments' => count($definitions['staff']['assignments'] ?? []),
        ];
    }

    /** @return array<string,int> */
    private function emptyCounts(): array
    {
        return [
            'sessions' => 0,
            'speakers' => 0,
            'resources' => 0,
            'ticket_types' => 0,
            'registration_settings' => 0,
            'published_forms' => 0,
            'form_questions' => 0,
            'safety_requirements' => 0,
            'staff_assignments' => 0,
        ];
    }

    /** @return array{section:string,code:string,count:int} */
    private function conflict(string $section, string $code, int $count): array
    {
        return ['section' => $section, 'code' => $code, 'count' => $count];
    }

    private function activeUserExists(int $tenantId, int $userId, bool $lock): bool
    {
        if ($userId <= 0) {
            return false;
        }
        $query = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $userId)
            ->where('status', 'active')
            ->whereNull('deleted_at');

        return $lock
            ? $query->lockForUpdate()->first(['id']) !== null
            : $query->exists();
    }

    private function applicationActorId(int $tenantId, int $ownerId): ?int
    {
        if ($this->activeUserExists($tenantId, $ownerId, true)) {
            return $ownerId;
        }
        $actor = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->where(static function (Builder $admin): void {
                $admin->whereIn('role', ['admin', 'super_admin'])
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1);
            })
            ->orderByDesc('is_super_admin')
            ->orderByDesc('is_admin')
            ->orderBy('id')
            ->lockForUpdate()
            ->first(['id']);

        return $actor !== null ? (int) $actor->id : null;
    }

    private function nullableOffset(CarbonImmutable $eventStart, mixed $value): ?int
    {
        return $value === null
            ? null
            : (int) $eventStart->diffInSeconds($this->instant($value), false);
    }

    private function offsetDate(CarbonImmutable $eventStart, mixed $offset): ?string
    {
        return $offset === null
            ? null
            : $eventStart->addSeconds((int) $offset)->format('Y-m-d H:i:s');
    }

    private function instant(mixed $value): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse((string) $value, 'UTC')->utc();
        } catch (\Throwable) {
            $this->fail('event_recurrence_definition_time_invalid');
        }
    }

    private function utcString(mixed $value): string
    {
        return $this->instant($value)->format('Y-m-d H:i:s');
    }

    private function validRecurrenceId(string $value): bool
    {
        return preg_match('/^\d{8}T\d{6}Z$/D', $value) === 1;
    }

    private function limit(string $key, int $default): int
    {
        return max(1, min(
            (int) config("events.recurrence.definition_blueprints.{$key}", $default),
            1000,
        ));
    }

    private function lock(Builder $query, bool $lock): Builder
    {
        return $lock ? $query->lockForUpdate() : $query;
    }

    /** @return array<string,mixed> */
    private function decodeObject(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (! is_string($value) || $value === '') {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        try {
            $decoded = json_decode($value, true, 128, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
        if (! is_array($decoded) || ($decoded !== [] && array_is_list($decoded))) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }

        return $decoded;
    }

    private function nullableJson(mixed $value): mixed
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_array($value)) {
            return $value;
        }
        try {
            return json_decode((string) $value, true, 128, JSON_THROW_ON_ERROR);
        } catch (JsonException) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
    }

    private function nullableCanonicalJson(mixed $value): ?string
    {
        return $value === null ? null : $this->canonicalJson($value);
    }

    private function nullableCanonicalObjectJson(mixed $value): ?string
    {
        return $value === null ? null : $this->canonicalObjectJson($value);
    }

    private function canonicalObjectJson(mixed $value): string
    {
        if ($value === []) {
            return '{}';
        }
        if (! is_array($value) || array_is_list($value)) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }

        return $this->canonicalJson($value);
    }

    private function canonicalJson(mixed $value): string
    {
        try {
            return json_encode(
                $this->canonicalize($value),
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            );
        } catch (JsonException) {
            $this->fail('event_recurrence_definition_manifest_invalid');
        }
    }

    private function canonicalize(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (array_is_list($value)) {
            return array_map(fn (mixed $item): mixed => $this->canonicalize($item), $value);
        }
        ksort($value, SORT_STRING);
        foreach ($value as $key => $item) {
            $value[$key] = $this->canonicalize($item);
        }

        return $value;
    }

    private function fail(string $reason): never
    {
        throw new EventRecurrenceDefinitionBlueprintException($reason);
    }
}
