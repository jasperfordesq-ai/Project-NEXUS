<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

use App\Support\Authorization\SafeguardingStaff;
use Illuminate\Support\Facades\DB;

/**
 * Who is told when a volunteer says they are Low or Struggling and asks for
 * someone to get in touch (owner decisions, 20 Oct 2026).
 *
 * Tiers, in order; the first tier a person appears in wins, and nobody is
 * listed twice:
 *
 *  1. `contact`                 the community's named wellbeing contacts
 *     `contact_email`           and its extra wellbeing address, if any
 *  2. `staff` / `self`          the community's safeguarding staff (SafeguardingStaff),
 *                               the volunteer INCLUDED when they are staff: on a
 *                               community with one staff account, excluding them
 *                               meant nobody was told and the feature looked dead
 *  3. `organisation`            the contacts of each organisation the volunteer
 *                               has worked with in the last 180 days (never the
 *                               volunteer themselves: a bell about yourself from
 *                               your own organisation is noise, not a confirmation)
 *  4. `parent_staff`            the safeguarding staff of the community directly
 *                               above this one. Never a sibling, never further up,
 *                               and never the platform master (tenant 1): platform
 *                               administrators are not a community's team
 *  5. `community_contact_email` the community's own contact address, only when
 *                               nothing above produced anyone at all
 *
 * This is a RECIPIENT rule. It grants no access: a named contact who is an
 * ordinary member is pointed at the volunteer's profile, not at the alert.
 */
final class WellbeingRecipientResolver
{
    public const SETTING_CONTACT_IDS = 'volunteering.wellbeing_contact_user_ids';
    public const SETTING_CONTACT_EMAIL = 'volunteering.wellbeing_contact_email';

    /** The platform master is never a community's parent for this purpose. */
    private const PLATFORM_MASTER_TENANT_ID = 1;

    /**
     * @param array<int, string> $organisations organisation id => name, the volunteer's recent ones
     * @return array{
     *   users: array<int, array{tier: string, tenant_id: int, organization_id: ?int, organization_name: ?string, org_admin: bool}>,
     *   emails: list<array{email: string, tier: string}>
     * }
     */
    public static function resolve(int $tenantId, int $volunteerId, array $organisations): array
    {
        $users = [];
        $emails = [];

        // 1. Named wellbeing contacts, validated against THIS community.
        $contactIds = self::contactIds($tenantId);
        if ($contactIds !== []) {
            $active = DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->whereIn('id', $contactIds)
                ->pluck('id');
            foreach ($active as $id) {
                $users[(int) $id] = self::entry('contact', $tenantId);
            }
        }
        $extra = self::contactEmail($tenantId);
        if ($extra !== null) {
            $emails[] = ['email' => $extra, 'tier' => 'contact_email'];
        }

        // 2. Safeguarding staff, the volunteer included.
        $staff = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->where(fn ($q) => SafeguardingStaff::scope($q))
            ->pluck('id');
        foreach ($staff as $id) {
            $id = (int) $id;
            if (!isset($users[$id])) {
                $users[$id] = self::entry($id === $volunteerId ? 'self' : 'staff', $tenantId);
            }
        }

        // 3. Organisation contacts.
        foreach ($organisations as $orgId => $orgName) {
            // Owner and admin members can open the organisation dashboard; a
            // safeguarding lead who is not on the team is pointed at the profile.
            $admins = IncidentAccess::organisationAdminIds($tenantId, (int) $orgId);
            foreach (IncidentAccess::organisationContactIds($tenantId, (int) $orgId) as $contactId) {
                $contactId = (int) $contactId;
                if ($contactId === $volunteerId || isset($users[$contactId])) {
                    continue;
                }
                $users[$contactId] = self::entry('organisation', $tenantId, (int) $orgId, (string) $orgName, in_array($contactId, $admins, true));
            }
        }

        // 4. The staff of the community directly above.
        $parentId = DB::table('tenants')->where('id', $tenantId)->value('parent_id');
        $parentId = $parentId === null ? null : (int) $parentId;
        if ($parentId !== null && $parentId !== self::PLATFORM_MASTER_TENANT_ID && $parentId !== $tenantId) {
            $parentStaff = DB::table('users')
                ->where('tenant_id', $parentId)
                ->where('status', 'active')
                ->where(fn ($q) => SafeguardingStaff::scope($q))
                ->pluck('id');
            foreach ($parentStaff as $id) {
                $id = (int) $id;
                if (!isset($users[$id])) {
                    $users[$id] = self::entry('parent_staff', $parentId);
                }
            }
        }

        // 5. The community's own address, as the very last resort.
        if ($users === [] && $emails === []) {
            $contactEmail = self::normaliseEmail(DB::table('tenants')->where('id', $tenantId)->value('contact_email'));
            if ($contactEmail !== null) {
                $emails[] = ['email' => $contactEmail, 'tier' => 'community_contact_email'];
            }
        }

        // An address that belongs to someone already on the list is not a second person.
        if ($emails !== [] && $users !== []) {
            $known = DB::table('users')
                ->whereIn('id', array_keys($users))
                ->pluck('email')
                ->map(fn ($e) => self::normaliseEmail($e))
                ->filter()
                ->flip()
                ->all();
            $emails = array_values(array_filter($emails, fn (array $row) => !isset($known[$row['email']])));
        }

        return ['users' => $users, 'emails' => $emails];
    }

    /** @return list<int> */
    public static function contactIds(int $tenantId): array
    {
        $raw = self::setting($tenantId, self::SETTING_CONTACT_IDS);
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;
        if (!is_array($decoded)) {
            return [];
        }

        return array_values(array_unique(array_map('intval', array_filter($decoded, 'is_numeric'))));
    }

    public static function contactEmail(int $tenantId): ?string
    {
        return self::normaliseEmail(self::setting($tenantId, self::SETTING_CONTACT_EMAIL));
    }

    private static function setting(int $tenantId, string $key): mixed
    {
        try {
            return app(\App\Services\TenantSettingsService::class)->get($tenantId, $key);
        } catch (\Throwable $e) {
            \Illuminate\Support\Facades\Log::error('WellbeingRecipientResolver: setting unreadable', ['key' => $key, 'error' => $e->getMessage()]);
            return null;
        }
    }

    private static function normaliseEmail(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $email = mb_strtolower(trim($value));

        return filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    /** @return array{tier: string, tenant_id: int, organization_id: ?int, organization_name: ?string, org_admin: bool} */
    private static function entry(string $tier, int $tenantId, ?int $orgId = null, ?string $orgName = null, bool $orgAdmin = false): array
    {
        return ['tier' => $tier, 'tenant_id' => $tenantId, 'organization_id' => $orgId, 'organization_name' => $orgName, 'org_admin' => $orgAdmin];
    }
}
