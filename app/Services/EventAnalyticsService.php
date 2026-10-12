<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventAnalyticsFactStatus;
use App\Enums\EventAnalyticsMetric;
use App\Exceptions\EventAnalyticsException;
use App\Models\Event;
use App\Models\EventAnalyticsOptionalFact;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventAnalyticsCaptureResult;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use JsonException;
use App\Support\Authorization\ManagerDelegate;

/**
 * Consent boundary for optional Event funnel analytics.
 *
 * Registration, waitlist, attendance, credit, and delivery metrics are always
 * derived from their canonical ledgers and are deliberately not written here.
 */
final class EventAnalyticsService
{
    /** @var list<string> */
    private const SOURCE_SURFACES = [
        'event_list',
        'event_detail',
        'calendar',
        'search',
        'notification',
        'direct',
        'registration',
    ];

    /** @var list<string> */
    private const CLIENT_PLATFORMS = [
        'react_web',
        'accessible_web',
        'native_mobile',
    ];

    public function __construct(private readonly EventPolicy $policy)
    {
    }

    /**
     * @return array<string,array{owner:string,purpose:string,source:string,deduplication:string,late_event_rule:string,consent_required:bool}>
     */
    public function metricDictionary(): array
    {
        $dictionary = [];
        foreach (EventAnalyticsMetric::cases() as $metric) {
            $dictionary[$metric->value] = $metric->definition();
        }

        return $dictionary;
    }

