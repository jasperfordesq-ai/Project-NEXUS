<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Moves a member's solely-owned content when their account changes tenant.
 *
 * Called from inside User::moveTenant()'s transaction, so every table update
 * here commits or rolls back atomically with the users row itself. All queries
 * use explicit tenant ids — NEVER TenantContext — because the acting super
 * admin's context tenant is neither the source nor (necessarily) the
 * destination of the move.
 *
 * What moves: the member's listings (offers/requests, categories remapped by
 * slug/name into the destination taxonomy), their skills and their interests.
 * What is closed: open exchange requests involving them that carry no money
 * yet (pending/accepted/scheduled) — the counterparty is notified after
 * commit. What blocks the move: groups they solely own (ownership must be
 * transferred first) and exchanges where work or money is already in play
 * (in_progress / pending_confirmation / disputed) — cancelling those would
 * destroy value, and completing them after the move hits tenant-scoped
 * balance updates that cannot land.
 *
 * Relational history (transactions, messages, feed posts, group memberships,
 * event records, reviews, connections, volunteering hours) deliberately stays
 * in the origin tenant — see the plan record in CHANGELOG and
 * docs/ROLES-AND-PERMISSIONS.md.
 */
class UserTenantContentMover
{
    /** Exchange statuses safe to auto-close: no work performed, no credits moved. */
    private const CANCELLABLE_EXCHANGE_STATUSES = [
        'pending_provider',
        'pending_broker',
        'accepted',
        'scheduled',
    ];

    /** Exchange statuses that must block the move: work done or money contested. */
    private const BLOCKING_EXCHANGE_STATUSES = [
        'in_progress',
        'pending_confirmation',
        'disputed',
    ];

    /**
     * Groups in $tenantId solely owned by $userId (no other active member with
     * the owner role). Moving the user would leave these permanently
     * unmanageable, so the move refuses until ownership is transferred
     * (AdminGroupsController exposes GroupLifecycleService::transferOwnership).
     *
     * @return array<int, string> group id => group name
     */
    public static function soloOwnedGroups(int $userId, int $tenantId): array
    {
        $rows = DB::table('groups as g')
            ->where('g.owner_id', $userId)
            ->where('g.tenant_id', $tenantId)
            ->where('g.status', '!=', 'deleted')
            ->whereNotExists(function ($query) use ($userId) {
                $query->select(DB::raw(1))
                    ->from('group_members as gm')
                    ->whereColumn('gm.group_id', 'g.id')
                    ->where('gm.role', 'owner')
                    ->where('gm.status', 'active')
                    ->where('gm.user_id', '!=', $userId);
            })
            ->get(['g.id', 'g.name']);

        $groups = [];
        foreach ($rows as $row) {
            $groups[(int) $row->id] = (string) $row->name;
        }

        return $groups;
    }

    /**
     * Count of exchanges involving the user where work or money is already in
     * play. These cannot be auto-closed (value would be destroyed) and cannot
     * survive the move (completion updates balances tenant-scoped, which
     * would debit one side and credit nobody), so they block it.
     */
    public static function inFlightExchangeCount(int $userId, int $tenantId): int
    {
        return (int) DB::table('exchange_requests')
            ->where('tenant_id', $tenantId)
            ->whereIn('status', self::BLOCKING_EXCHANGE_STATUSES)
            ->where(function ($query) use ($userId) {
                $query->where('provider_id', $userId)
                    ->orWhere('requester_id', $userId);
            })
            ->count();
    }

    /**
     * Move the member's solely-owned content. MUST run inside the same DB
     * transaction as the users.tenant_id update.
     *
     * @return array{
     *   counts: array<string, int>,
     *   moved_listing_ids: array<int, int>,
     *   cancelled_exchange_notices: array<int, array{user_id: int, listing_title: string}>
     * }
     */
    public static function moveContentWithinTransaction(int $userId, int $oldTenantId, int $newTenantId): array
    {
        $notices = self::cancelOpenExchanges($userId, $oldTenantId);
        [$listingIds, $uncategorised] = self::moveListings($userId, $oldTenantId, $newTenantId);
        $skillsMoved = self::moveSkills($userId, $oldTenantId, $newTenantId);
        [$interestsMoved, $interestsDropped] = self::moveInterests($userId, $oldTenantId, $newTenantId);

        return [
            'counts' => [
                'listings_moved' => count($listingIds),
                'listings_uncategorised' => $uncategorised,
                'exchange_requests_closed' => count($notices),
                'skills_moved' => $skillsMoved,
                'interests_moved' => $interestsMoved,
                'interests_dropped' => $interestsDropped,
            ],
            'moved_listing_ids' => $listingIds,
            'cancelled_exchange_notices' => $notices,
        ];
    }

