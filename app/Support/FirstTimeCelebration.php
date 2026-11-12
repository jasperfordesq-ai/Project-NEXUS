<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * "Your first offer!" (warmth phase 5, Nov 2026).
 *
 * When a member has just created their very first offer or request, event or
 * group in a community, the create response says so in its `meta`
 * (`celebrate: first_listing|first_event|first_group`) and the member website
 * shows a short celebration in the community's colours.
 *
 * It rides in `meta`, never in `data`: the created item's own shape — which
 * clients validate strictly — is unchanged, and a client that does not know
 * the key ignores it.
 *
 * "First" means the only row of that kind this member has ever made in this
 * community, removed ones included, so deleting and re-creating is not a
 * first again. Call it AFTER the row is written, and only for a genuine
 * create (never an idempotent replay).
 *
 * This is decoration: a caller should treat a failure here as "nothing to
 * celebrate", but the queries are ordinary tenant-scoped counts and throw
 * like any other if the schema is wrong.
 */
final class FirstTimeCelebration
{
    /**
     * kind => [table, the column holding the member who made it, the name published].
     *
     * @var array<string, array{0: string, 1: string, 2: string}>
     */
    private const KINDS = [
        'listing' => ['listings', 'user_id', 'first_listing'],
        'event' => ['events', 'user_id', 'first_event'],
        'group' => ['groups', 'owner_id', 'first_group'],
    ];

    /**
     * @return array{celebrate: string}|null  meta to merge into the create response, or null
     */
    public static function metaFor(string $kind, int $tenantId, int $userId): ?array
    {
        $definition = self::KINDS[$kind] ?? null;
        if ($definition === null || $tenantId <= 0 || $userId <= 0) {
            return null;
        }
        [$table, $ownerColumn, $name] = $definition;

        $count = DB::table($table)
            ->where('tenant_id', $tenantId)
            ->where($ownerColumn, $userId)
            ->count();

        return $count === 1 ? ['celebrate' => $name] : null;
    }
}
