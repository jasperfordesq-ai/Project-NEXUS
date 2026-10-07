<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\I18n\LocaleContext;
use App\Support\Authorization\AdminTier;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * The team of a volunteer organisation: who belongs to it and in which role
 * (gap D7, 7 Oct 2026). Until now nothing could add or remove a member or
 * change a role after the organisation was created.
 *
 * Owner decision (7 Oct 2026): community admins and the organisation's owners
 * may manage the team. An owner is the person who created the organisation
 * (vol_organizations.user_id) or anyone holding the `owner` role. The `admin`
 * role runs the organisation's day-to-day work and can see the team, but does
 * not change it.
 *
 * Safeguards, all enforced here rather than in a screen:
 *   - the creator is never removed or demoted (they keep management rights
 *     through vol_organizations.user_id whatever their row says);
 *   - nobody changes or removes their own membership;
 *   - the last owner cannot be removed or demoted;
 *   - only an active member of the same community can be added.
 *
 * Removal sets the row to `removed` rather than deleting it, so the history of
 * who was on the team survives and re-adding someone reactivates the row.
 */
class VolunteerOrgMemberService
{
    public const ROLES = ['owner', 'admin', 'member'];

    /**
     * What $actorId may do with the organisation's team.
     *
     * @return array{exists: bool, can_view: bool, can_manage: bool, org: object|null}
     */
    public function access(int $tenantId, int $orgId, int $actorId): array
    {
        $org = DB::selectOne(
            'SELECT id, user_id, name FROM vol_organizations WHERE id = ? AND tenant_id = ?',
            [$orgId, $tenantId]
        );
        if ($org === null) {
            return ['exists' => false, 'can_view' => false, 'can_manage' => false, 'org' => null];
        }

        if ($this->isCommunityAdmin($tenantId, $actorId) || (int) $org->user_id === $actorId) {
            return ['exists' => true, 'can_view' => true, 'can_manage' => true, 'org' => $org];
        }

        $role = $this->activeRole($tenantId, $orgId, $actorId);

        return [
            'exists' => true,
            'can_view' => in_array($role, ['owner', 'admin'], true),
            'can_manage' => $role === 'owner',
            'org' => $org,
        ];
    }

    /**
     * The active team, owners first.
     *
     * @return list<array<string, mixed>>
     */
    public function list(int $tenantId, int $orgId): array
    {
        $creatorId = (int) DB::table('vol_organizations')->where('id', $orgId)->where('tenant_id', $tenantId)->value('user_id');

        $rows = DB::select(
            "SELECT om.user_id, om.role, om.created_at,
                    u.first_name, u.last_name, u.name, u.organization_name, u.profile_type, u.avatar_url
             FROM org_members om
             INNER JOIN users u ON u.id = om.user_id AND u.tenant_id = om.tenant_id
             WHERE om.tenant_id = ? AND om.organization_id = ? AND om.org_type = 'volunteer' AND om.status = 'active'
             ORDER BY FIELD(om.role, 'owner', 'admin', 'member'), om.id ASC
             LIMIT 200",
            [$tenantId, $orgId]
        );

        $items = array_map(static fn ($row) => [
            'user_id' => (int) $row->user_id,
            'name' => UserDisplayName::resolve($row),
            'avatar_url' => $row->avatar_url,
            'role' => in_array($row->role, self::ROLES, true) ? $row->role : 'member',
            'is_creator' => (int) $row->user_id === $creatorId,
            'joined_at' => $row->created_at,
        ], $rows);

        // Older organisations have no team row for the person who registered
        // them, though that person manages it. List them as the owner they are.
        if ($creatorId > 0 && !in_array($creatorId, array_column($items, 'user_id'), true)) {
            $creator = DB::selectOne(
                'SELECT id, first_name, last_name, name, organization_name, profile_type, avatar_url FROM users WHERE id = ? AND tenant_id = ?',
                [$creatorId, $tenantId]
            );
            if ($creator !== null) {
                array_unshift($items, [
                    'user_id' => $creatorId,
                    'name' => UserDisplayName::resolve($creator),
                    'avatar_url' => $creator->avatar_url,
                    'role' => 'owner',
                    'is_creator' => true,
                    'joined_at' => null,
                ]);
            }
        }

        return $items;
    }

