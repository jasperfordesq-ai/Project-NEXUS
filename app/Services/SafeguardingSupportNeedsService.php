<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\TenantSafeguardingOption;
use App\Models\UserSafeguardingPreference;
use App\Support\UserDisplayName;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Members' support needs — the safeguarding options members chose at
 * onboarding (or later in settings), grouped per member, with the
 * protections those choices switch on and whether staff have seen them.
 *
 * One source for three readers that previously each had their own SQL and
 * their own idea of "needs a look": the broker panel's Members' support needs
 * page, its sidebar badge, and the broker dashboard tile.
 *
 * "Seen" is an `activity_log` row with action `safeguarding_flag_reviewed`
 * against the member. It counts only when it is at least as new as the
 * member's latest answer: saving preferences refreshes `consent_given_at`, so
 * a member who changes what they told us shows as not-yet-seen again. Until
 * 2026-10-03 nothing wrote that action, so the dashboard tile that excluded
 * "reviewed" members could never go down.
 */
class SafeguardingSupportNeedsService
{
    /** activity_log action recording that staff have seen a member's needs. */
    public const SEEN_ACTION = 'safeguarding_flag_reviewed';

    /**
     * Trigger keys that change what the member can do, in display order.
     * `notify_admin_on_selection` is deliberately absent: it tells staff
     * about the choice, it does not protect the member.
     */
    public const PROTECTION_KEYS = [
        'requires_vetted_interaction',
        'requires_broker_approval',
        'restricts_messaging',
        'restricts_matching',
    ];

    /** The opt-out answer ("none of these apply to me"). */
    private const DECLINATION_KEY = 'none_apply';

    /**
     * Every member with a live, effectively-selected safeguarding answer.
     *
     * @param int|null $tenantId null = all tenants (super-admin broker dashboard only)
     * @return list<array{
     *     user_id:int, tenant_id:int, user_name:string, user_avatar:?string,
     *     consent_given_at:?string, options:list<array{option_key:string,label:?string,is_declination:bool}>,
     *     has_triggers:bool, is_declination_only:bool, protections:list<string>,
     *     seen_at:?string, seen_by_name:?string, needs_review:bool
     * }>
     */
    public function listForTenant(?int $tenantId): array
    {
        $query = DB::table('user_safeguarding_preferences as usp')
            ->join('users as u', function ($join) {
                $join->on('u.id', '=', 'usp.user_id')->on('u.tenant_id', '=', 'usp.tenant_id');
            })
            ->join('tenant_safeguarding_options as tso', function ($join) {
                $join->on('tso.id', '=', 'usp.option_id')->on('tso.tenant_id', '=', 'usp.tenant_id');
            })
            ->whereNull('usp.revoked_at')
            ->where('tso.is_active', 1)
            ->select([
                'u.id as user_id',
                'usp.tenant_id',
                DB::raw(UserDisplayName::sql('u', 'user_name')),
                'u.avatar_url as user_avatar',
                'usp.consent_given_at',
                'usp.selected_value',
                'tso.option_key',
                'tso.option_type',
                'tso.preset_source',
                'tso.label as option_label',
                'tso.triggers',
            ])
            ->orderByDesc('usp.consent_given_at')
            ->orderBy('u.id')
            ->orderBy('tso.sort_order');

        if ($tenantId !== null) {
            $query->where('usp.tenant_id', $tenantId);
        }

        $grouped = [];
        foreach ($query->get() as $row) {
            if (! UserSafeguardingPreference::isEffectivelySelected($row->option_type ?? null, $row->selected_value ?? null)) {
                continue;
            }

            $key = (int) $row->tenant_id . ':' . (int) $row->user_id;
            if (! isset($grouped[$key])) {
                $grouped[$key] = [
                    'user_id' => (int) $row->user_id,
                    'tenant_id' => (int) $row->tenant_id,
                    'user_name' => trim((string) $row->user_name),
                    'user_avatar' => $row->user_avatar,
                    'consent_given_at' => $row->consent_given_at,
                    'options' => [],
                    'has_triggers' => false,
                    // flipped to false the moment any real option is present
                    'is_declination_only' => true,
                    'protections' => [],
                    'seen_at' => null,
                    'seen_by_name' => null,
                    'needs_review' => false,
                ];
            }

            // Rows arrive newest-answer first, but keep the latest explicitly
            // in case two options were saved at different times.
            if ($row->consent_given_at !== null
                && ($grouped[$key]['consent_given_at'] === null
                    || strtotime((string) $row->consent_given_at) > strtotime((string) $grouped[$key]['consent_given_at']))) {
                $grouped[$key]['consent_given_at'] = $row->consent_given_at;
            }

            $triggers = json_decode($row->triggers ?? '{}', true) ?: [];
            $isDeclination = $row->option_key === self::DECLINATION_KEY;

            $grouped[$key]['options'][] = [
                'option_key' => $row->option_key,
                'label' => TenantSafeguardingOption::localizeOptionText(
                    $row->preset_source,
                    $row->option_key,
                    'label',
                    $row->option_label,
                ),
                'is_declination' => $isDeclination,
            ];

            if (array_filter($triggers, fn ($v) => $v === true) !== []) {
                $grouped[$key]['has_triggers'] = true;
            }
            foreach (self::PROTECTION_KEYS as $protection) {
                if (($triggers[$protection] ?? false) === true) {
                    $grouped[$key]['protections'][$protection] = true;
                }
            }
            if (! $isDeclination) {
                $grouped[$key]['is_declination_only'] = false;
            }
        }

        if ($grouped === []) {
            return [];
        }

        $seen = $this->latestSeen(array_values($grouped));

        foreach ($grouped as $key => &$entry) {
            // Stable display order regardless of which option set it.
            $entry['protections'] = array_values(array_filter(
                self::PROTECTION_KEYS,
                fn (string $p) => isset($entry['protections'][$p]),
            ));

            $mark = $seen[$key] ?? null;
            if ($mark !== null && $this->isCurrent($mark['seen_at'], $entry['consent_given_at'])) {
                $entry['seen_at'] = $mark['seen_at'];
                $entry['seen_by_name'] = $mark['seen_by_name'];
            }
            $entry['needs_review'] = ! $entry['is_declination_only'] && $entry['seen_at'] === null;

            // The columns hold UTC with no zone marker; a browser reads a bare
            // "2026-10-03 06:42:35" as its own local time, which showed a mark
            // made two minutes ago as "1 hr ago" in Ireland. Send ISO 8601.
            $entry['consent_given_at'] = $this->iso($entry['consent_given_at']);
            $entry['seen_at'] = $this->iso($entry['seen_at']);
        }
        unset($entry);

        return array_values($grouped);
    }

