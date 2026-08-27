<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventGuardianConsentStatus;
use App\Enums\EventParticipationDenialStatus;
use App\Enums\EventSafetyCodeEvidenceAction;
use App\Enums\EventSafetyEnforcementMode;
use App\Enums\EventSafetyRequirementStatus;
use App\Exceptions\EventSafetyException;
use App\Models\Event;
use App\Models\EventGuardianConsent;
use App\Models\EventParticipationDenial;
use App\Models\EventSafetyCodeAcknowledgement;
use App\Models\EventSafetyRequirement;
use App\Models\EventSafetyRequirementVersion;
use App\Models\User;
use App\Policies\EventPolicy;
use App\Support\Events\EventSafetyContractMapper;
use App\Support\Events\EventSafetyEligibilityDecision;
use App\Support\Events\EventSafetyFoundationSupport;
use BackedEnum;
use Carbon\CarbonImmutable;
use DateTimeInterface;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Throwable;

/**
 * Tenant-scoped, privacy-minimised read model for the Event Safety contract.
 *
 * Guardian identity, guardian tokens, safeguarding-policy evidence, request
 * hashes, and free-text review notes are deliberately absent from this class.
 */
final class EventSafetyProjectionService
{
    private readonly EventSafetyFoundationSupport $support;

    private readonly EventSafetyEligibilityService $eligibility;

    private readonly EventPolicy $policy;

    public function __construct(
        ?EventSafetyFoundationSupport $support = null,
        ?EventSafetyEligibilityService $eligibility = null,
        ?EventPolicy $policy = null,
    ) {
        $this->support = $support ?? new EventSafetyFoundationSupport();
        $this->eligibility = $eligibility ?? new EventSafetyEligibilityService();
        $this->policy = $policy ?? new EventPolicy();
    }

    /** @return array<string,mixed> */
    public function read(int $eventId, User|int $actor): array
    {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $event = $this->support->concreteEvent($tenantId, $eventId);
        $persistedActor = $this->support->activeUser(
            $tenantId,
            $actor,
            false,
            'event_safety_actor_not_active',
        );
        if (! $this->policy->view($persistedActor, $event)) {
            throw new EventSafetyException('event_safety_authorization_denied');
        }

        $rollout = EventSafetyEnforcementModeResolver::inspect($tenantId);
        if (! $rollout['configuration_valid']) {
            throw new EventSafetyException('event_safety_rollout_configuration_invalid');
        }
        $mode = EventSafetyEnforcementMode::from($rollout['resolved_mode']);
        $canManage = $this->policy->manage($persistedActor, $event);
        [$requirements, $version] = $this->visibleRequirements(
            $tenantId,
            $eventId,
            $canManage,
        );
        [$publishedRequirements, $publishedVersion] = $this->publishedRequirements(
            $tenantId,
            $eventId,
        );

        $decision = null;
        if ($publishedVersion !== null || $mode->evaluatesParticipation()) {
            $decision = $this->eligibility->evaluate($eventId, $persistedActor);
        }
        $evidence = $this->evidence(
            $tenantId,
            $event,
            $persistedActor,
            $publishedRequirements,
            $publishedVersion,
            $decision,
        );

        return EventSafetyContractMapper::project(
            event: $event,
            requirements: $requirements,
            version: $version,
            eligibility: $decision,
            evidence: $evidence,
            permissions: $this->permissions(
                $canManage,
                $publishedVersion,
                $decision,
                $evidence,
            ),
            rollout: $rollout,
        );
    }

