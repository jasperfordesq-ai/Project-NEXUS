<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use App\Services\SafeguardingService;
use App\Support\Authorization\SafeguardingStaff;
use Illuminate\Support\Facades\DB;

/**
 * Who may see a volunteering safeguarding incident, and as what.
 *
 * Every surface asks only its own question — the staff case file asks
 * staffCanSee(), the reporter's page asks reporterCanSee(), the organisation's page
 * asks orgRelation(). Someone the incident is about never has staff or organisation
 * access (F-507, F-566); a person who reported an incident about themselves keeps
 * the reporter view of it. Relations are read fresh on every call, so removing
 * someone as an organisation admin or lead ends their access at once.
 */
final class IncidentAccess
{
    public const NONE = 'none';
    public const ORG_CONTACT = 'org_contact';
    public const ORG_LEAD = 'org_lead';

    public static function isAboutUser(object $incident, int $userId): bool
    {
        return SafeguardingService::isIncidentAboutUser($incident, $userId);
    }

    /** An active member of community safeguarding staff in this community. */
    public static function isStaff(int $tenantId, int $userId): bool
    {
        if ($userId <= 0) {
            return false;
        }
        $query = DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->where('status', 'active');

        return SafeguardingStaff::scope($query)->exists();
    }

    public static function staffCanSee(object $incident, int $tenantId, int $userId): bool
    {
        return (int) ($incident->tenant_id ?? 0) === $tenantId
            && self::isStaff($tenantId, $userId)
            && !self::isAboutUser($incident, $userId);
    }

    /** The reporter keeps their own report even when it is about themselves (a self-disclosure). */
    public static function reporterCanSee(object $incident, int $userId): bool
    {
        return $userId > 0 && (int) ($incident->reported_by ?? 0) === $userId;
    }

    /** The viewer's relation to this incident through organisation $organizationId: none, org_contact or org_lead. */
    public static function orgRelation(object $incident, int $tenantId, int $userId, int $organizationId): string
    {
        if ($userId <= 0 || $organizationId <= 0
            || (int) ($incident->tenant_id ?? 0) !== $tenantId
            || (int) ($incident->organization_id ?? 0) !== $organizationId
            || self::isAboutUser($incident, $userId)) {
            return self::NONE;
        }

        return self::organisationRelation($tenantId, $userId, $organizationId);
    }

    /** The viewer's relation to the organisation itself, ignoring any incident. */
    public static function organisationRelation(int $tenantId, int $userId, int $organizationId): string
    {
        if ($userId <= 0 || $organizationId <= 0) {
            return self::NONE;
        }
        if (in_array($userId, self::organisationLeadIds($tenantId, $organizationId), true)) {
            return self::ORG_LEAD;
        }
        if (in_array($userId, self::organisationAdminIds($tenantId, $organizationId), true)) {
            return self::ORG_CONTACT;
        }

        return self::NONE;
    }

    /** @return list<int> owner + active owner/admin members + DLP + deputy, active users only, once each */
    public static function organisationContactIds(int $tenantId, int $organizationId): array
    {
        return array_values(array_unique(array_merge(
            self::organisationAdminIds($tenantId, $organizationId),
            self::organisationLeadIds($tenantId, $organizationId)
        )));
    }

    /** @return list<int> the organisation's designated liaison person and deputy, active users only */
    public static function organisationLeadIds(int $tenantId, int $organizationId): array
    {
        $org = DB::table('vol_organizations')
            ->where('id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->first(['dlp_user_id', 'deputy_dlp_user_id']);
        if (!$org) {
            return [];
        }

        return self::activeOnly($tenantId, [(int) ($org->dlp_user_id ?? 0), (int) ($org->deputy_dlp_user_id ?? 0)]);
    }

    /** @return list<int> owner + active owner/admin members, active users only */
    private static function organisationAdminIds(int $tenantId, int $organizationId): array
    {
        $owner = (int) DB::table('vol_organizations')
            ->where('id', $organizationId)
            ->where('tenant_id', $tenantId)
            ->value('user_id');
        $admins = DB::table('org_members')
            ->where('tenant_id', $tenantId)
            ->where('organization_id', $organizationId)
            ->where('org_type', 'volunteer')
            ->where('status', 'active')
            ->whereIn('role', ['owner', 'admin'])
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id)
            ->all();

        return self::activeOnly($tenantId, array_merge([$owner], $admins));
    }

    /**
     * @param list<int> $ids
     * @return list<int>
     */
    private static function activeOnly(int $tenantId, array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, fn (int $id) => $id > 0)));
        if ($ids === []) {
            return [];
        }

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
    }
}
