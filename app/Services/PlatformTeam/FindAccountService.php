<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Core\ClientIp;
use App\Services\TokenService;
use App\Support\Authorization\ManagerDelegate;
use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Find an account, and sign it out everywhere.
 *
 * Two acts and no others:
 *
 *   find()     the accounts that use one exact email address, in any
 *              community, with what the platform team needs to tell them
 *              apart (name, community, role, level, last sign-in, two-step,
 *              how many sign-ins are open).
 *   signOut()  ends every sign-in of one account. It does not change the
 *              password, the role or the access.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter, because the question
 * is "who uses this address anywhere on this installation". Correct only
 * because nothing below the platform team can call it. Query builder, never
 * the User model: the model filters to the caller's own community.
 *
 * 🔴 The address searched for is never written anywhere: not in the record of
 * the search, not in the application log, not in the answer. The record holds
 * the ids found and nothing else.
 *
 * 🔴 Exact match only (`email = ?`, which uses `idx_users_email`). Never
 * `LIKE`: a pattern search would turn this page into a way to list members.
 * The column's collation decides what "the same address" is, exactly as it
 * does at sign-in: capital letters do not matter.
 *
 * 🔴 Never found, and never acted on: a manager's stand-in (`status =
 * 'delegate'`, App\Support\Authorization\ManagerDelegate; it never signs in)
 * and an erased account (`anonymized_at` set; it is nobody's any more).
 *
 * 🔴 Both acts are recorded, and neither happens without its record. A search
 * that cannot be recorded throws, so no answer is sent. A sign-out and its
 * record are written in one transaction: if the record fails, the sign-ins
 * are not ended.
 */
final class FindAccountService
{
    public const LOOKUPS_PER_MINUTE = 30;

    public const SIGN_OUTS_PER_MINUTE = 20;

    /** A ceiling, not a page size: one address is in at most one account per community. */
    public const MATCH_LIMIT = 200;

    public const EMAIL_MAX = 255;

    public const REASON_MIN = 5;

    public const REASON_MAX = 200;

    /** `activity_log.action` for a search. The row has no community (`tenant_id` NULL). */
    public const LOOKUP_ACTION = 'platform_team_account_lookup';

    /** `org_audit_log.action` for a sign-out. The row is in the TARGET's community. */
    public const SIGN_OUT_ACTION = 'platform_team_signed_out_everywhere';

    /** `refresh_token_sessions.revocation_reason` / `user_trusted_devices.revoked_reason`. */
    public const REVOCATION_REASON = 'platform_team';

    public const DONE = 'done';

    public const NOT_FOUND = 'not_found';

    public const FAILED = 'failed';

    /**
     * One whole address, trimmed, or null when the input is not one. This is
     * a shape check only ("something@something", no spaces): whether an
     * account uses it is what the search answers.
     */
    public static function cleanEmail(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $email = trim($value);
        if ($email === '' || mb_strlen($email) > self::EMAIL_MAX || preg_match('/\s/u', $email) === 1) {
            return null;
        }
        $at = strpos($email, '@');
        if ($at === false || $at === 0 || $at === strlen($email) - 1 || substr_count($email, '@') !== 1) {
            return null;
        }

        return $email;
    }

    /** The reason, trimmed, or null when it is missing, too short or too long. */
    public static function cleanReason(mixed $value): ?string
    {
        if (!is_string($value)) {
            return null;
        }
        $reason = trim($value);
        $length = mb_strlen($reason);

        return $length >= self::REASON_MIN && $length <= self::REASON_MAX ? $reason : null;
    }

    /**
     * Every account that uses exactly this address, and the record of the
     * search.
     *
     * @return array{matches: list<array<string, mixed>>, truncated: bool}
     *
     * @throws \Throwable when the search could not be recorded (no answer is given)
     */
    public function find(int $actorId, string $email): array
    {
        $rows = DB::table('users as u')
            ->leftJoin('tenants as t', 't.id', '=', 'u.tenant_id')
            ->where('u.email', '=', $email)
            ->whereNull('u.anonymized_at')
            // `status` may be NULL, and NULL is not a stand-in: a bare
            // "!= 'delegate'" would drop such an account.
            ->where(static function ($q): void {
                $q->whereNull('u.status')->orWhere('u.status', '!=', ManagerDelegate::STATUS);
            })
            ->orderBy('u.id')
            ->limit(self::MATCH_LIMIT + 1)
            ->get([
                'u.id', 'u.name',
                // The platform's one display-name rule. Full, because only the
                // platform team can reach this (the strictest admin gate).
                DB::raw(UserDisplayName::sqlFull('u', 'display_name', NameReason::ADMIN_ROUTE)),
                'u.role', 'u.status', 'u.deleted_at',
                'u.is_god', 'u.is_super_admin', 'u.is_tenant_super_admin',
                'u.totp_enabled', 'u.last_login_at',
                'u.tenant_id', 't.name as tenant_name', 't.slug as tenant_slug',
            ]);

        $truncated = $rows->count() > self::MATCH_LIMIT;
        $rows = $rows->take(self::MATCH_LIMIT);
        $ids = $rows->pluck('id')->map(static fn ($id): int => (int) $id)->all();

        $withPasskey = DB::table('webauthn_credentials')
            ->whereIn('user_id', $ids ?: [0])
            ->distinct()
            ->pluck('user_id')
            ->flip();

        // One row per renewal, one family per sign-in: count families. Counted
        // only in the account's own community, as TokenService does before it
        // honours a token.
        $open = [];
        $families = DB::table('refresh_token_sessions')
            ->whereIn('user_id', $ids ?: [0])
            ->whereNull('revoked_at')
            ->where('family_expires_at', '>', now())
            ->groupBy('user_id', 'tenant_id')
            ->selectRaw('user_id, tenant_id, COUNT(DISTINCT family_hash) AS open_sign_ins')
            ->get();
        foreach ($families as $family) {
            $open[(int) $family->user_id . ':' . (int) $family->tenant_id] = (int) $family->open_sign_ins;
        }

        $matches = [];
        foreach ($rows as $row) {
            $name = trim((string) ($row->display_name ?? ''));
            if ($name === '') {
                $name = trim((string) ($row->name ?? ''));
            }

            $matches[] = [
                'id' => (int) $row->id,
                'name' => $name !== '' ? $name : null,
                'community' => $row->tenant_id === null ? null : [
                    'id' => (int) $row->tenant_id,
                    'name' => $row->tenant_name !== null ? (string) $row->tenant_name : null,
                    'slug' => $row->tenant_slug !== null ? (string) $row->tenant_slug : null,
                ],
                // Deleted but not erased: still a person's account, so it is shown, and says so.
                'status' => $row->deleted_at !== null ? 'deleted' : (string) ($row->status ?? 'active'),
                'role' => (string) ($row->role ?? 'member'),
                'level' => self::level($row),
                'last_sign_in_at' => $row->last_login_at !== null
                    ? Carbon::parse((string) $row->last_login_at)->toIso8601String()
                    : null,
                'two_step_on' => !empty($row->totp_enabled),
                'has_passkey' => $withPasskey->has($row->id),
                'signed_in_now' => $row->tenant_id === null
                    ? 0
                    : ($open[(int) $row->id . ':' . (int) $row->tenant_id] ?? 0),
            ];
        }

        $this->recordLookup($actorId, array_column($matches, 'id'));

        return ['matches' => $matches, 'truncated' => $truncated];
    }

    /**
     * End every sign-in of one account, and record who did it and why in that
     * account's own community.
     *
     * @return self::DONE|self::NOT_FOUND|self::FAILED
     */
    public function signOut(int $actorId, int $targetId, string $reason): string
    {
        try {
            return DB::transaction(function () use ($actorId, $targetId, $reason): string {
                $target = DB::table('users')
                    ->where('id', $targetId)
                    ->lockForUpdate()
                    ->first(['id', 'tenant_id', 'status', 'anonymized_at']);

                // An account in no community has no sign-ins (a sign-in belongs
                // to a community) and no community to record the act in.
                if ($target === null
                    || $target->tenant_id === null
                    || $target->anonymized_at !== null
                    || ManagerDelegate::isDelegate($target)) {
                    return self::NOT_FOUND;
                }

                // Sign-ins, trusted devices and push destinations, in its own
                // (nested) transaction. It answers 0 when it could not do it.
                $ended = app(TokenService::class)->revokeAllTokensForUser($targetId, self::REVOCATION_REASON);
                if ($ended < 1) {
                    throw new \RuntimeException('TokenService ended nothing');
                }

                // Not AuditLogService::log(): that stamps the community the
                // CALLER is in. This act belongs to the target's community.
                DB::table('org_audit_log')->insert([
                    'tenant_id' => (int) $target->tenant_id,
                    'organization_id' => null,
                    'user_id' => $actorId,
                    'target_user_id' => $targetId,
                    'action' => self::SIGN_OUT_ACTION,
                    'details' => json_encode(['reason' => $reason], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                    // 🔴 Left empty on purpose. That community's admins can
                    // read this row (AuditLogService::getRecent() sends
                    // `ip_address`), and the platform team's internet address
                    // and browser are not theirs to see.
                    'ip_address' => null,
                    'user_agent' => null,
                    'created_at' => now(),
                ]);

                return self::DONE;
            });
        } catch (\Throwable $e) {
            // Rolled back: nobody was signed out and nothing was recorded.
            Log::error('Platform team: an account could not be signed out everywhere', [
                'actor' => $actorId,
                'target' => $targetId,
                // The kind of error only: a database error quotes the values
                // of the failed statement, the typed text among them.
                'exception' => $e::class,
            ]);

            return self::FAILED;
        }
    }

    /**
     * The level, named as SeniorAccountsService names it, or null for an
     * account that holds no senior access. Pinned to that service by
     * FindAccountTest::test_the_level_is_named_as_the_senior_accounts_page_names_it.
     */
    private static function level(object $row): ?string
    {
        $role = (string) ($row->role ?? 'member');
        $isGlobal = !empty($row->is_super_admin) || $role === 'super_admin';

        return match (true) {
            // Platform team membership needs the is_god COLUMN (PlatformTeam::includes()).
            !empty($row->is_god) && $isGlobal => 'platform_team',
            $isGlobal => 'global_super_admin',
            !empty($row->is_tenant_super_admin) => 'tenant_super_admin',
            !empty($row->is_god) || $role === 'god' => 'platform_flag_only',
            default => null,
        };
    }

    /**
     * One `activity_log` row per search: who searched and which accounts came
     * back. 🔴 Never the address. Not caught here: a search with no record
     * must not give an answer.
     *
     * @param list<int> $userIds
     */
    private function recordLookup(int $actorId, array $userIds): void
    {
        // Not ActivityLog::log(): that stamps the community the writer is in.
        // tenant_id is NULL on purpose: the search covered every community.
        DB::table('activity_log')->insert([
            'tenant_id' => null,
            'user_id' => $actorId > 0 ? $actorId : null,
            'action' => self::LOOKUP_ACTION,
            'details' => json_encode(['matches' => count($userIds), 'user_ids' => $userIds], JSON_THROW_ON_ERROR),
            'is_public' => 0,
            'ip_address' => ClientIp::get(),
            'action_type' => 'admin',
            'entity_type' => 'user',
            'entity_id' => null,
            'created_at' => now(),
        ]);
    }
}