    /**
     * How many members told us they need support and have not been seen since.
     *
     * @param int|null $tenantId null = all tenants (super-admin broker dashboard only)
     */
    public function unseenCount(?int $tenantId): int
    {
        return count(array_filter(
            $this->listForTenant($tenantId),
            fn (array $entry) => $entry['needs_review'],
        ));
    }

    /**
     * The member's current entry, or null when they have no live answer in
     * this tenant (nothing to have seen).
     */
    public function findForMember(int $tenantId, int $userId): ?array
    {
        foreach ($this->listForTenant($tenantId) as $entry) {
            if ($entry['user_id'] === $userId) {
                return $entry;
            }
        }

        return null;
    }

    /**
     * Record that $staffUserId has seen $userId's support needs. Caller has
     * already checked the member's entry exists and the self-interest rule.
     */
    public function markSeen(int $tenantId, int $staffUserId, int $userId, ?string $ipAddress): void
    {
        DB::table('activity_log')->insert([
            'tenant_id' => $tenantId,
            'user_id' => $staffUserId,
            'action' => self::SEEN_ACTION,
            'action_type' => 'safeguarding',
            'entity_type' => 'user',
            'entity_id' => $userId,
            'details' => json_encode(['source' => 'broker_support_needs']),
            'ip_address' => $ipAddress,
            'created_at' => now(),
        ]);
    }

    /**
     * Latest seen mark per tenant:user key for the given entries.
     *
     * @param list<array{user_id:int, tenant_id:int}> $entries
     * @return array<string, array{seen_at:string, seen_by_name:?string}>
     */
    private function latestSeen(array $entries): array
    {
        $byTenant = [];
        foreach ($entries as $entry) {
            $byTenant[$entry['tenant_id']][] = $entry['user_id'];
        }

        $latest = [];
        foreach ($byTenant as $tenantId => $userIds) {
            foreach (array_chunk($userIds, 500) as $chunk) {
                $rows = DB::table('activity_log as al')
                    ->leftJoin('users as staff', function ($join) {
                        $join->on('staff.id', '=', 'al.user_id')->on('staff.tenant_id', '=', 'al.tenant_id');
                    })
                    ->where('al.tenant_id', $tenantId)
                    ->where('al.action', self::SEEN_ACTION)
                    ->where('al.entity_type', 'user')
                    ->whereIn('al.entity_id', $chunk)
                    ->orderByDesc('al.created_at')
                    ->orderByDesc('al.id')
                    ->select([
                        'al.entity_id',
                        'al.created_at',
                        DB::raw(UserDisplayName::sql('staff', 'seen_by_name')),
                    ])
                    ->get();

                foreach ($rows as $row) {
                    $key = $tenantId . ':' . (int) $row->entity_id;
                    if (! isset($latest[$key])) {
                        $name = trim((string) ($row->seen_by_name ?? ''));
                        $latest[$key] = [
                            'seen_at' => (string) $row->created_at,
                            'seen_by_name' => $name !== '' ? $name : null,
                        ];
                    }
                }
            }
        }

        return $latest;
    }

    private function iso(?string $timestamp): ?string
    {
        return $timestamp === null ? null : Carbon::parse($timestamp, 'UTC')->toIso8601String();
    }

    private function isCurrent(string $seenAt, ?string $latestAnswerAt): bool
    {
        if ($latestAnswerAt === null) {
            return true;
        }

        return Carbon::parse($seenAt)->greaterThanOrEqualTo(Carbon::parse($latestAnswerAt));
    }
}