    /**
     * Return the controlled participation-review ledger. This is not a member
     * directory and intentionally contains only subjects with a durable review.
     *
     * @return array{
     *   items:list<array<string,mixed>>,
     *   total:int,
     *   page:int,
     *   per_page:int
     * }
     */
    public function reviews(
        int $eventId,
        User|int $actor,
        int $page = 1,
        int $perPage = 25,
    ): array {
        $this->assertSchema();
        $tenantId = $this->support->tenantId();
        $event = $this->support->concreteEvent($tenantId, $eventId);
        $persistedActor = $this->support->activeUser(
            $tenantId,
            $actor,
            false,
            'event_safety_actor_not_active',
        );
        $this->support->authorizeManager($persistedActor, $event);
        $page = max(1, $page);
        $maximum = max(1, min(100, (int) config('events.safety.max_review_page_size', 50)));
        $perPage = max(1, min($maximum, $perPage));

        $base = DB::table('event_participation_denials as denial')
            ->where('denial.tenant_id', $tenantId)
            ->where('denial.event_id', $eventId);
        $total = (clone $base)->count('denial.id');
        $rows = $base
            ->join('users as member', function ($join) use ($tenantId): void {
                $join->on('member.id', '=', 'denial.user_id')
                    ->where('member.tenant_id', '=', $tenantId);
            })
            ->join('users as reviewer', function ($join) use ($tenantId): void {
                $join->on('reviewer.id', '=', 'denial.reviewed_by_user_id')
                    ->where('reviewer.tenant_id', '=', $tenantId);
            })
            ->orderByDesc('denial.updated_at')
            ->orderByDesc('denial.id')
            ->offset(($page - 1) * $perPage)
            ->limit($perPage)
            ->get([
                'denial.id',
                'denial.user_id',
                'denial.decision',
                'denial.reason_code',
                'denial.status',
                'denial.decision_version',
                'denial.effective_from',
                'denial.effective_until',
                'denial.updated_at',
                'denial.reviewed_by_user_id',
                'member.name as member_name',
                'member.first_name as member_first_name',
                'member.last_name as member_last_name', 'member.profile_type as member_profile_type', 'member.organization_name as member_organization_name',
                'member.username as member_username',
                'member.avatar_url as member_avatar_url',
                'reviewer.name as reviewer_name',
                'reviewer.first_name as reviewer_first_name',
                'reviewer.last_name as reviewer_last_name', 'reviewer.profile_type as reviewer_profile_type', 'reviewer.organization_name as reviewer_organization_name',
                'reviewer.username as reviewer_username',
            ]);

        $denialIds = $rows->pluck('id')->map(static fn (mixed $id): int => (int) $id)->all();
        $history = $this->reviewHistory($tenantId, $eventId, $denialIds);
        $items = [];
        foreach ($rows as $row) {
            $denialId = (int) $row->id;
            $items[] = [
                'denial' => [
                    'id' => $denialId,
                    'decision' => (string) $row->decision,
                    'reason_code' => (string) $row->reason_code,
                    'status' => (string) $row->status,
                    'decision_version' => (int) $row->decision_version,
                    'effective_from' => self::date($row->effective_from),
                    'effective_until' => self::date($row->effective_until),
                    'reviewed_at' => self::date($row->updated_at),
                ],
                'member' => [
                    'id' => (int) $row->user_id,
                    'display_name' => self::displayName(
                        $row->member_name,
                        $row->member_first_name,
                        $row->member_last_name,
                        $row->member_username,
                    ),
                    'avatar_url' => self::nullableString($row->member_avatar_url),
                ],
                'reviewer' => [
                    'id' => (int) $row->reviewed_by_user_id,
                    'display_name' => self::displayName(
                        $row->reviewer_name,
                        $row->reviewer_first_name,
                        $row->reviewer_last_name,
                        $row->reviewer_username,
                    ),
                ],
                'history' => $history[$denialId] ?? [],
            ];
        }

        return [
            'items' => $items,
            'total' => $total,
            'page' => $page,
            'per_page' => $perPage,
        ];
    }

