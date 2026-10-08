<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

use Illuminate\Support\Facades\DB;

/**
 * How long a `password_resets` link lives, in one place.
 *
 * Two kinds of link share the table:
 *  - a forgot-password / admin "send password reset" link — the member asked
 *    for it and is waiting, so it lives RESET_TTL_SECONDS (1 hour). Its row
 *    has `expires_at` NULL and expires at created_at + 1 hour;
 *  - an account invitation — the set-password link an administrator-created
 *    member is emailed. The member did not ask for it and rarely acts within
 *    the hour, so it lives INVITATION_TTL_DAYS (owner decision, 8 Oct 2026)
 *    and its row carries an explicit `expires_at`.
 *
 * Either kind is single-use: completing a reset deletes every link for the
 * account (PasswordResetController). Every expiry check and every clean-up
 * must go through liveCondition() / deleteExpired(), or a 7-day invitation is
 * silently killed by a check that still assumes one hour.
 */
final class PasswordResetTokens
{
    public const RESET_TTL_SECONDS = 3600;

    public const INVITATION_TTL_DAYS = 7;

    /**
     * SQL predicate (for whereRaw) that is true while a row's link is live.
     * NOW() is the database clock throughout, the same clock created_at uses.
     * One COALESCE rather than "IS NULL … OR …" so the predicate is never
     * NULL — deleteExpired() negates it, and NOT NULL would keep a dead row.
     */
    public static function liveCondition(): string
    {
        return '(COALESCE(expires_at, DATE_ADD(created_at, INTERVAL '
            . self::RESET_TTL_SECONDS . ' SECOND)) >= NOW())';
    }

    /**
     * Issue an account invitation for this address and return the plaintext
     * token for the emailed link (only its SHA-256 is stored, which is what
     * PasswordResetController looks up). Earlier links for the account are
     * left in place: whichever the member uses first consumes them all.
     */
    public function issueInvitation(string $email, int $tenantId): string
    {
        $token = bin2hex(random_bytes(32));
        DB::table('password_resets')->insert([
            'email' => $email,
            'tenant_id' => $tenantId,
            'token' => hash('sha256', $token),
            'created_at' => DB::raw('NOW()'),
            'expires_at' => DB::raw('DATE_ADD(NOW(), INTERVAL ' . self::INVITATION_TTL_DAYS . ' DAY)'),
        ]);

        return $token;
    }

    /** Remove one link, e.g. when the email carrying it could not be sent. */
    public function revoke(string $email, int $tenantId, string $token): void
    {
        DB::table('password_resets')
            ->where('email', $email)
            ->where('tenant_id', $tenantId)
            ->where('token', hash('sha256', $token))
            ->delete();
    }

    /** The scheduled clean-up: delete every link that is no longer live. */
    public function deleteExpired(): int
    {
        return DB::delete('DELETE FROM password_resets WHERE NOT ' . self::liveCondition());
    }
}