    /**
     * @param array{source_surface:string,client_platform:string} $dimensions
     */
    public function recordOptional(
        int $eventId,
        User $actor,
        EventAnalyticsMetric $metric,
        string $deduplicationId,
        DateTimeInterface $occurredAt,
        array $dimensions,
    ): EventAnalyticsCaptureResult {
        $this->assertSchemaAvailable();
        if (! $metric->isOptional()) {
            throw new EventAnalyticsException('event_analytics_operational_fact_forbidden');
        }
        if (! (bool) config('events.analytics.optional_capture_enabled', false)) {
            return new EventAnalyticsCaptureResult(false, false, 'suppressed_disabled');
        }

        $tenantId = $this->tenantId();
        [$persistedActor, $event] = $this->authorizedSubjects($tenantId, $eventId, $actor);
        $normalizedDimensions = $this->dimensions($dimensions);
        $occurred = CarbonImmutable::instance($occurredAt)->utc()->startOfSecond();
        $received = CarbonImmutable::now('UTC')->startOfSecond();
        $maximumFutureMinutes = max(0, (int) config(
            'events.analytics.max_future_minutes',
            5,
        ));
        $maximumLateDays = max(1, (int) config('events.analytics.max_late_days', 30));
        $lateAfterHours = max(1, (int) config('events.analytics.late_after_hours', 24));
        $retentionDays = max(1, (int) config('events.analytics.retention_days', 365));
        if ($occurred->isAfter($received->addMinutes($maximumFutureMinutes))) {
            throw new EventAnalyticsException('event_analytics_occurred_at_future');
        }
        if ($occurred->isBefore($received->subDays($maximumLateDays))) {
            throw new EventAnalyticsException('event_analytics_late_window_expired');
        }

        $deduplicationId = trim($deduplicationId);
        if (mb_strlen($deduplicationId) < 8 || mb_strlen($deduplicationId) > 191) {
            throw new EventAnalyticsException('event_analytics_deduplication_id_invalid');
        }
        $deduplicationHash = hash('sha256', $deduplicationId);
        $requestHash = $this->payloadHash([
            'schema_version' => 1,
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'metric' => $metric->value,
            'deduplication_hash' => $deduplicationHash,
            'occurred_at' => $occurred->format(DATE_ATOM),
            'dimensions' => $normalizedDimensions,
        ]);

        return DB::transaction(function () use (
            $tenantId,
            $eventId,
            $persistedActor,
            $event,
            $metric,
            $deduplicationHash,
            $requestHash,
            $occurred,
            $received,
            $lateAfterHours,
            $retentionDays,
            $normalizedDimensions,
        ): EventAnalyticsCaptureResult {
            $replay = $this->factByDeduplication($tenantId, $deduplicationHash, true);
            if ($replay !== null) {
                return $this->replayResult($replay, $requestHash);
            }

            // Lock the exact consent evidence before inserting. A concurrent
            // withdrawal therefore wins before this query or waits until the
            // fact is committed and can anonymise it in the same withdrawal.
            $consent = DB::table('cookie_consents')
                ->where('tenant_id', $tenantId)
                ->where('user_id', (int) $persistedActor->id)
                ->where('analytics', 1)
                ->whereNull('withdrawal_date')
                ->where(static function ($query) use ($received): void {
                    $query->whereNull('expires_at')->orWhere('expires_at', '>', $received);
                })
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->lockForUpdate()
                ->first(['id', 'consent_version']);
            if ($consent === null) {
                return new EventAnalyticsCaptureResult(
                    false,
                    false,
                    'suppressed_no_consent',
                );
            }

            $subjectHash = $this->subjectHash($tenantId, (int) $persistedActor->id);
            try {
                $factId = (int) DB::table('event_analytics_optional_facts')->insertGetId([
                    'tenant_id' => $tenantId,
                    'event_id' => $eventId,
                    'occurrence_key' => is_string($event->occurrence_key)
                        ? $event->occurrence_key
                        : null,
                    'metric' => $metric->value,
                    'deduplication_hash' => $deduplicationHash,
                    'request_hash' => $requestHash,
                    'subject_hash' => $subjectHash,
                    'pseudonym_key_version' => $this->pseudonymKeyVersion(),
                    'consent_record_id' => (int) $consent->id,
                    'consent_version' => (string) ($consent->consent_version ?? '1.0'),
                    'source_surface' => $normalizedDimensions['source_surface'],
                    'client_platform' => $normalizedDimensions['client_platform'],
                    'dimensions' => json_encode($normalizedDimensions, JSON_THROW_ON_ERROR),
                    'is_late' => $occurred->isBefore($received->subHours($lateAfterHours)),
                    'occurred_at' => $occurred,
                    'received_at' => $received,
                    'retention_due_at' => $occurred->addDays($retentionDays),
                    'status' => EventAnalyticsFactStatus::Active->value,
                ]);
            } catch (QueryException $exception) {
                if (! $this->isUniqueConflict($exception)) {
                    throw $exception;
                }
                $replay = $this->factByDeduplication($tenantId, $deduplicationHash, true);
                if ($replay === null) {
                    throw $exception;
                }

                return $this->replayResult($replay, $requestHash);
            }

            return new EventAnalyticsCaptureResult(
                true,
                true,
                'recorded',
                EventAnalyticsOptionalFact::withoutGlobalScopes()->findOrFail($factId),
            );
        }, 3);
    }

    /**
     * Remove linkable optional facts after analytics consent withdrawal.
     * The aggregate fact is excluded and retained only as privacy-operation
     * evidence; no operational Event ledger is changed.
     *
     * @return array{withdrawn:int,replayed:bool,run_id:int}
     */
    public function withdrawForActor(User $actor, string $idempotencyKey): array
    {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantId();
        $persistedActor = $this->activeActor($tenantId, $actor);
        $idempotencyKey = trim($idempotencyKey);
        if ($idempotencyKey === '' || mb_strlen($idempotencyKey) > 191) {
            throw new EventAnalyticsException('event_analytics_idempotency_key_invalid');
        }
        $idempotencyHash = hash('sha256', $idempotencyKey);
        $consentIds = DB::table('cookie_consents')
            ->where('tenant_id', $tenantId)
            ->where('user_id', (int) $persistedActor->id)
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn (mixed $id): int => (int) $id)
            ->all();
        $requestHash = $this->payloadHash([
            'schema_version' => 1,
            'tenant_id' => $tenantId,
            'actor_user_id' => (int) $persistedActor->id,
            'consent_ids' => $consentIds,
        ]);