    /**
     * @return array{ok: bool, code?: string}
     */
    public function add(int $tenantId, int $orgId, int $actorId, int $userId, string $role): array
    {
        if (!in_array($role, self::ROLES, true)) {
            return ['ok' => false, 'code' => 'INVALID_ROLE'];
        }

        $user = DB::selectOne(
            "SELECT id, preferred_language FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'",
            [$userId, $tenantId]
        );
        if ($user === null) {
            return ['ok' => false, 'code' => 'USER_NOT_FOUND'];
        }

        $result = DB::transaction(function () use ($tenantId, $orgId, $userId, $role) {
            $existing = DB::selectOne(
                "SELECT id, status FROM org_members
                 WHERE organization_id = ? AND org_type = 'volunteer' AND user_id = ? AND tenant_id = ?
                 FOR UPDATE",
                [$orgId, $userId, $tenantId]
            );
            if ($existing !== null && $existing->status === 'active') {
                return ['ok' => false, 'code' => 'ALREADY_MEMBER'];
            }

            if ($existing !== null) {
                DB::update(
                    "UPDATE org_members SET role = ?, status = 'active', updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                    [$role, (int) $existing->id, $tenantId]
                );
            } else {
                DB::insert(
                    "INSERT INTO org_members (tenant_id, organization_id, org_type, user_id, role, status, created_at)
                     VALUES (?, ?, 'volunteer', ?, ?, 'active', NOW())",
                    [$tenantId, $orgId, $userId, $role]
                );
            }

            return ['ok' => true];
        });

        if ($result['ok']) {
            app(AuditLogService::class)->logMemberAdded($orgId, $actorId, $userId, $role);
            $this->notify($tenantId, $orgId, $user, 'added', $role);
        }

        return $result;
    }

    /**
     * @return array{ok: bool, code?: string}
     */
    public function changeRole(int $tenantId, int $orgId, int $actorId, int $userId, string $role): array
    {
        if (!in_array($role, self::ROLES, true)) {
            return ['ok' => false, 'code' => 'INVALID_ROLE'];
        }

        $old = null;
        $result = DB::transaction(function () use ($tenantId, $orgId, $actorId, $userId, $role, &$old) {
            $check = $this->lockAndCheckTarget($tenantId, $orgId, $actorId, $userId);
            if (isset($check['code'])) {
                return ['ok' => false, 'code' => $check['code']];
            }
            $old = $check['role'];
            if ($old === $role) {
                return ['ok' => true, 'unchanged' => true];
            }
            if ($old === 'owner' && $check['other_owners'] === 0) {
                return ['ok' => false, 'code' => 'LAST_OWNER'];
            }

            DB::update(
                'UPDATE org_members SET role = ?, updated_at = NOW() WHERE id = ? AND tenant_id = ?',
                [$role, $check['id'], $tenantId]
            );

            return ['ok' => true];
        });

        if ($result['ok'] && empty($result['unchanged'])) {
            app(AuditLogService::class)->logRoleChanged($orgId, $actorId, $userId, $old, $role);
            $this->notify($tenantId, $orgId, $this->recipient($tenantId, $userId), 'role_changed', $role);
        }

        return ['ok' => $result['ok']] + (isset($result['code']) ? ['code' => $result['code']] : []);
    }

    /**
     * @return array{ok: bool, code?: string}
     */
    public function remove(int $tenantId, int $orgId, int $actorId, int $userId): array
    {
        $result = DB::transaction(function () use ($tenantId, $orgId, $actorId, $userId) {
            $check = $this->lockAndCheckTarget($tenantId, $orgId, $actorId, $userId);
            if (isset($check['code'])) {
                return ['ok' => false, 'code' => $check['code']];
            }
            if ($check['role'] === 'owner' && $check['other_owners'] === 0) {
                return ['ok' => false, 'code' => 'LAST_OWNER'];
            }

            DB::update(
                "UPDATE org_members SET status = 'removed', updated_at = NOW() WHERE id = ? AND tenant_id = ?",
                [$check['id'], $tenantId]
            );

            return ['ok' => true];
        });

        if ($result['ok']) {
            app(AuditLogService::class)->logMemberRemoved($orgId, $actorId, $userId);
            $this->notify($tenantId, $orgId, $this->recipient($tenantId, $userId), 'removed', null);
        }

        return $result;
    }