    /** @return array{0:?EventSafetyRequirement,1:?EventSafetyRequirementVersion} */
    private function visibleRequirements(int $tenantId, int $eventId, bool $canManage): array
    {
        $query = EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId);
        if (! $canManage) {
            $query->where('status', EventSafetyRequirementStatus::Published->value);
        }
        $requirements = $query->first();
        if ($requirements === null) {
            return [null, null];
        }
        $versionNumber = $canManage
            ? (int) $requirements->current_version
            : (int) ($requirements->published_version ?? 0);
        if ($versionNumber <= 0) {
            return [null, null];
        }
        $version = EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('version_number', $versionNumber)
            ->first();
        if ($version === null) {
            throw new EventSafetyException('event_safety_requirements_version_unavailable');
        }

        return [$requirements, $version];
    }

    /** @return array{0:?EventSafetyRequirement,1:?EventSafetyRequirementVersion} */
    private function publishedRequirements(int $tenantId, int $eventId): array
    {
        $requirements = EventSafetyRequirement::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', EventSafetyRequirementStatus::Published->value)
            ->whereNotNull('published_version')
            ->first();
        if ($requirements === null) {
            return [null, null];
        }
        $version = EventSafetyRequirementVersion::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('version_number', (int) $requirements->published_version)
            ->first();
        if ($version === null) {
            throw new EventSafetyException('event_safety_requirements_version_unavailable');
        }

        return [$requirements, $version];
    }

    /**
     * @return array{
     *   code_of_conduct:?array<string,mixed>,
     *   guardian_consent:?array<string,mixed>,
     *   active_denial:?array<string,mixed>
     * }
     */
    private function evidence(
        int $tenantId,
        Event $event,
        User $actor,
        ?EventSafetyRequirement $requirements,
        ?EventSafetyRequirementVersion $version,
        ?EventSafetyEligibilityDecision $decision,
    ): array {
        if ($requirements === null || $version === null) {
            return [
                'code_of_conduct' => null,
                'guardian_consent' => null,
                'active_denial' => $this->activeDenial($tenantId, $event, (int) $actor->id),
            ];
        }

        return [
            'code_of_conduct' => $this->codeEvidence(
                $tenantId,
                (int) $event->id,
                (int) $actor->id,
                $requirements,
                $version,
            ),
            'guardian_consent' => $this->guardianEvidence(
                $tenantId,
                (int) $event->id,
                (int) $actor->id,
                $requirements,
                $version,
                $decision,
            ),
            'active_denial' => $this->activeDenial($tenantId, $event, (int) $actor->id),
        ];
    }

    /** @return array<string,mixed>|null */
    private function codeEvidence(
        int $tenantId,
        int $eventId,
        int $userId,
        EventSafetyRequirement $requirements,
        EventSafetyRequirementVersion $version,
    ): ?array {
        if (! (bool) $version->code_of_conduct_required) {
            return null;
        }
        $acknowledgement = EventSafetyCodeAcknowledgement::withoutGlobalScopes()
            ->from('event_safety_code_acknowledgements as acknowledged')
            ->where('acknowledged.tenant_id', $tenantId)
            ->where('acknowledged.event_id', $eventId)
            ->where('acknowledged.user_id', $userId)
            ->where('acknowledged.requirements_id', (int) $requirements->id)
            ->where('acknowledged.requirements_version_id', (int) $version->id)
            ->where('acknowledged.action', EventSafetyCodeEvidenceAction::Acknowledged->value)
            ->where('acknowledged.text_version', (string) $version->code_of_conduct_text_version)
            ->where('acknowledged.text_hash', (string) $version->code_of_conduct_text_hash)
            ->whereNotExists(static function (Builder $terminal): void {
                $terminal->selectRaw('1')
                    ->from('event_safety_code_acknowledgements as terminal')
                    ->whereColumn(
                        'terminal.referenced_acknowledgement_id',
                        'acknowledged.id',
                    )
                    ->whereIn('terminal.action', [
                        EventSafetyCodeEvidenceAction::Withdrawn->value,
                        EventSafetyCodeEvidenceAction::Replaced->value,
                    ]);
            })
            ->orderByDesc('acknowledged.evidence_sequence')
            ->first();

        return [
            'status' => $acknowledgement !== null ? 'acknowledged' : 'required',
            'acknowledgement_id' => $acknowledgement?->id,
            'text_version' => (string) $version->code_of_conduct_text_version,
            'acknowledged_at' => $acknowledgement?->acknowledged_at,
        ];
    }

    /** @return array<string,mixed>|null */
    private function guardianEvidence(
        int $tenantId,
        int $eventId,
        int $userId,
        EventSafetyRequirement $requirements,
        EventSafetyRequirementVersion $version,
        ?EventSafetyEligibilityDecision $decision,
    ): ?array {
        if (! (bool) $version->guardian_consent_required
            || $decision?->minorAtEvent !== true) {
            return null;
        }
        $consent = EventGuardianConsent::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('minor_user_id', $userId)
            ->where('requirements_id', (int) $requirements->id)
            ->where('requirements_version_id', (int) $version->id)
            ->where('active_slot', 1)
            ->first();
        if ($consent === null) {
            return [
                'status' => 'required',
                'consent_id' => null,
                'consent_version' => null,
                'expires_at' => null,
                'granted_at' => null,
            ];
        }
        $status = self::enum($consent->status);
        if ($consent->expires_at !== null
            && CarbonImmutable::instance($consent->expires_at)->isPast()) {
            $status = EventGuardianConsentStatus::Expired->value;
        }

        return [
            'status' => $status,
            'consent_id' => (int) $consent->id,
            'consent_version' => (int) $consent->consent_version,
            'expires_at' => $consent->expires_at,
            'granted_at' => $consent->granted_at,
        ];
    }

    /** @return array<string,mixed>|null */
    private function activeDenial(int $tenantId, Event $event, int $userId): ?array
    {
        $eventStart = $this->support->eventStartContext($event)['start_utc']->format('Y-m-d H:i:s');
        $denial = EventParticipationDenial::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('event_id', (int) $event->id)
            ->where('user_id', $userId)
            ->where('status', EventParticipationDenialStatus::Active->value)
            ->where('effective_from', '<=', $eventStart)
            ->where(static function ($query) use ($eventStart): void {
                $query->whereNull('effective_until')
                    ->orWhere('effective_until', '>', $eventStart);
            })
            ->first();
        if ($denial === null) {
            return null;
        }

        return [
            'id' => (int) $denial->id,
            'decision' => self::enum($denial->decision),
            'reason_code' => self::enum($denial->reason_code),
            'status' => self::enum($denial->status),
            'decision_version' => (int) $denial->decision_version,
            'effective_from' => $denial->effective_from,
            'effective_until' => $denial->effective_until,
        ];
    }

    /**
     * @param array<string,mixed> $evidence
     * @return array<string,bool>
     */
    private function permissions(
        bool $canManage,
        ?EventSafetyRequirementVersion $version,
        ?EventSafetyEligibilityDecision $decision,
        array $evidence,
    ): array {
        $code = $evidence['code_of_conduct'] ?? null;
        $guardian = $evidence['guardian_consent'] ?? null;
        $guardianStatus = is_array($guardian) ? ($guardian['status'] ?? null) : null;

        return [
            'manage_requirements' => $canManage,
            'review_participation' => $canManage,
            'acknowledge_code_of_conduct' => $version !== null
                && (bool) $version->code_of_conduct_required
                && is_array($code)
                && ($code['status'] ?? null) === 'required',
            'withdraw_code_of_conduct' => is_array($code)
                && ($code['status'] ?? null) === 'acknowledged',
            'request_guardian_consent' => $version !== null
                && (bool) $version->guardian_consent_required
                && $decision?->minorAtEvent === true
                && in_array($guardianStatus, [null, 'required', 'expired', 'withdrawn'], true),
            'withdraw_guardian_consent' => in_array(
                $guardianStatus,
                [EventGuardianConsentStatus::Pending->value, EventGuardianConsentStatus::Active->value],
                true,
            ),
        ];
    }

    /** @param list<int> $denialIds @return array<int,list<array<string,mixed>>> */
    private function reviewHistory(int $tenantId, int $eventId, array $denialIds): array
    {
        if ($denialIds === []) {
            return [];
        }
        $rows = DB::table('event_participation_denial_history as history')
            ->join('users as reviewer', function ($join) use ($tenantId): void {
                $join->on('reviewer.id', '=', 'history.reviewer_user_id')
                    ->where('reviewer.tenant_id', '=', $tenantId);
            })
            ->where('history.tenant_id', $tenantId)
            ->where('history.event_id', $eventId)
            ->whereIn('history.denial_id', $denialIds)
            ->orderByDesc('history.decision_version')
            ->orderByDesc('history.id')
            ->get([
                'history.denial_id',
                'history.decision_version',
                'history.decision',
                'history.reason_code',
                'history.status',
                'history.action',
                'history.effective_from',
                'history.effective_until',
                'history.created_at',
                'history.reviewer_user_id',
                'reviewer.name as reviewer_name',
                'reviewer.first_name as reviewer_first_name',
                'reviewer.last_name as reviewer_last_name', 'reviewer.profile_type as reviewer_profile_type', 'reviewer.organization_name as reviewer_organization_name',
                'reviewer.username as reviewer_username',
            ]);

        $grouped = [];
        foreach ($rows as $row) {
            $grouped[(int) $row->denial_id][] = [
                'decision_version' => (int) $row->decision_version,
                'decision' => (string) $row->decision,
                'reason_code' => (string) $row->reason_code,
                'status' => (string) $row->status,
                'action' => (string) $row->action,
                'effective_from' => self::date($row->effective_from),
                'effective_until' => self::date($row->effective_until),
                'reviewed_at' => self::date($row->created_at),
                'reviewer' => [
                    'id' => (int) $row->reviewer_user_id,
                    'display_name' => self::displayName(
                        $row->reviewer_name,
                        $row->reviewer_first_name,
                        $row->reviewer_last_name,
                        $row->reviewer_username,
                    ),
                ],
            ];
        }

        return $grouped;
    }

    private function assertSchema(): void
    {
        foreach ([
            'event_safety_requirements',
            'event_safety_requirement_versions',
            'event_safety_requirement_history',
            'event_safety_code_acknowledgements',
            'event_guardian_consents',
            'event_guardian_consent_history',
            'event_participation_denials',
            'event_participation_denial_history',
            'user_blocks',
        ] as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventSafetyException('event_safety_schema_unavailable');
            }
        }
        if (! Schema::hasColumn('user_blocks', 'tenant_id')
            || ! Schema::hasColumn('users', 'date_of_birth')) {
            throw new EventSafetyException('event_safety_schema_unavailable');
        }
    }

    private static function enum(mixed $value): string
    {
        return $value instanceof BackedEnum ? (string) $value->value : trim((string) $value);
    }

    private static function nullableString(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value !== '' ? $value : null;
    }

    private static function displayName(
        mixed $name,
        mixed $firstName,
        mixed $lastName,
        mixed $username,
    ): string {
        foreach ([$name, trim((string) $firstName . ' ' . (string) $lastName), $username] as $value) {
            $candidate = self::nullableString($value);
            if ($candidate !== null) {
                return $candidate;
            }
        }

        return '';
    }

    private static function date(mixed $value): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }
        try {
            $date = $value instanceof DateTimeInterface
                ? CarbonImmutable::instance($value)
                : CarbonImmutable::parse((string) $value);

            return $date->utc()->toIso8601String();
        } catch (Throwable) {
            return null;
        }
    }
}