    /**
     * Post-commit side effects: search reindex and counterparty notifications.
     * Never throws — the move has already committed; failures are logged with
     * the repair command.
     *
     * @param array<int, int> $movedListingIds
     * @param array<int, array{user_id: int, listing_title: string}> $notices
     */
    public static function afterMoveCommitted(int $userId, int $oldTenantId, array $movedListingIds, array $notices): void
    {
        try {
            $user = \App\Models\User::withoutGlobalScopes()->find($userId);
            if ($user !== null) {
                SearchService::indexUser($user);
            }
            foreach (array_chunk($movedListingIds, 100) as $chunk) {
                $listings = \App\Models\Listing::withoutGlobalScopes()->whereIn('id', $chunk)->get();
                foreach ($listings as $listing) {
                    SearchService::indexListing($listing);
                }
            }
        } catch (\Throwable $e) {
            Log::error('[UserTenantContentMover] search reindex after move failed — run scripts/sync_search_index.php', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }

        if ($notices === []) {
            return;
        }

        try {
            $recipients = DB::table('users')
                ->whereIn('id', array_values(array_unique(array_column($notices, 'user_id'))))
                ->get(['id', 'preferred_language'])
                ->keyBy('id');

            foreach ($notices as $notice) {
                $recipient = $recipients->get($notice['user_id']);
                LocaleContext::withLocale($recipient, static function () use ($notice, $oldTenantId): void {
                    Notification::createNotification(
                        $notice['user_id'],
                        __('api.exchange_closed_member_moved', ['title' => $notice['listing_title']]),
                        '/exchanges',
                        'warning',
                        false,
                        $oldTenantId
                    );
                });
            }
        } catch (\Throwable $e) {
            Log::error('[UserTenantContentMover] counterparty notifications after move failed', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Cancel open exchange requests that carry no money yet, in both
     * directions, and record the transition in exchange_history.
     *
     * @return array<int, array{user_id: int, listing_title: string}> counterparties to notify
     */
    private static function cancelOpenExchanges(int $userId, int $oldTenantId): array
    {
        $open = DB::table('exchange_requests as e')
            ->leftJoin('listings as l', 'l.id', '=', 'e.listing_id')
            ->where('e.tenant_id', $oldTenantId)
            ->whereIn('e.status', self::CANCELLABLE_EXCHANGE_STATUSES)
            ->where(function ($query) use ($userId) {
                $query->where('e.provider_id', $userId)
                    ->orWhere('e.requester_id', $userId);
            })
            ->get(['e.id', 'e.status', 'e.provider_id', 'e.requester_id', 'l.title as listing_title']);

        $notices = [];
        foreach ($open as $exchange) {
            DB::table('exchange_requests')
                ->where('id', $exchange->id)
                ->update([
                    'status' => 'cancelled',
                    'updated_at' => now(),
                ]);

            DB::table('exchange_history')->insert([
                'exchange_id' => $exchange->id,
                'tenant_id' => $oldTenantId,
                'action' => 'cancelled_member_moved_tenant',
                'actor_id' => null,
                'actor_role' => 'system',
                'old_status' => $exchange->status,
                'new_status' => 'cancelled',
                'notes' => 'Closed automatically: a participant moved to a different community.',
                'created_at' => now(),
            ]);

            $counterparty = (int) $exchange->provider_id === $userId
                ? (int) $exchange->requester_id
                : (int) $exchange->provider_id;

            $notices[] = [
                'user_id' => $counterparty,
                'listing_title' => (string) ($exchange->listing_title ?? ''),
            ];
        }

        return $notices;
    }

    /**
     * Re-home the member's listings, remapping category/subcategory into the
     * destination tenant's taxonomy by slug (fallback: name). Unmatched
     * categories become NULL — the UI renders those as uncategorised, which
     * beats silently pointing at another tenant's category.
     *
     * @return array{0: array<int, int>, 1: int} [moved listing ids, uncategorised count]
     */
    private static function moveListings(int $userId, int $oldTenantId, int $newTenantId): array
    {
        $listings = DB::table('listings')
            ->where('user_id', $userId)
            ->where('tenant_id', $oldTenantId)
            ->get(['id', 'category_id', 'subcategory_id']);

        if ($listings->isEmpty()) {
            return [[], 0];
        }

        $oldCategoryIds = $listings->flatMap(
            static fn ($l) => [$l->category_id, $l->subcategory_id]
        )->filter()->unique()->values()->all();

        $categoryMap = self::buildCategoryMap($oldCategoryIds, $newTenantId, 'categories');

        $movedIds = [];
        $uncategorised = 0;
        foreach ($listings as $listing) {
            $newCategoryId = $listing->category_id !== null
                ? ($categoryMap[(int) $listing->category_id] ?? null)
                : null;
            $newSubcategoryId = $listing->subcategory_id !== null
                ? ($categoryMap[(int) $listing->subcategory_id] ?? null)
                : null;

            if ($listing->category_id !== null && $newCategoryId === null) {
                $uncategorised++;
            }

            DB::table('listings')
                ->where('id', $listing->id)
                ->update([
                    'tenant_id' => $newTenantId,
                    'category_id' => $newCategoryId,
                    'subcategory_id' => $newSubcategoryId,
                ]);

            $movedIds[] = (int) $listing->id;
        }

        return [$movedIds, $uncategorised];
    }

    /** @return int number of skill rows moved */
    private static function moveSkills(int $userId, int $oldTenantId, int $newTenantId): int
    {
        $skills = DB::table('user_skills')
            ->where('user_id', $userId)
            ->where('tenant_id', $oldTenantId)
            ->get(['id', 'category_id']);

        if ($skills->isEmpty()) {
            return 0;
        }

        $oldCategoryIds = $skills->pluck('category_id')->filter()->unique()->values()->all();
        $categoryMap = self::buildCategoryMap($oldCategoryIds, $newTenantId, 'skill_categories');

        foreach ($skills as $skill) {
            DB::table('user_skills')
                ->where('id', $skill->id)
                ->update([
                    'tenant_id' => $newTenantId,
                    'category_id' => $skill->category_id !== null
                        ? ($categoryMap[(int) $skill->category_id] ?? null)
                        : null,
                ]);
        }

        return $skills->count();
    }

    /**
     * user_interests.category_id is NOT NULL against the tenant-scoped
     * categories table, so an interest can only move when the destination has
     * a matching category; the rest are dropped (and counted).
     *
     * @return array{0: int, 1: int} [moved, dropped]
     */
    private static function moveInterests(int $userId, int $oldTenantId, int $newTenantId): array
    {
        $interests = DB::table('user_interests')
            ->where('user_id', $userId)
            ->where('tenant_id', $oldTenantId)
            ->get(['id', 'category_id', 'interest_type']);

        if ($interests->isEmpty()) {
            return [0, 0];
        }

        $oldCategoryIds = $interests->pluck('category_id')->unique()->values()->all();
        $categoryMap = self::buildCategoryMap($oldCategoryIds, $newTenantId, 'categories');

        $moved = 0;
        $dropped = 0;
        foreach ($interests as $interest) {
            $newCategoryId = $categoryMap[(int) $interest->category_id] ?? null;

            $duplicateExists = $newCategoryId !== null && DB::table('user_interests')
                ->where('tenant_id', $newTenantId)
                ->where('user_id', $userId)
                ->where('category_id', $newCategoryId)
                ->where('interest_type', $interest->interest_type)
                ->exists();

            if ($newCategoryId === null || $duplicateExists) {
                DB::table('user_interests')->where('id', $interest->id)->delete();
                $dropped++;
                continue;
            }

            DB::table('user_interests')
                ->where('id', $interest->id)
                ->update([
                    'tenant_id' => $newTenantId,
                    'category_id' => $newCategoryId,
                ]);
            $moved++;
        }

        return [$moved, $dropped];
    }

    /**
     * Map old-tenant category ids to destination-tenant ids by slug, falling
     * back to case-insensitive name, within the same category type. Works for
     * both `categories` and `skill_categories` (both carry tenant_id, name,
     * slug; only `categories` has type).
     *
     * @param array<int, int|string> $oldCategoryIds
     * @return array<int, int> old id => new id (unmatched ids absent)
     */
    private static function buildCategoryMap(array $oldCategoryIds, int $newTenantId, string $table): array
    {
        if ($oldCategoryIds === []) {
            return [];
        }

        $hasType = $table === 'categories';
        $columns = $hasType ? ['id', 'slug', 'name', 'type'] : ['id', 'slug', 'name'];

        $oldCategories = DB::table($table)->whereIn('id', $oldCategoryIds)->get($columns);
        if ($oldCategories->isEmpty()) {
            return [];
        }

        $destination = DB::table($table)->where('tenant_id', $newTenantId)->get($columns);

        $bySlug = [];
        $byName = [];
        foreach ($destination as $category) {
            $type = $hasType ? (string) $category->type : '';
            $bySlug[$type . '|' . mb_strtolower((string) $category->slug)] = (int) $category->id;
            $byName[$type . '|' . mb_strtolower(trim((string) $category->name))] = (int) $category->id;
        }

        $map = [];
        foreach ($oldCategories as $category) {
            $type = $hasType ? (string) $category->type : '';
            $slugKey = $type . '|' . mb_strtolower((string) $category->slug);
            $nameKey = $type . '|' . mb_strtolower(trim((string) $category->name));
            $match = $bySlug[$slugKey] ?? $byName[$nameKey] ?? null;
            if ($match !== null) {
                $map[(int) $category->id] = $match;
            }
        }

        return $map;
    }
}
