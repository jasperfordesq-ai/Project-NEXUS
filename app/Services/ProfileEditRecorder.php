<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Records the moment a member saves a change to their own profile.
 *
 * The CRM Activity Timeline reads these rows for its "Updated their profile"
 * entry. It used to read `users.updated_at`, which every write to the row
 * moves — the leaderboard season job, admin edits, presence updates — so
 * system changes were shown as the member editing their profile. A row here is
 * written only from the member's own save, and is never updated afterwards, so
 * its time stays the moment they did it.
 *
 * Only field NAMES are stored, never values: this is an activity trail, not a
 * copy of the profile.
 */
final class ProfileEditRecorder
{
    public const ACTION = 'profile_updated';

    /**
     * @param list<string> $changedFields
     */
    public static function record(int $userId, int $tenantId, array $changedFields): void
    {
        if ($changedFields === []) {
            return;
        }

        // Recording is best-effort: a failure here must never fail the
        // member's save, which has already been committed.
        try {
            DB::table('activity_log')->insert([
                'tenant_id'   => $tenantId,
                'user_id'     => $userId,
                'action'      => self::ACTION,
                'action_type' => 'profile',
                'entity_type' => 'user',
                'entity_id'   => $userId,
                'details'     => json_encode(['fields' => array_values($changedFields)]),
                'is_public'   => 0,
                'created_at'  => now(),
            ]);
        } catch (\Throwable $e) {
            Log::error('Failed to record profile edit', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
        }
    }
}
