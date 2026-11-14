<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * One store for likes and reactions: carry every older like into `reactions`.
 *
 * A "like" used to be written to `likes` and an emoji reaction to `reactions`,
 * and nothing reconciled the two. The feed card read reactions, the detail pages
 * read likes, so each showed a different count for the same item and every like
 * given before reactions existed vanished from the feed. From this migration on
 * `reactions` is the only store (a like is the `like` reaction) and the code no
 * longer reads or writes `likes`.
 *
 * What this does, and deliberately does not do:
 *
 *  - Copies each `likes` row to `reactions` as emoji `like`, keeping its date.
 *    INSERT IGNORE against `reactions_unique` (tenant, user, target_type,
 *    target_id) means a member who has since reacted keeps the reaction they
 *    chose, and running this twice changes nothing.
 *  - Normalises the old `volunteering` target to `volunteer`, the name the feed
 *    and ReactionService use.
 *  - Recounts `feed_posts.likes_count` from `reactions`, because that counter
 *    only ever followed `likes`.
 *  - Leaves `likes` exactly as it is. It is retired, not dropped: nothing is
 *    deleted, so this is reversible by simply ignoring the copied rows.
 *  - Does NOT import `post_likes`, `feed_likes` or `post_reactions`. No current
 *    code writes them (`feed_likes` / `post_reactions` are only written by a
 *    demo-data seeder; `post_likes` is a pre-Laravel gamification tally), and a
 *    row there cannot say whether the member later took the like back.
 *
 * Insert-only on a small table (a few hundred rows in production), so it is safe
 * to run while the other blue/green colour is still serving. A like given
 * through the old colour in the minutes between this migration and the traffic
 * switch stays in `likes` only; that window is accepted.
 */
return new class extends Migration
{
    /** Mirrors ReactionService::VALID_TARGET_TYPES (a migration must not depend on app code). */
    private const TARGET_TYPES = [
        'post', 'comment', 'listing', 'event', 'goal', 'poll', 'review',
        'volunteer', 'challenge', 'resource', 'job', 'blog', 'discussion',
    ];

    public function up(): void
    {
        if (!Schema::hasTable('likes') || !Schema::hasTable('reactions')) {
            return;
        }

        $placeholders = implode(',', array_fill(0, count(self::TARGET_TYPES), '?'));

        // `volunteering` rows first, so a member with both spellings ends up
        // with one `volunteer` reaction rather than a duplicate-key failure.
        DB::statement(
            "INSERT IGNORE INTO reactions (user_id, tenant_id, target_type, target_id, emoji, created_at)
             SELECT l.user_id, l.tenant_id, 'volunteer', l.target_id, 'like', l.created_at
             FROM likes l
             WHERE l.target_type = 'volunteering'"
        );

        DB::statement(
            "INSERT IGNORE INTO reactions (user_id, tenant_id, target_type, target_id, emoji, created_at)
             SELECT l.user_id, l.tenant_id, l.target_type, l.target_id, 'like', l.created_at
             FROM likes l
             WHERE l.target_type IN ({$placeholders})",
            self::TARGET_TYPES
        );

        if (Schema::hasTable('feed_posts') && Schema::hasColumn('feed_posts', 'likes_count')) {
            DB::statement(
                "UPDATE feed_posts fp
                 SET fp.likes_count = (
                     SELECT COUNT(*) FROM reactions r
                     WHERE r.tenant_id = fp.tenant_id
                       AND r.target_type = 'post'
                       AND r.target_id = fp.id
                 ),
                 -- `updated_at` is ON UPDATE CURRENT_TIMESTAMP; a recount is
                 -- not an edit, so the post keeps the date it had.
                 fp.updated_at = fp.updated_at
                 WHERE COALESCE(fp.likes_count, 0) <> (
                     SELECT COUNT(*) FROM reactions r2
                     WHERE r2.tenant_id = fp.tenant_id
                       AND r2.target_type = 'post'
                       AND r2.target_id = fp.id
                 )"
            );
        }
    }

    public function down(): void
    {
        // Nothing to undo: `likes` was never changed, and the copied rows are
        // indistinguishable from likes given after the switch.
    }
};
