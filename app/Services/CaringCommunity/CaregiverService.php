<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\I18n\LocaleContext;
use App\Services\NotificationDispatcher;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;

/**
 * AG68 — Caregiver/Angehörigen Support Flow
 *
 * Handles caregiver links, schedule views, burnout risk detection, and
 * on-behalf help requests for the Caring Community module.
 */
class CaregiverService
{
    public const BURNOUT_THRESHOLD_HOURS_PER_WEEK = 20.0;

    // -------------------------------------------------------------------------
    // Availability guard
    // -------------------------------------------------------------------------

    public function isAvailable(): bool
    {
        return Schema::hasTable('caring_caregiver_links');
    }

    public function coverRequestsAvailable(): bool
    {
        return $this->isAvailable() && Schema::hasTable('caring_cover_requests');
    }

    // -------------------------------------------------------------------------
    // Caregiver links
    // -------------------------------------------------------------------------

    /**
     * Return caregiver links for a given caregiver, with cared-for user details.
     * Pass null to include every member-visible lifecycle state.
     *
     * @return array<int,array<string,mixed>>
     */
    public function getLinksForCaregiver(int $caregiverId, int $tenantId, ?string $status = 'active'): array
    {
        return DB::table('caring_caregiver_links as cl')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'cl.cared_for_id')
                    ->on('u.tenant_id', '=', 'cl.tenant_id');
            })
            ->where('cl.caregiver_id', $caregiverId)
            ->where('cl.tenant_id', $tenantId)
            ->when($status !== null, fn ($query) => $query->where('cl.status', $status))
            ->select([
                'cl.id',
                'cl.cared_for_id',
                'cl.relationship_type',
                'cl.is_primary',
                'cl.start_date',
                'cl.notes',
                'cl.status',
                'cl.recipient_confirmed_at',
                'cl.consent_verified_at',
                'cl.approved_at',
                'cl.rejected_at',
                'cl.rejection_reason',
                'cl.created_at',
                'u.name as cared_for_name',
                'u.avatar_url as cared_for_avatar_url',
            ])
            ->orderByDesc('cl.is_primary')
            ->orderBy('cl.start_date')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Return caregiver-link requests addressed to a care recipient.
     *
     * @return array<int,array<string,mixed>>
     */
    public function getIncomingLinks(int $caredForId, int $tenantId): array
    {
        return DB::table('caring_caregiver_links as cl')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'cl.caregiver_id')
                    ->on('u.tenant_id', '=', 'cl.tenant_id');
            })
            ->where('cl.cared_for_id', $caredForId)
            ->where('cl.tenant_id', $tenantId)
            ->whereIn('cl.status', ['pending', 'active', 'rejected'])
            ->select([
                'cl.id',
                'cl.caregiver_id',
                'cl.relationship_type',
                'cl.status',
                'cl.start_date',
                'cl.notes',
                'cl.recipient_confirmed_at',
                'cl.approved_at',
                'cl.rejected_at',
                'cl.rejection_reason',
                'cl.created_at',
                'u.name as caregiver_name',
                'u.avatar_url as caregiver_avatar_url',
            ])
            ->orderByRaw("CASE cl.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 ELSE 2 END")
            ->orderByDesc('cl.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Return the tenant-scoped staff review queue.
     *
     * @return array<int,array<string,mixed>>
     */
    public function getLinksForReview(int $tenantId, string $status = 'pending'): array
    {
        $allowed = ['pending', 'active', 'rejected', 'inactive', 'all'];
        if (! in_array($status, $allowed, true)) {
            throw new InvalidArgumentException(__('api.caring_caregiver_status_invalid'));
        }

        return DB::table('caring_caregiver_links as cl')
            ->join('users as caregiver', function ($join): void {
                $join->on('caregiver.id', '=', 'cl.caregiver_id')
                    ->on('caregiver.tenant_id', '=', 'cl.tenant_id');
            })
            ->join('users as cared_for', function ($join): void {
                $join->on('cared_for.id', '=', 'cl.cared_for_id')
                    ->on('cared_for.tenant_id', '=', 'cl.tenant_id');
            })
            ->where('cl.tenant_id', $tenantId)
            ->when($status !== 'all', fn ($query) => $query->where('cl.status', $status))
            ->select([
                'cl.*',
                'caregiver.name as caregiver_name',
                'caregiver.avatar_url as caregiver_avatar_url',
                'cared_for.name as cared_for_name',
                'cared_for.avatar_url as cared_for_avatar_url',
            ])
            ->orderByRaw("CASE cl.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END")
            ->orderBy('cl.created_at')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Record the care recipient's explicit confirmation without activating the link.
     * Staff still make the safeguarding/consent activation decision.
     *
     * @return array<string,mixed>
     */
    public function confirmLinkByRecipient(int $linkId, int $caredForId, int $tenantId): array
    {
        $link = DB::transaction(function () use ($linkId, $caredForId, $tenantId): array {
            $link = DB::table('caring_caregiver_links')
                ->where('id', $linkId)
                ->where('cared_for_id', $caredForId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->lockForUpdate()
                ->first();

            if ($link === null) {
                throw new \RuntimeException(__('api.caring_caregiver_link_not_found'));
            }

            DB::table('caring_caregiver_links')->where('id', $linkId)->update([
                'recipient_confirmed_at' => now(),
                'recipient_confirmed_by' => $caredForId,
                'updated_at' => now(),
            ]);

            return (array) DB::table('caring_caregiver_links')->where('id', $linkId)->first();
        });

        $this->notifyParticipant((int) $link['caregiver_id'], 'caring_caregiver_link_confirmed', 'notifications.caring_caregiver_link_confirmed', [], $caredForId);

        return $link;
    }

    /**
     * Activate a pending link after explicit consent verification and a fresh
     * bilateral safeguarding-policy check.
     *
     * @return array<string,mixed>
     */
    public function approveLink(int $linkId, int $tenantId, int $approverId, string $consentEvidence): array
    {
        $evidence = trim($consentEvidence);
        if ($evidence === '') {
            throw new InvalidArgumentException(__('api.caring_caregiver_consent_evidence_required'));
        }

        $link = DB::transaction(function () use ($linkId, $tenantId, $approverId, $evidence): array {
            $link = DB::table('caring_caregiver_links')
                ->where('id', $linkId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->lockForUpdate()
                ->first();

            if ($link === null) {
                throw new \RuntimeException(__('api.caring_caregiver_pending_link_not_found'));
            }
            if ($link->recipient_confirmed_at === null) {
                throw new \DomainException(__('api.caring_caregiver_consent_required'));
            }
            if (
                ! $this->userBelongsToTenant((int) $link->caregiver_id, $tenantId)
                || ! $this->userBelongsToTenant((int) $link->cared_for_id, $tenantId)
                || ! $this->userBelongsToTenant($approverId, $tenantId)
            ) {
                throw new \RuntimeException(__('api.user_not_found_in_tenant'));
            }

            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed((int) $link->caregiver_id, (int) $link->cared_for_id, $tenantId, 'caring_caregiver_link_approval');
            $policy->assertLocalContactAllowed((int) $link->cared_for_id, (int) $link->caregiver_id, $tenantId, 'caring_caregiver_link_approval');

            $now = now();
            DB::table('caring_caregiver_links')->where('id', $linkId)->update([
                'status' => 'active',
                'approved_by' => $approverId,
                'approved_at' => $now,
                'consent_verified_at' => $now,
                'consent_verified_by' => $approverId,
                'consent_evidence' => $evidence,
                'rejected_at' => null,
                'rejected_by' => null,
                'rejection_reason' => null,
                'updated_at' => $now,
            ]);

            return (array) DB::table('caring_caregiver_links')->where('id', $linkId)->first();
        });

        foreach ([(int) $link['caregiver_id'], (int) $link['cared_for_id']] as $participantId) {
            $this->notifyParticipant($participantId, 'caring_caregiver_link_approved', 'notifications.caring_caregiver_link_approved', [], $approverId);
        }

        return $link;
    }

    /** @return array<string,mixed> */
    public function rejectLink(int $linkId, int $tenantId, int $actorId, string $reason, bool $staffDecision): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new InvalidArgumentException(__('api.caring_caregiver_rejection_reason_required'));
        }

        $link = DB::transaction(function () use ($linkId, $tenantId, $actorId, $reason, $staffDecision): array {
            $query = DB::table('caring_caregiver_links')
                ->where('id', $linkId)
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending');
            if (! $staffDecision) {
                $query->where('cared_for_id', $actorId);
            }
            $link = $query->lockForUpdate()->first();
            if ($link === null) {
                throw new \RuntimeException(__('api.caring_caregiver_pending_link_not_found'));
            }

            DB::table('caring_caregiver_links')->where('id', $linkId)->update([
                'status' => 'rejected',
                'rejected_at' => now(),
                'rejected_by' => $actorId,
                'rejection_reason' => $reason,
                'updated_at' => now(),
            ]);

            return (array) DB::table('caring_caregiver_links')->where('id', $linkId)->first();
        });

        foreach (array_unique([(int) $link['caregiver_id'], (int) $link['cared_for_id']]) as $participantId) {
            if ($participantId !== $actorId) {
                $this->notifyParticipant($participantId, 'caring_caregiver_link_rejected', 'notifications.caring_caregiver_link_rejected', ['reason' => $reason], $actorId);
            }
        }

        return $link;
    }

    /**
     * Return all active links where this user is the cared-for person.
     *
     * @return array<int,array<string,mixed>>
     */
    public function getLinksForCaredFor(int $caredForId, int $tenantId): array
    {
        return DB::table('caring_caregiver_links as cl')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'cl.caregiver_id')
                    ->on('u.tenant_id', '=', 'cl.tenant_id');
            })
            ->where('cl.cared_for_id', $caredForId)
            ->where('cl.tenant_id', $tenantId)
            ->where('cl.status', 'active')
            ->select([
                'cl.id',
                'cl.caregiver_id',
                'cl.relationship_type',
                'cl.is_primary',
                'cl.start_date',
                'cl.notes',
                'cl.created_at',
                'u.name as caregiver_name',
                'u.avatar_url as caregiver_avatar_url',
            ])
            ->orderByDesc('cl.is_primary')
            ->orderBy('cl.start_date')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    /**
     * Request a new caregiver link. Member-created links remain pending until
     * staff verify consent and activate the relationship.
     *
     * @param  array<string,mixed>  $options  Optional: is_primary (bool), notes (string)
     * @return array<string,mixed>
     *
     * @throws \RuntimeException on guard failures
     */
    public function createLink(
        int $caregiverId,
        int $caredForId,
        string $relationshipType,
        int $tenantId,
        array $options = [],
    ): array {
        if ($caregiverId === $caredForId) {
            throw new \RuntimeException(__('api.caring_caregiver_self_link'));
        }

        if (
            !$this->userBelongsToTenant($caregiverId, $tenantId)
            || !$this->userBelongsToTenant($caredForId, $tenantId)
        ) {
            throw new \RuntimeException(__('api.user_not_found_in_tenant'));
        }

        $link = DB::transaction(function () use ($caregiverId, $caredForId, $relationshipType, $tenantId, $options): array {
            $existing = DB::table('caring_caregiver_links')
                ->where('caregiver_id', $caregiverId)
                ->where('cared_for_id', $caredForId)
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['pending', 'active'])
                ->lockForUpdate()
                ->first();

            if ($existing !== null) {
                throw new \RuntimeException(__('api.caring_caregiver_duplicate_link'));
            }

            $id = DB::table('caring_caregiver_links')->insertGetId([
                'tenant_id'         => $tenantId,
                'caregiver_id'      => $caregiverId,
                'cared_for_id'      => $caredForId,
                'relationship_type' => $relationshipType,
                'is_primary'        => (bool) ($options['is_primary'] ?? false),
                'start_date'        => $options['start_date'] ?? now()->toDateString(),
                'notes'             => $options['notes'] ?? null,
                'status'            => 'pending',
                'approved_by'       => null,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);

            /** @var array<string,mixed> $row */
            $row = (array) DB::table('caring_caregiver_links')->where('id', $id)->first();

            return $row;
        });

        $caregiverName = (string) DB::table('users')->where('id', $caregiverId)->where('tenant_id', $tenantId)->value('name');
        $this->notifyParticipant($caredForId, 'caring_caregiver_link_requested', 'notifications.caring_caregiver_link_requested', ['name' => $caregiverName], $caregiverId);

        return $link;
    }

    /**
     * Deactivate a caregiver link (soft-remove).
     *
     * @throws \RuntimeException if the link does not belong to this caregiver/tenant
     */
    public function removeLink(int $linkId, int $caregiverId, int $tenantId): void
    {
        $affected = DB::transaction(function () use ($linkId, $caregiverId, $tenantId): int {
            $link = DB::table('caring_caregiver_links')
                ->where('id', $linkId)
                ->where('caregiver_id', $caregiverId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if ($link === null) {
                return 0;
            }

            DB::table('caring_caregiver_links')
                ->where('tenant_id', $tenantId)
                ->where('caregiver_id', $caregiverId)
                ->where('cared_for_id', (int) $link->cared_for_id)
                ->where('status', 'inactive')
                ->where('id', '<>', $linkId)
                ->delete();

            return DB::table('caring_caregiver_links')
                ->where('id', $linkId)
                ->where('caregiver_id', $caregiverId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status'     => 'inactive',
                    'updated_at' => now(),
                ]);
        });

        if ($affected === 0) {
            throw new \RuntimeException(__('api.caring_caregiver_link_not_found'));
        }
    }

    // -------------------------------------------------------------------------
    // Care schedule
    // -------------------------------------------------------------------------

    /**
     * Return upcoming care activities for a given cared-for person.
     *
     * @return array{support_relationships: array<int,array<string,mixed>>, recent_logs: array<int,array<string,mixed>>}
     */
    public function getScheduleForCaredFor(int $caredForId, int $tenantId): array
    {
        // Upcoming active support relationships where this person is recipient
        $supportRelationships = [];
        if (Schema::hasTable('caring_support_relationships')) {
            $supportRelationships = DB::table('caring_support_relationships as sr')
                ->join('users as u', function ($join): void {
                    $join->on('u.id', '=', 'sr.supporter_id')
                        ->on('u.tenant_id', '=', 'sr.tenant_id');
                })
                ->where('sr.recipient_id', $caredForId)
                ->where('sr.tenant_id', $tenantId)
                ->where('sr.status', 'active')
                ->select([
                    'sr.id',
                    'sr.title',
                    'sr.frequency',
                    'sr.expected_hours',
                    'sr.next_check_in_at',
                    'sr.start_date',
                    'u.id as supporter_id',
                    'u.name as supporter_name',
                    'u.avatar_url as supporter_avatar_url',
                ])
                ->orderBy('sr.next_check_in_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        }

        // Recent vol_logs for this cared-for person as recipient (last 30 days)
        $recentLogs = [];
        if (Schema::hasTable('vol_logs')) {
            $recentLogs = DB::table('vol_logs as vl')
                ->join('users as u', function ($join): void {
                    $join->on('u.id', '=', 'vl.user_id')
                        ->on('u.tenant_id', '=', 'vl.tenant_id');
                })
                ->where('vl.support_recipient_id', $caredForId)
                ->where('vl.tenant_id', $tenantId)
                ->where('vl.date_logged', '>=', now()->subDays(30)->toDateString())
                ->select([
                    'vl.id',
                    'vl.date_logged as date',
                    'vl.hours',
                    'vl.status',
                    'u.id as supporter_id',
                    'u.name as supporter_name',
                    'u.avatar_url as supporter_avatar_url',
                ])
                ->orderByDesc('vl.date_logged')
                ->limit(20)
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        }

        return [
            'support_relationships' => $supportRelationships,
            'recent_logs'           => $recentLogs,
        ];
    }

    // -------------------------------------------------------------------------
    // Burnout risk
    // -------------------------------------------------------------------------

    /**
     * Compute burnout risk for a caregiver based on vol_logs in the past 7 days.
     *
     * @return array{weekly_hours: float, threshold: float, at_risk: bool, risk_level: 'none'|'moderate'|'high'}
     */
    public function checkBurnoutRisk(int $caregiverId, int $tenantId): array
    {
        $weeklyHours = 0.0;

        if (Schema::hasTable('vol_logs')) {
            $sum = DB::table('vol_logs')
                ->where('user_id', $caregiverId)
                ->where('tenant_id', $tenantId)
                ->where('date_logged', '>=', now()->subDays(7)->toDateString())
                ->whereIn('status', ['approved', 'pending'])
                ->sum('hours');

            $weeklyHours = (float) $sum;
        }

        $threshold = self::BURNOUT_THRESHOLD_HOURS_PER_WEEK;
        $atRisk     = $weeklyHours >= $threshold * 0.5;

        $riskLevel = 'none';
        if ($weeklyHours >= $threshold) {
            $riskLevel = 'high';
        } elseif ($weeklyHours >= $threshold * 0.5) {
            $riskLevel = 'moderate';
        }

        return [
            'weekly_hours' => $weeklyHours,
            'threshold'    => $threshold,
            'at_risk'      => $atRisk,
            'risk_level'   => $riskLevel,
        ];
    }

    // -------------------------------------------------------------------------
    // On-behalf requests
    // -------------------------------------------------------------------------

    /**
     * Create a help request on behalf of a cared-for person.
     *
     * @param  array<string,mixed>  $requestData  Must include: title, description. Optional: category_id.
     * @return array<string,mixed>
     *
     * @throws \RuntimeException if no active link exists
     */
    public function createRequestOnBehalf(
        int $caregiverId,
        int $caredForId,
        array $requestData,
        int $tenantId,
    ): array {
        // Guard: caregiver must have an active link to the cared-for person in this tenant
        $link = DB::table('caring_caregiver_links')
            ->where('caregiver_id', $caregiverId)
            ->where('cared_for_id', $caredForId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->first();

        if ($link === null) {
            throw new \RuntimeException(__('api.caring_caregiver_active_link_required'));
        }

        $id = DB::table('caring_help_requests')->insertGetId([
            'tenant_id'        => $tenantId,
            'user_id'          => $caredForId,
            'requested_by_id'  => $caregiverId,
            'is_on_behalf'     => true,
            'what'             => $this->buildOnBehalfRequestText($requestData),
            'when_needed'      => (string) ($requestData['when_needed'] ?? __('api.caring_caregiver_when_needed_default')),
            'contact_preference' => $this->normaliseContactPreference($requestData['contact_preference'] ?? null),
            'status'           => 'pending',
            'created_at'       => now(),
            'updated_at'       => now(),
        ]);

        /** @var array<string,mixed> $row */
        $row = (array) DB::table('caring_help_requests')->where('id', $id)->first();

        return $row;
    }

    /**
     * @param array<string,mixed> $requestData
     */
    private function buildOnBehalfRequestText(array $requestData): string
    {
        $title = trim((string) ($requestData['title'] ?? ''));
        $description = trim((string) ($requestData['description'] ?? ''));

        return trim($title . ($description !== '' ? "\n\n" . $description : ''));
    }

    private function normaliseContactPreference(mixed $contactPreference): string
    {
        $value = (string) ($contactPreference ?? 'either');

        return in_array($value, ['phone', 'message', 'either'], true) ? $value : 'either';
    }

    // -------------------------------------------------------------------------
    // AG73 — Substitute / cover-care services
    // -------------------------------------------------------------------------

    /**
     * @return array<int,array<string,mixed>>
     */
    public function getCoverRequestsForCaregiver(int $caregiverId, int $tenantId): array
    {
        $this->ensureCoverRequestsAvailable();

        return DB::table('caring_cover_requests as cr')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'cr.cared_for_id')
                    ->on('u.tenant_id', '=', 'cr.tenant_id');
            })
            ->leftJoin('users as s', function ($join): void {
                $join->on('s.id', '=', 'cr.matched_supporter_id')
                    ->on('s.tenant_id', '=', 'cr.tenant_id');
            })
            ->where('cr.tenant_id', $tenantId)
            ->where('cr.caregiver_id', $caregiverId)
            ->select([
                'cr.*',
                'u.name as cared_for_name',
                'u.avatar_url as cared_for_avatar_url',
                's.name as matched_supporter_name',
                's.avatar_url as matched_supporter_avatar_url',
            ])
            ->orderByRaw('CASE cr.status WHEN "open" THEN 0 WHEN "matched" THEN 1 WHEN "accepted" THEN 2 ELSE 3 END')
            ->orderBy('cr.starts_at')
            ->get()
            ->map(fn (object $row): array => $this->coverRequestRowToArray($row))
            ->all();
    }

    /**
     * @param array<string,mixed> $data
     * @return array<string,mixed>
     */
    public function createCoverRequest(int $caregiverId, int $tenantId, array $data): array
    {
        $this->ensureCoverRequestsAvailable();

        $caredForId = (int) ($data['cared_for_id'] ?? 0);
        if ($caredForId <= 0) {
            throw new InvalidArgumentException(__('api.missing_required_field', ['field' => 'cared_for_id']));
        }

        $link = DB::table('caring_caregiver_links')
            ->where('tenant_id', $tenantId)
            ->where('caregiver_id', $caregiverId)
            ->where('cared_for_id', $caredForId)
            ->where('status', 'active')
            ->first();

        if ($link === null) {
            throw new \RuntimeException(__('api.caring_cover_link_required'));
        }

        $title = trim((string) ($data['title'] ?? ''));
        if ($title === '') {
            throw new InvalidArgumentException(__('api.missing_required_field', ['field' => 'title']));
        }

        $startsAt = trim((string) ($data['starts_at'] ?? ''));
        $endsAt = trim((string) ($data['ends_at'] ?? ''));
        if ($startsAt === '' || $endsAt === '') {
            throw new InvalidArgumentException(__('api.caring_cover_dates_required'));
        }

        try {
            $starts = new \DateTimeImmutable($startsAt);
            $ends = new \DateTimeImmutable($endsAt);
        } catch (\Exception $e) {
            throw new InvalidArgumentException(__('api.caring_cover_dates_invalid'), 0, $e);
        }

        if ($ends <= $starts) {
            throw new InvalidArgumentException(__('api.caring_cover_dates_invalid'));
        }

        $urgency = (string) ($data['urgency'] ?? 'planned');
        if (! in_array($urgency, ['planned', 'soon', 'urgent'], true)) {
            $urgency = 'planned';
        }

        $skills = $data['required_skills'] ?? [];
        if (is_string($skills)) {
            $skills = array_values(array_filter(array_map('trim', explode(',', $skills))));
        }
        if (! is_array($skills)) {
            $skills = [];
        }

        $supportRelationshipId = $this->normaliseSupportRelationshipId(
            $data['support_relationship_id'] ?? null,
            $tenantId,
            $caredForId,
        );

        $id = DB::table('caring_cover_requests')->insertGetId([
            'tenant_id' => $tenantId,
            'caregiver_link_id' => (int) $link->id,
            'caregiver_id' => $caregiverId,
            'cared_for_id' => $caredForId,
            'support_relationship_id' => $supportRelationshipId,
            'title' => mb_substr($title, 0, 255),
            'briefing' => $this->nullableString($data['briefing'] ?? null),
            'required_skills' => json_encode(array_values($skills)),
            'starts_at' => $starts->format('Y-m-d H:i:s'),
            'ends_at' => $ends->format('Y-m-d H:i:s'),
            'expected_hours' => isset($data['expected_hours']) ? max(0.25, min(999.99, (float) $data['expected_hours'])) : null,
            'minimum_trust_tier' => max(0, min(5, (int) ($data['minimum_trust_tier'] ?? 1))),
            'urgency' => $urgency,
            'status' => 'open',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->getCoverRequest((int) $id, $caregiverId, $tenantId) ?? [];
    }

    private function normaliseSupportRelationshipId(mixed $value, int $tenantId, int $caredForId): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $relationshipId = (int) $value;
        if ($relationshipId <= 0 || ! Schema::hasTable('caring_support_relationships')) {
            throw new InvalidArgumentException(__('api.caring_cover_not_found'));
        }

        $exists = DB::table('caring_support_relationships')
            ->where('tenant_id', $tenantId)
            ->where('id', $relationshipId)
            ->where('recipient_id', $caredForId)
            ->exists();

        if (! $exists) {
            throw new InvalidArgumentException(__('api.caring_cover_not_found'));
        }

        return $relationshipId;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function suggestCoverCandidates(int $coverRequestId, int $caregiverId, int $tenantId): array
    {
        $this->ensureCoverRequestsAvailable();

        $request = DB::table('caring_cover_requests')
            ->where('id', $coverRequestId)
            ->where('tenant_id', $tenantId)
            ->where('caregiver_id', $caregiverId)
            ->first();

        if ($request === null) {
            throw new \RuntimeException(__('api.caring_cover_not_found'));
        }

        $requiredSkills = json_decode((string) ($request->required_skills ?? '[]'), true);
        $requiredSkills = is_array($requiredSkills) ? array_map('mb_strtolower', $requiredSkills) : [];

        $busySupporters = DB::table('caring_cover_requests')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', ['matched', 'accepted'])
            ->whereNotNull('matched_supporter_id')
            ->where('starts_at', '<', $request->ends_at)
            ->where('ends_at', '>', $request->starts_at)
            ->pluck('matched_supporter_id')
            ->map(fn (mixed $id): int => (int) $id)
            ->all();

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where('is_approved', 1)
            ->where('id', '!=', (int) $request->caregiver_id)
            ->where('id', '!=', (int) $request->cared_for_id)
            ->where('trust_tier', '>=', (int) $request->minimum_trust_tier)
            ->when($busySupporters !== [], fn ($query) => $query->whereNotIn('id', $busySupporters))
            ->select(['id', 'name', 'avatar_url', 'location', 'trust_tier', 'verification_status', 'skills'])
            ->orderByDesc('trust_tier')
            ->orderByDesc('is_verified')
            ->orderBy('name')
            ->limit(12)
            ->get()
            ->map(function (object $row) use ($requiredSkills): array {
                $skills = array_values(array_filter(array_map('trim', explode(',', (string) ($row->skills ?? '')))));
                $lowerSkills = array_map('mb_strtolower', $skills);
                $skillMatches = count(array_intersect($requiredSkills, $lowerSkills));

                return [
                    'id' => (int) $row->id,
                    'name' => (string) $row->name,
                    'avatar_url' => $row->avatar_url !== null ? (string) $row->avatar_url : null,
                    'location' => $row->location !== null ? (string) $row->location : null,
                    'trust_tier' => (int) $row->trust_tier,
                    'verification_status' => (string) $row->verification_status,
                    'skills' => $skills,
                    'skill_matches' => $skillMatches,
                    'match_score' => ((int) $row->trust_tier * 10) + ($skillMatches * 5) + ($row->verification_status === 'passed' ? 5 : 0),
                ];
            })
            ->sortByDesc('match_score')
            ->values()
            ->all();
    }

    public function assignCoverCandidate(int $coverRequestId, int $caregiverId, int $tenantId, int $supporterId): array
    {
        $this->ensureCoverRequestsAvailable();

        $request = DB::table('caring_cover_requests')
            ->where('id', $coverRequestId)
            ->where('tenant_id', $tenantId)
            ->where('caregiver_id', $caregiverId)
            ->first(['cared_for_id']);
        if ($request === null) {
            throw new \RuntimeException(__('api.caring_cover_not_found'));
        }

        $candidateIds = array_column($this->suggestCoverCandidates($coverRequestId, $caregiverId, $tenantId), 'id');
        if (! in_array($supporterId, $candidateIds, true)) {
            throw new InvalidArgumentException(__('api.caring_cover_candidate_invalid'));
        }

        $caredForId = (int) $request->cared_for_id;
        $interactionPolicy = app(SafeguardingInteractionPolicy::class);
        $interactionPolicy->assertLocalContactAllowed(
            $supporterId,
            $caredForId,
            $tenantId,
            'caring_cover_assignment',
        );
        $interactionPolicy->assertLocalContactAllowed(
            $caredForId,
            $supporterId,
            $tenantId,
            'caring_cover_assignment',
        );

        DB::table('caring_cover_requests')
            ->where('id', $coverRequestId)
            ->where('tenant_id', $tenantId)
            ->where('caregiver_id', $caregiverId)
            ->update([
                'matched_supporter_id' => $supporterId,
                'status' => 'matched',
                'matched_at' => now(),
                'updated_at' => now(),
            ]);

        return $this->getCoverRequest($coverRequestId, $caregiverId, $tenantId) ?? [];
    }

    private function ensureCoverRequestsAvailable(): void
    {
        if (! $this->coverRequestsAvailable()) {
            throw new \RuntimeException(__('api.caring_cover_unavailable'));
        }
    }

    private function getCoverRequest(int $id, int $caregiverId, int $tenantId): ?array
    {
        $row = DB::table('caring_cover_requests as cr')
            ->join('users as u', function ($join): void {
                $join->on('u.id', '=', 'cr.cared_for_id')
                    ->on('u.tenant_id', '=', 'cr.tenant_id');
            })
            ->leftJoin('users as s', function ($join): void {
                $join->on('s.id', '=', 'cr.matched_supporter_id')
                    ->on('s.tenant_id', '=', 'cr.tenant_id');
            })
            ->where('cr.id', $id)
            ->where('cr.tenant_id', $tenantId)
            ->where('cr.caregiver_id', $caregiverId)
            ->select([
                'cr.*',
                'u.name as cared_for_name',
                'u.avatar_url as cared_for_avatar_url',
                's.name as matched_supporter_name',
                's.avatar_url as matched_supporter_avatar_url',
            ])
            ->first();

        return $row ? $this->coverRequestRowToArray($row) : null;
    }

    /**
     * @return array<string,mixed>
     */
    private function coverRequestRowToArray(object $row): array
    {
        $skills = json_decode((string) ($row->required_skills ?? '[]'), true);

        return [
            'id' => (int) $row->id,
            'tenant_id' => (int) $row->tenant_id,
            'caregiver_link_id' => (int) $row->caregiver_link_id,
            'caregiver_id' => (int) $row->caregiver_id,
            'cared_for_id' => (int) $row->cared_for_id,
            'cared_for_name' => (string) $row->cared_for_name,
            'cared_for_avatar_url' => $row->cared_for_avatar_url !== null ? (string) $row->cared_for_avatar_url : null,
            'support_relationship_id' => $row->support_relationship_id !== null ? (int) $row->support_relationship_id : null,
            'matched_supporter_id' => $row->matched_supporter_id !== null ? (int) $row->matched_supporter_id : null,
            'matched_supporter_name' => $row->matched_supporter_name !== null ? (string) $row->matched_supporter_name : null,
            'matched_supporter_avatar_url' => $row->matched_supporter_avatar_url !== null ? (string) $row->matched_supporter_avatar_url : null,
            'title' => (string) $row->title,
            'briefing' => $row->briefing !== null ? (string) $row->briefing : null,
            'required_skills' => is_array($skills) ? $skills : [],
            'starts_at' => (string) $row->starts_at,
            'ends_at' => (string) $row->ends_at,
            'expected_hours' => $row->expected_hours !== null ? (float) $row->expected_hours : null,
            'minimum_trust_tier' => (int) $row->minimum_trust_tier,
            'urgency' => (string) $row->urgency,
            'status' => (string) $row->status,
            'matched_at' => $row->matched_at !== null ? (string) $row->matched_at : null,
            'created_at' => $row->created_at !== null ? (string) $row->created_at : null,
            'updated_at' => $row->updated_at !== null ? (string) $row->updated_at : null,
        ];
    }

    private function nullableString(mixed $value): ?string
    {
        if ($value === null) {
            return null;
        }

        $value = trim((string) $value);
        return $value === '' ? null : $value;
    }

    /** @param array<string,string> $params */
    private function notifyParticipant(int $userId, string $type, string $translationKey, array $params, int $actorId): void
    {
        $locale = DB::table('users')->where('id', $userId)->value('preferred_language');
        LocaleContext::withLocale($locale, function () use ($userId, $type, $translationKey, $params, $actorId): void {
            NotificationDispatcher::dispatch(
                $userId,
                'global',
                null,
                $type,
                __($translationKey, $params),
                '/caring-community/caregiver',
                null,
                false,
                $actorId,
                [
                    'frequency' => 'instant',
                    'in_app_enabled' => true,
                    'email_enabled' => true,
                    'push_enabled' => true,
                ],
            );
        });
    }

    private function userBelongsToTenant(int $userId, int $tenantId): bool
    {
        return DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->exists();
    }
}
