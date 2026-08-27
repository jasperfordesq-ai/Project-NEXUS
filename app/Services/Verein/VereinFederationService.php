<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Verein;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Mail\VereinCrossInvitationAccepted;
use App\Mail\VereinCrossInvitationReceived;
use App\Services\SafeguardingInteractionPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;
use RuntimeException;
use App\Support\UserDisplayName;

/**
 * AG55 — Verein-to-Verein federation service.
 *
 * Lets Vereine (org_subtype='club') in the same municipality opt-in to
 * share event listings, cross-invite members, and appear in a joint
 * municipality calendar.
 *
 * All queries scoped via TenantContext::getId().
 */
class VereinFederationService
{
    private const VALID_SCOPES = ['events', 'members', 'both', 'none'];

    /**
     * Verein admin opts in / updates their consent record.
     */
    public function setConsent(int $organizationId, string $scope, ?string $municipalityCode, ?int $adminId = null): array
    {
        if (!in_array($scope, self::VALID_SCOPES, true)) {
            throw new InvalidArgumentException(__('verein_federation.invalid_scope'));
        }

        $tenantId = TenantContext::getId();
        $verein = $this->assertVerein($tenantId, $organizationId);

        $isActive = $scope !== 'none';
        $now = now();

        DB::table('verein_federation_consents')->updateOrInsert(
            ['organization_id' => $organizationId],
            [
                'tenant_id' => $tenantId,
                'sharing_scope' => $scope,
                'municipality_code' => $municipalityCode,
                'is_active' => $isActive ? 1 : 0,
                'opted_in_by_admin_id' => $adminId,
                'opted_in_at' => $isActive ? $now : null,
                'updated_at' => $now,
                'created_at' => $now,
            ]
        );

        return $this->getConsent($organizationId);
    }

    public function getConsent(int $organizationId): array
    {
        $tenantId = TenantContext::getId();
        $row = DB::table('verein_federation_consents')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $organizationId)
            ->first();

        if (!$row) {
            return [
                'organization_id' => $organizationId,
                'sharing_scope' => 'none',
                'municipality_code' => null,
                'is_active' => false,
            ];
        }