        return DB::transaction(function () use (
            $tenantId,
            $persistedActor,
            $idempotencyHash,
            $requestHash,
            $consentIds,
        ): array {
            $replay = DB::table('event_analytics_withdrawal_runs')
                ->where('tenant_id', $tenantId)
                ->where('idempotency_hash', $idempotencyHash)
                ->lockForUpdate()
                ->first();
            if ($replay !== null) {
                if (! hash_equals((string) $replay->request_hash, $requestHash)) {
                    throw new EventAnalyticsException('event_analytics_idempotency_conflict');
                }

                return [
                    'withdrawn' => (int) $replay->fact_count,
                    'replayed' => true,
                    'run_id' => (int) $replay->id,
                ];
            }

            $now = CarbonImmutable::now('UTC')->startOfSecond();
            $withdrawn = $consentIds === [] ? 0 : DB::table('event_analytics_optional_facts')
                ->where('tenant_id', $tenantId)
                ->whereIn('consent_record_id', $consentIds)
                ->where('status', EventAnalyticsFactStatus::Active->value)
                ->update([
                    'subject_hash' => null,
                    'pseudonym_key_version' => null,
                    'consent_record_id' => null,
                    'consent_version' => null,
                    'dimensions' => json_encode((object) [], JSON_THROW_ON_ERROR),
                    'status' => EventAnalyticsFactStatus::Withdrawn->value,
                    'withdrawn_at' => $now,
                ]);

            $runId = (int) DB::table('event_analytics_withdrawal_runs')->insertGetId([
                'tenant_id' => $tenantId,
                'actor_user_id' => (int) $persistedActor->id,
                'idempotency_hash' => $idempotencyHash,
                'request_hash' => $requestHash,
                'consent_count' => count($consentIds),
                'fact_count' => $withdrawn,
                'created_at' => $now,
            ]);

            return ['withdrawn' => $withdrawn, 'replayed' => false, 'run_id' => $runId];
        }, 3);
    }

    /**
     * Append evidence for an organizer/tenant analytics read or export without
     * storing the query filters themselves.
     *
     * @param array<string,mixed> $queryDefinition
     */
    public function auditAccess(
        int $eventId,
        User $actor,
        string $scope,
        string $purposeCode,
        array $queryDefinition,
        int $resultCount,
        int $suppressedCount,
    ): int {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantId();
        [$persistedActor] = $this->managedSubjects($tenantId, $eventId, $actor);
        if (! in_array($scope, ['organizer_summary', 'tenant_summary', 'csv_export'], true)) {
            throw new EventAnalyticsException('event_analytics_access_scope_invalid');
        }
        if (! in_array($purposeCode, [
            'dashboard_view',
            'csv_export',
            'accessibility_aggregate',
            'operational_reconciliation',
        ], true)) {
            throw new EventAnalyticsException('event_analytics_access_purpose_invalid');
        }
        if ($resultCount < 0 || $suppressedCount < 0 || $suppressedCount > $resultCount) {
            throw new EventAnalyticsException('event_analytics_access_count_invalid');
        }
        $threshold = max(5, (int) config('events.analytics.privacy_threshold', 5));

        return (int) DB::table('event_analytics_access_audits')->insertGetId([
            'tenant_id' => $tenantId,
            'event_id' => $eventId,
            'actor_user_id' => (int) $persistedActor->id,
            'access_scope' => $scope,
            'purpose_code' => $purposeCode,
            'query_hash' => $this->payloadHash([
                'schema_version' => 1,
                'scope' => $scope,
                'purpose_code' => $purposeCode,
                'query' => $queryDefinition,
            ]),
            'result_count' => $resultCount,
            'suppressed_count' => $suppressedCount,
            'privacy_threshold' => $threshold,
            'created_at' => CarbonImmutable::now('UTC')->startOfSecond(),
        ]);
    }

    /** @return array{0:User,1:Event} */
    private function authorizedSubjects(int $tenantId, int $eventId, User $actor): array
    {
        $persistedActor = $this->activeActor($tenantId, $actor);
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null || ! $this->policy->view($persistedActor, $event)) {
            throw new EventAnalyticsException('event_analytics_event_not_found');
        }

        return [$persistedActor, $event];
    }

    /** @return array{0:User,1:Event} */
    private function managedSubjects(int $tenantId, int $eventId, User $actor): array
    {
        $persistedActor = $this->activeActor($tenantId, $actor);
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if ($event === null || ! $this->policy->manage($persistedActor, $event)) {
            throw new EventAnalyticsException('event_analytics_event_not_found');
        }

        return [$persistedActor, $event];
    }

    private function activeActor(int $tenantId, User $actor): User
    {
        $actorId = (int) $actor->getKey();
        $persisted = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($actorId)
            ->whereIn('status', ['active', ManagerDelegate::STATUS]) // or a manager's delegate
            ->whereNull('deleted_at')
            ->first();
        if ($persisted === null || (int) $actor->getAttribute('tenant_id') !== $tenantId) {
            throw new EventAnalyticsException('event_analytics_actor_invalid');
        }

        return $persisted;
    }

    /** @param array{source_surface?:mixed,client_platform?:mixed} $dimensions
     * @return array{source_surface:string,client_platform:string}
     */
    private function dimensions(array $dimensions): array
    {
        $keys = array_keys($dimensions);
        sort($keys);
        if ($keys !== ['client_platform', 'source_surface']) {
            throw new EventAnalyticsException('event_analytics_dimensions_invalid');
        }
        $surface = is_string($dimensions['source_surface'])
            ? trim($dimensions['source_surface'])
            : '';
        $platform = is_string($dimensions['client_platform'])
            ? trim($dimensions['client_platform'])
            : '';
        if (! in_array($surface, self::SOURCE_SURFACES, true)
            || ! in_array($platform, self::CLIENT_PLATFORMS, true)) {
            throw new EventAnalyticsException('event_analytics_dimensions_invalid');
        }

        return ['source_surface' => $surface, 'client_platform' => $platform];
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventAnalyticsException('event_analytics_tenant_context_missing');
        }
        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventAnalyticsException('event_analytics_feature_disabled');
            }
        } catch (EventAnalyticsException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new EventAnalyticsException('event_analytics_feature_disabled');
        }

        return $tenantId;
    }

    private function subjectHash(int $tenantId, int $userId): string
    {
        return hash_hmac(
            'sha256',
            "events:analytics:tenant:{$tenantId}:user:{$userId}",
            hash('sha256', (string) config('app.key'), true),
        );
    }

    private function pseudonymKeyVersion(): string
    {
        return substr(hash('sha256', (string) config('app.key')), 0, 16);
    }

    private function factByDeduplication(
        int $tenantId,
        string $deduplicationHash,
        bool $lock,
    ): ?EventAnalyticsOptionalFact {
        $query = EventAnalyticsOptionalFact::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('deduplication_hash', $deduplicationHash);
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first();
    }

    private function replayResult(
        EventAnalyticsOptionalFact $fact,
        string $requestHash,
    ): EventAnalyticsCaptureResult {
        if (! hash_equals((string) $fact->request_hash, $requestHash)) {
            throw new EventAnalyticsException('event_analytics_idempotency_conflict');
        }

        return new EventAnalyticsCaptureResult(
            $fact->status === EventAnalyticsFactStatus::Active,
            false,
            $fact->status === EventAnalyticsFactStatus::Active
                ? 'replayed'
                : 'suppressed_withdrawn',
            $fact,
        );
    }

    /** @param array<string,mixed> $payload */
    private function payloadHash(array $payload): string
    {
        try {
            return hash('sha256', json_encode(
                $payload,
                JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE,
            ));
        } catch (JsonException) {
            throw new EventAnalyticsException('event_analytics_payload_invalid');
        }
    }

    private function isUniqueConflict(QueryException $exception): bool
    {
        return (string) ($exception->errorInfo[0] ?? $exception->getCode()) === '23000'
            || (int) ($exception->errorInfo[1] ?? 0) === 1062;
    }

    private function assertSchemaAvailable(): void
    {
        if (! Schema::hasTable('event_analytics_optional_facts')
            || ! Schema::hasTable('event_analytics_withdrawal_runs')
            || ! Schema::hasTable('cookie_consents')) {
            throw new EventAnalyticsException('event_analytics_schema_unavailable');
        }
    }
}