    /**
     * Locks the organisation's active rows and checks the target may be changed.
     *
     * @return array{code: string}|array{id: int, role: string, other_owners: int}
     */
    private function lockAndCheckTarget(int $tenantId, int $orgId, int $actorId, int $userId): array
    {
        if ($userId === $actorId) {
            return ['code' => 'SELF'];
        }

        $creatorId = (int) DB::table('vol_organizations')->where('id', $orgId)->where('tenant_id', $tenantId)->value('user_id');
        if ($userId === $creatorId) {
            return ['code' => 'CREATOR'];
        }

        // Lock every active row of the team so two owners demoting each other
        // at the same moment cannot both pass the last-owner check.
        $rows = DB::select(
            "SELECT id, user_id, role FROM org_members
             WHERE tenant_id = ? AND organization_id = ? AND org_type = 'volunteer' AND status = 'active'
             FOR UPDATE",
            [$tenantId, $orgId]
        );

        $target = null;
        $otherOwners = 0;
        foreach ($rows as $row) {
            if ((int) $row->user_id === $userId) {
                $target = $row;
            } elseif ($row->role === 'owner') {
                $otherOwners++;
            }
        }

        if ($target === null) {
            return ['code' => 'NOT_MEMBER'];
        }

        return ['id' => (int) $target->id, 'role' => (string) $target->role, 'other_owners' => $otherOwners];
    }

    private function activeRole(int $tenantId, int $orgId, int $userId): ?string
    {
        $role = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $orgId)
            ->where('org_type', 'volunteer')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->value('role');

        return $role === null ? null : (string) $role;
    }

    private function isCommunityAdmin(int $tenantId, int $userId): bool
    {
        $user = DB::selectOne(
            'SELECT role, is_admin, is_super_admin, is_tenant_super_admin, is_god FROM users WHERE id = ? AND tenant_id = ?',
            [$userId, $tenantId]
        );

        return $user !== null && AdminTier::allows($user);
    }

    private function recipient(int $tenantId, int $userId): ?object
    {
        return DB::selectOne('SELECT id, preferred_language FROM users WHERE id = ? AND tenant_id = ?', [$userId, $tenantId]);
    }

    /**
     * Tell the member, in their own language. A failure here never undoes the change.
     */
    private function notify(int $tenantId, int $orgId, ?object $recipient, string $event, ?string $role): void
    {
        if ($recipient === null) {
            return;
        }

        try {
            $orgName = (string) DB::table('vol_organizations')->where('id', $orgId)->where('tenant_id', $tenantId)->value('name');
            // Owners and admins can open the organisation's dashboard; a plain
            // member, or someone removed, is sent to its public page instead.
            $link = in_array($role, ['owner', 'admin'], true)
                ? "/volunteering/org/{$orgId}/dashboard"
                : "/organisations/{$orgId}";

            LocaleContext::withLocale($recipient, function () use ($recipient, $orgName, $event, $role, $link) {
                $message = match ($event) {
                    'added' => __('api.vol_org_member_added_notification', ['org' => $orgName, 'role' => __('api.vol_org_role_' . $role)]),
                    'role_changed' => __('api.vol_org_member_role_notification', ['org' => $orgName, 'role' => __('api.vol_org_role_' . $role)]),
                    default => __('api.vol_org_member_removed_notification', ['org' => $orgName]),
                };
                \App\Models\Notification::createNotification((int) $recipient->id, $message, $link, 'volunteer_org_membership');
            });
        } catch (\Throwable $e) {
            Log::warning('VolunteerOrgMemberService: notification failed', ['org' => $orgId, 'event' => $event, 'error' => $e->getMessage()]);
        }
    }
}
