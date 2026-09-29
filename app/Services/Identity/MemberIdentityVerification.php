<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Identity;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The one answer to "has this member passed an identity check?".
 *
 * A member is identity-verified when they hold an ACTIVE `id_verified` badge
 * in `member_verification_badges` for their own tenant: not revoked and not
 * expired. It is granted when a provider check passes and the name/date of
 * birth match (IdentityWebhookController, OptionalIdentityVerificationController,
 * PollStuckIdentityVerifications), or by an administrator, and it is the same
 * signal the member's profile badge shows.
 *
 * 🔴 Never read these as identity (E-061 F-228 / F-269):
 *  - `users.is_verified` is EMAIL verification;
 *  - `users.verification_completed_at` is also stamped when a check FAILS.
 */
final class MemberIdentityVerification
{
    /** The verification badge that records a passed identity check. */
    public const BADGE_TYPE = 'id_verified';

    public static function isVerified(int $userId, int $tenantId): bool
    {
        if ($userId <= 0 || $tenantId <= 0 || !Schema::hasTable('member_verification_badges')) {
            return false;
        }

        return DB::table('member_verification_badges')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('badge_type', self::BADGE_TYPE)
            ->whereNull('revoked_at')
            ->where(function ($q): void {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->exists();
    }
}
