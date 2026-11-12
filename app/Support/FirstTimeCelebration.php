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
 * "First" means the only row of that kind this member has in this community.
 * A soft-deleted offer still counts, but a group is deleted for good (and an
 * admin can delete an offer for good), so deleting that one and making
 * another can celebrate again; the website also remembers, per member and
 * device, that it has celebrated. Call it AFTER the row is written, and only
 * for a genuine create (never an idempotent replay). An event is celebrated
 * when it is first published ({@see metaForPublishedEvent()}), because a new
 * event is a draft that nobody else can see.
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
    /**
     * An event is created as a draft and only reaches other members when its
     * organiser publishes it, so a first event is celebrated at that moment:
     * when the member's own event has just gone from unpublished to published
     * and it is the only published event they have in this community.
     *
     * @return array{celebrate: string}|null
     */
    public static function metaForPublishedEvent(int $tenantId, int $userId, ?int $ownerId, ?string $publicationBefore): ?array
    {
        $published = \App\Enums\EventPublicationState::Published->value;
        if ($tenantId <= 0 || $userId <= 0 || $ownerId !== $userId || $publicationBefore === $published) {
            return null;
        }

        $count = DB::table('events')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->where('publication_status', $published)
            ->count();

        return $count === 1 ? ['celebrate' => self::KINDS['event'][2]] : null;
    }

    public static function metaFor(string $kind, int $tenantId, int $userId, bool $shownToOthers = true): ?array
    {
        $definition = self::KINDS[$kind] ?? null;
        // `$shownToOthers` is the caller's answer to "can other members see
        // it yet?". The words say "it's up" / "your neighbours can now find
        // it", which is untrue for an offer or group held for review or an
        // event left as a draft (audit of warmth phase 5, 12 Nov 2026).
        if ($definition === null || ! $shownToOthers || $tenantId <= 0 || $userId <= 0) {
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