        return [
            'organization_id' => (int) $row->organization_id,
            'sharing_scope' => (string) $row->sharing_scope,
            'municipality_code' => $row->municipality_code,
            'is_active' => (bool) $row->is_active,
            'opted_in_by_admin_id' => $row->opted_in_by_admin_id ? (int) $row->opted_in_by_admin_id : null,
            'opted_in_at' => $row->opted_in_at,
        ];
    }

    /**
     * Returns other Vereine in the same municipality with active consent.
     */
    public function getNetworkVereine(int $organizationId): array
    {
        $tenantId = TenantContext::getId();
        $self = $this->getConsent($organizationId);

        if (!$self['is_active'] || $self['municipality_code'] === null) {
            return [];
        }

        return DB::table('verein_federation_consents as c')
            ->join('vol_organizations as o', 'o.id', '=', 'c.organization_id')
            ->where('c.tenant_id', $tenantId)
            ->where('c.is_active', 1)
            ->where('c.municipality_code', $self['municipality_code'])
            ->where('c.organization_id', '<>', $organizationId)
            ->where('o.org_type', 'club')
            ->select([
                'c.organization_id',
                'c.sharing_scope',
                'c.municipality_code',
                'o.name',
                'o.slug',
                'o.logo_url',
            ])
            ->get()
            ->map(fn ($row) => [
                'organization_id' => (int) $row->organization_id,
                'sharing_scope' => (string) $row->sharing_scope,
                'municipality_code' => $row->municipality_code,
                'name' => (string) $row->name,
                'slug' => $row->slug,
                'logo_url' => $row->logo_url,
            ])
            ->values()
            ->all();
    }

    /**
     * Return the source Vereine the viewer shares with the target user, plus
     * eligible federated target Vereine that accept member sharing.
     *
     * @return array<int,array{source_organization_id:int,source_name:string,network:array<int,array{organization_id:int,name:string}>}>
     */
    public function getCrossInviteTargets(int $viewerUserId, int $targetUserId): array
    {
        if ($viewerUserId === $targetUserId) {
            return [];
        }

        $tenantId = TenantContext::getId();

        $targetExists = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('id', $targetUserId)
            ->where('status', 'active')
            ->exists();

        if (!$targetExists) {
            return [];
        }

        $sharedSources = DB::table('org_members as viewer_member')
            ->join('org_members as target_member', function ($join) use ($targetUserId) {
                $join->on('target_member.organization_id', '=', 'viewer_member.organization_id')
                    ->where('target_member.org_type', '=', 'volunteer')
                    ->where('target_member.user_id', '=', $targetUserId)
                    ->where('target_member.status', '=', 'active');
            })
            ->join('vol_organizations as source_org', 'source_org.id', '=', 'viewer_member.organization_id')
            ->join('verein_federation_consents as source_consent', 'source_consent.organization_id', '=', 'source_org.id')
            ->where('viewer_member.tenant_id', $tenantId)
            ->where('target_member.tenant_id', $tenantId)
            ->where('source_org.tenant_id', $tenantId)
            ->where('source_consent.tenant_id', $tenantId)
            ->where('viewer_member.org_type', 'volunteer')
            ->where('viewer_member.user_id', $viewerUserId)
            ->where('viewer_member.status', 'active')
            ->where('source_org.org_type', 'club')
            ->where('source_consent.is_active', 1)
            ->whereIn('source_consent.sharing_scope', ['members', 'both'])
            ->whereNotNull('source_consent.municipality_code')
            ->select([
                'source_org.id as source_organization_id',
                'source_org.name as source_name',
                'source_consent.municipality_code',
            ])
            ->distinct()
            ->orderBy('source_org.name')
            ->get();

        $results = [];

        foreach ($sharedSources as $source) {
            $network = DB::table('verein_federation_consents as target_consent')
                ->join('vol_organizations as target_org', 'target_org.id', '=', 'target_consent.organization_id')
                ->leftJoin('org_members as target_existing_member', function ($join) use ($targetUserId, $tenantId) {
                    $join->on('target_existing_member.organization_id', '=', 'target_org.id')
                        ->where('target_existing_member.org_type', '=', 'volunteer')
                        ->where('target_existing_member.user_id', '=', $targetUserId)
                        ->where('target_existing_member.tenant_id', '=', $tenantId)
                        ->where('target_existing_member.status', '=', 'active');
                })
                ->where('target_consent.tenant_id', $tenantId)
                ->where('target_org.tenant_id', $tenantId)
                ->where('target_consent.is_active', 1)
                ->whereIn('target_consent.sharing_scope', ['members', 'both'])
                ->where('target_consent.municipality_code', $source->municipality_code)
                ->where('target_org.org_type', 'club')
                ->where('target_org.id', '<>', (int) $source->source_organization_id)
                ->whereNull('target_existing_member.id')
                ->select([
                    'target_org.id as organization_id',
                    'target_org.name',
                ])
                ->distinct()
                ->orderBy('target_org.name')
                ->get()
                ->map(fn ($target) => [
                    'organization_id' => (int) $target->organization_id,
                    'name' => (string) $target->name,
                ])
                ->values()
                ->all();

            if ($network === []) {
                continue;
            }

            $results[] = [
                'source_organization_id' => (int) $source->source_organization_id,
                'source_name' => (string) $source->source_name,
                'network' => $network,
            ];
        }

        return $results;
    }

    /**
     * Share an event with the listed target Vereine. Respects target consent.
     *
     * @return array{shared:int,skipped:int}
     */
    public function shareEvent(int $eventId, array $targetOrganizationIds, int $sourceOrganizationId): array
    {
        $tenantId = TenantContext::getId();

        $event = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('id', $eventId)
            ->first();

        if (!$event) {
            throw new InvalidArgumentException(__('verein_federation.event_not_found'));
        }

        $source = $this->getConsent($sourceOrganizationId);
        if (!$source['is_active'] || !in_array($source['sharing_scope'], ['events', 'both'], true)) {
            throw new RuntimeException(__('verein_federation.source_not_consenting'));
        }

        $shared = 0;
        $skipped = 0;
        $now = now();

        foreach ($targetOrganizationIds as $targetId) {
            $targetId = (int) $targetId;
            if ($targetId === $sourceOrganizationId) {
                $skipped++;
                continue;
            }
            $target = $this->getConsent($targetId);
            if (
                !$target['is_active']
                || !in_array($target['sharing_scope'], ['events', 'both'], true)
                || $target['municipality_code'] !== $source['municipality_code']
            ) {
                $skipped++;
                continue;
            }

            $exists = DB::table('verein_event_shares')
                ->where('tenant_id', $tenantId)
                ->where('event_id', $eventId)
                ->where('target_organization_id', $targetId)
                ->where('status', 'active')
                ->exists();
            if ($exists) {
                $skipped++;
                continue;
            }

            $inserted = DB::table('verein_event_shares')->insertOrIgnore([
                'source_organization_id' => $sourceOrganizationId,
                'target_organization_id' => $targetId,
                'event_id' => $eventId,
                'tenant_id' => $tenantId,
                'shared_at' => $now,
                'status' => 'active',
                'created_at' => $now,
                'updated_at' => $now,
            ]);
            if ($inserted === 0) {
                $skipped++;
                continue;
            }

            $shared++;
        }

        return ['shared' => $shared, 'skipped' => $skipped];
    }

    /**
     * Events shared TO this Verein (incoming) or FROM (outgoing).
     */
    public function getSharedEvents(int $organizationId, string $direction = 'incoming'): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('verein_event_shares as s')
            ->join('events as e', function ($join): void {
                $join->on('e.id', '=', 's.event_id')
                    ->on('e.tenant_id', '=', 's.tenant_id');
            })
            ->leftJoin('vol_organizations as so', function ($join): void {
                $join->on('so.id', '=', 's.source_organization_id')
                    ->on('so.tenant_id', '=', 's.tenant_id');
            })
            ->leftJoin('vol_organizations as to_org', function ($join): void {
                $join->on('to_org.id', '=', 's.target_organization_id')
                    ->on('to_org.tenant_id', '=', 's.tenant_id');
            })
            ->where('s.tenant_id', $tenantId)
            ->where('s.status', 'active');

        if ($direction === 'outgoing') {
            $query->where('s.source_organization_id', $organizationId);
        } else {
            $query->where('s.target_organization_id', $organizationId);
        }

        return $query->select([
            's.id', 's.event_id', 's.source_organization_id', 's.target_organization_id',
            's.shared_at',
            'e.title', 'e.start_time', 'e.location', 'e.image_url',
            'so.name as source_name',
            'to_org.name as target_name',
        ])
            ->orderByDesc('e.start_time')
            ->get()
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'event_id' => (int) $r->event_id,
                'source_organization_id' => (int) $r->source_organization_id,
                'target_organization_id' => (int) $r->target_organization_id,
                'source_name' => $r->source_name,
                'target_name' => $r->target_name,
                'shared_at' => $r->shared_at,
                'title' => (string) $r->title,
                'start_time' => $r->start_time,
                'location' => $r->location,
                'image_url' => $r->image_url,
            ])
            ->values()
            ->all();
    }

    public function withdrawEventShare(int $shareId, int $sourceOrganizationId): bool
    {
        $tenantId = TenantContext::getId();

        $affected = DB::table('verein_event_shares')
            ->where('tenant_id', $tenantId)
            ->where('id', $shareId)
            ->where('source_organization_id', $sourceOrganizationId)
            ->update(['status' => 'withdrawn', 'updated_at' => now()]);

        return $affected > 0;
    }

    /**
     * Send a cross-Verein invitation to a member of the source Verein.
     */
    public function sendCrossInvitation(
        int $sourceOrgId,
        int $targetOrgId,
        int $inviterUserId,
        int $inviteeUserId,
        ?string $message = null
    ): array {
        $tenantId = TenantContext::getId();

        $source = $this->getConsent($sourceOrgId);
        $target = $this->getConsent($targetOrgId);

        foreach ([$source, $target] as $consent) {
            if (
                !$consent['is_active']
                || !in_array($consent['sharing_scope'], ['members', 'both'], true)
            ) {
                throw new RuntimeException(__('verein_federation.member_sharing_disabled'));
            }
        }
        if ($source['municipality_code'] !== $target['municipality_code']) {
            throw new RuntimeException(__('verein_federation.different_municipality'));
        }

        // The INVITER must belong to the source Verein. Without this check any
        // authenticated user could send invitations "from" a Verein they have
        // no relationship with — fanning out notifications/emails to its members
        // and using the invitee-membership check below as a disclosure oracle.
        // Checked BEFORE the invitee lookup so a non-member cannot probe it.
        $inviterIsMember = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $sourceOrgId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $inviterUserId)
            ->where('status', 'active')
            ->exists();
        if (!$inviterIsMember) {
            throw new InvalidArgumentException(__('verein_federation.inviter_not_member'));
        }

        // Invitee must be a member of the source Verein
        $isMember = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $sourceOrgId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $inviteeUserId)
            ->where('status', 'active')
            ->exists();
        if (!$isMember) {
            throw new InvalidArgumentException(__('verein_federation.invitee_not_member'));
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $inviterUserId,
            $inviteeUserId,
            $tenantId,
            'verein_cross_invitation',
        );

        $message = $message !== null ? mb_substr(trim($message), 0, 500) : null;
        $now = now();
        $expiresAt = (clone $now)->addDays(30);

        $id = (int) DB::table('verein_cross_invitations')->insertGetId([
            'source_organization_id' => $sourceOrgId,
            'target_organization_id' => $targetOrgId,
            'tenant_id' => $tenantId,
            'inviter_user_id' => $inviterUserId,
            'invitee_user_id' => $inviteeUserId,
            'message' => $message,
            'status' => 'sent',
            'sent_at' => $now,
            'expires_at' => $expiresAt,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $this->notifyInvitee($id, $inviteeUserId, $sourceOrgId, $targetOrgId, $message);

        return $this->findInvitation($id);
    }

    public function respondToInvitation(int $invitationId, int $userId, string $action): array
    {
        if (!in_array($action, ['accept', 'decline'], true)) {
            throw new InvalidArgumentException(__('verein_federation.invalid_action'));
        }

        $tenantId = TenantContext::getId();
        $invite = DB::table('verein_cross_invitations')
            ->where('tenant_id', $tenantId)
            ->where('id', $invitationId)
            ->where('invitee_user_id', $userId)
            ->first();

        if (!$invite) {
            throw new InvalidArgumentException(__('verein_federation.invitation_not_found'));
        }
        if ($invite->status !== 'sent') {
            throw new RuntimeException(__('verein_federation.invitation_not_pending'));
        }

        if ($action === 'accept') {
            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                (int) $invite->inviter_user_id,
                $userId,
                $tenantId,
                'verein_cross_invitation_accept',
            );
            $policy->assertLocalContactAllowed(
                $userId,
                (int) $invite->inviter_user_id,
                $tenantId,
                'verein_cross_invitation_accept',
            );
        }

        $newStatus = $action === 'accept' ? 'accepted' : 'declined';

        DB::table('verein_cross_invitations')
            ->where('id', $invitationId)
            ->update([
                'status' => $newStatus,
                'responded_at' => now(),
                'updated_at' => now(),
            ]);

        if ($action === 'accept') {
            $this->notifyInviterAccepted((int) $invite->inviter_user_id, (int) $invite->target_organization_id, $userId);
        }

        return $this->findInvitation($invitationId);
    }

    public function listInvitationsForUser(int $userId): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('verein_cross_invitations as i')
            ->leftJoin('vol_organizations as src', 'src.id', '=', 'i.source_organization_id')
            ->leftJoin('vol_organizations as tgt', 'tgt.id', '=', 'i.target_organization_id')
            ->leftJoin('users as u', 'u.id', '=', 'i.inviter_user_id')
            ->where('i.tenant_id', $tenantId)
            ->where('i.invitee_user_id', $userId)
            ->orderByDesc('i.sent_at')
            ->select([
                'i.id', 'i.status', 'i.message', 'i.sent_at', 'i.responded_at', 'i.expires_at',
                'i.source_organization_id', 'i.target_organization_id',
                'src.name as source_name', 'tgt.name as target_name',
                'u.first_name as inviter_first_name', 'u.last_name as inviter_last_name', 'u.profile_type as inviter_profile_type', 'u.organization_name as inviter_organization_name',
            ])
            ->get()
            ->map(fn ($r) => [
                'id' => (int) $r->id,
                'status' => (string) $r->status,
                'message' => $r->message,
                'sent_at' => $r->sent_at,
                'responded_at' => $r->responded_at,
                'expires_at' => $r->expires_at,
                'source_organization_id' => (int) $r->source_organization_id,
                'target_organization_id' => (int) $r->target_organization_id,
                'source_name' => $r->source_name,
                'target_name' => $r->target_name,
                'inviter_name' => UserDisplayName::resolvePrefixed($r, 'inviter_') ?: null,
            ])
            ->values()
            ->all();
    }

    public function expireOldInvitations(): int
    {
        return DB::table('verein_cross_invitations')
            ->where('status', 'sent')
            ->whereNotNull('expires_at')
            ->where('expires_at', '<', now())
            ->update(['status' => 'expired', 'updated_at' => now()]);
    }

    /**
     * Joint municipality calendar — events from all consenting Vereine in the
     * same municipality_code, bucketed by date.
     */
    public function getMunicipalityCalendar(
        int $tenantId,
        string $municipalityCode,
        ?string $period = 'month',
        ?string $from = null,
        ?string $until = null,
    ): array
    {
        $start = $from !== null
            ? CarbonImmutable::createFromFormat('!Y-m-d', $from, 'UTC')
            : now()->startOfDay();
        $end = $until !== null
            ? CarbonImmutable::createFromFormat('!Y-m-d', $until, 'UTC')
            : match ($period) {
                'week' => $start->copy()->addDays(7),
                'year' => $start->copy()->addYear(),
                default => $start->copy()->addMonth(),
            };
        if (!$start || !$end || $end <= $start || $start->diffInDays($end) > 366) {
            throw new InvalidArgumentException(__('api.invalid_date'));
        }

        $rows = DB::table('verein_federation_consents as c')
            ->join('vol_organizations as o', 'o.id', '=', 'c.organization_id')
            ->join('events as e', function ($join) {
                $join->on('e.user_id', '=', 'o.user_id');
            })
            ->where('c.tenant_id', $tenantId)
            ->where('c.is_active', 1)
            ->whereIn('c.sharing_scope', ['events', 'both'])
            ->where('c.municipality_code', $municipalityCode)
            ->where('o.org_type', 'club')
            ->where('e.tenant_id', $tenantId)
            ->where('e.status', 'active')
            ->where('e.start_time', '>=', $start)
            ->where('e.start_time', '<', $end)
            ->select([
                'e.id', 'e.title', 'e.start_time', 'e.image_url',
                'o.id as organization_id', 'o.name as organization_name',
            ])
            ->orderBy('e.start_time')
            ->get();

        $buckets = [];
        foreach ($rows as $r) {
            $date = substr((string) $r->start_time, 0, 10);
            $buckets[$date] ??= [];
            $buckets[$date][] = [
                'id' => (int) $r->id,
                'title' => (string) $r->title,
                'start_time' => $r->start_time,
                'image_url' => $r->image_url,
                'organization_id' => (int) $r->organization_id,
                'organization_name' => (string) $r->organization_name,
            ];
        }

        return [
            'municipality_code' => $municipalityCode,
            'period' => $from !== null ? 'custom' : $period,
            'start' => $start->toDateString(),
            'end' => $end->toDateString(),
            'buckets' => $buckets,
        ];
    }

    private function findInvitation(int $id): array
    {
        $tenantId = TenantContext::getId();
        $row = DB::table('verein_cross_invitations')
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$row) {
            throw new InvalidArgumentException(__('verein_federation.invitation_not_found'));
        }
        return [
            'id' => (int) $row->id,
            'source_organization_id' => (int) $row->source_organization_id,
            'target_organization_id' => (int) $row->target_organization_id,
            'inviter_user_id' => (int) $row->inviter_user_id,
            'invitee_user_id' => (int) $row->invitee_user_id,
            'message' => $row->message,
            'status' => (string) $row->status,
            'sent_at' => $row->sent_at,
            'responded_at' => $row->responded_at,
            'expires_at' => $row->expires_at,
        ];
    }

    private function assertVerein(int $tenantId, int $organizationId): object
    {
        $row = DB::table('vol_organizations')
            ->where('tenant_id', $tenantId)
            ->where('id', $organizationId)
            ->where('org_type', 'club')
            ->first();
        if (!$row) {
            throw new InvalidArgumentException(__('verein_federation.verein_not_found'));
        }
        return $row;
    }

    private function notifyInvitee(int $invitationId, int $inviteeUserId, int $sourceOrgId, int $targetOrgId, ?string $message): void
    {
        $tenantId = TenantContext::getId();
        $user = DB::table('users')->where('id', $inviteeUserId)->where('tenant_id', $tenantId)->first();
        if (!$user) {
            return;
        }
        $sourceName = (string) (DB::table('vol_organizations')
            ->where('id', $sourceOrgId)
            ->where('tenant_id', $tenantId)
            ->value('name') ?? '');
        $targetName = (string) (DB::table('vol_organizations')
            ->where('id', $targetOrgId)
            ->where('tenant_id', $tenantId)
            ->value('name') ?? '');

        LocaleContext::withLocale($user->preferred_language ?? null, function () use ($invitationId, $user, $sourceName, $targetName, $message, $tenantId, $inviteeUserId): void {
            // In-app notification
            DB::table('notifications')->insert([
                'user_id' => $inviteeUserId,
                'tenant_id' => $tenantId,
                'message' => __('verein_federation.notification_invitation_received', ['source' => $sourceName, 'target' => $targetName]),
                'title' => __('verein_federation.notification_invitation_title'),
                'type' => 'verein_cross_invitation',
                'link' => '/me/verein-invitations',
                'is_read' => 0,
                'created_at' => now(),
            ]);

            // Email
            try {
                VereinCrossInvitationReceived::send($user, $invitationId, $sourceName, $targetName, $message);
            } catch (\Throwable $e) {
                // Email is best-effort; in-app notification is the primary channel.
            }
        });
    }

    private function notifyInviterAccepted(int $inviterUserId, int $targetOrgId, int $accepterUserId): void
    {
        $tenantId = TenantContext::getId();
        $inviter = DB::table('users')->where('id', $inviterUserId)->where('tenant_id', $tenantId)->first();
        if (!$inviter) {
            return;
        }
        $accepter = DB::table('users')
            ->where('id', $accepterUserId)
            ->where('tenant_id', $tenantId)
            ->first();
        $accepterName = $accepter ? UserDisplayName::resolve($accepter) : '';
        $targetName = (string) (DB::table('vol_organizations')
            ->where('id', $targetOrgId)
            ->where('tenant_id', $tenantId)
            ->value('name') ?? '');

        LocaleContext::withLocale($inviter->preferred_language ?? null, function () use ($inviter, $tenantId, $inviterUserId, $accepterName, $targetName): void {
            DB::table('notifications')->insert([
                'user_id' => $inviterUserId,
                'tenant_id' => $tenantId,
                'message' => __('verein_federation.notification_invitation_accepted', ['name' => $accepterName, 'target' => $targetName]),
                'title' => __('verein_federation.notification_accepted_title'),
                'type' => 'verein_cross_invitation_accepted',
                'link' => '/vereine/' . $targetName,
                'is_read' => 0,
                'created_at' => now(),
            ]);

            try {
                VereinCrossInvitationAccepted::send($inviter, $accepterName, $targetName);
            } catch (\Throwable $e) {
                // best-effort
            }
        });
    }
}
