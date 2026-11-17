<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Services\SuperAdminAuditService;
use App\Support\Authorization\ManagerDelegate;
use App\Support\Names\NameReason;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Platform team panel → Senior accounts: add an account to the platform team,
 * or remove one from it (owner, 17 Nov 2026).
 *
 * 🔴 These are the only two web requests that write `users.is_god`. Until
 * 17 Nov 2026 it was set in the database by hand, and nothing recorded it.
 *
 *   add()     puts an account on the team: sets `is_god`, and `is_super_admin`
 *             too when the account is not a global super admin yet (both legs
 *             of App\Support\Authorization\PlatformTeam). F-431 holds: flags
 *             only, the role string is never touched.
 *   remove()  clears `is_god` and nothing else. The account stays a global
 *             super admin; that is taken away in the super admin panel.
 *
 * The rules, all checked again inside the transaction on locked rows:
 *
 *   - The caller is on the team NOW. Both rows are locked in id order, so two
 *     members removing each other at the same moment cannot both succeed.
 *   - Nobody removes themselves. With the rule above, the team can never be
 *     left empty by this code. (And by no other code either: the database
 *     refuses any write that would delete, erase or demote the last member;
 *     see App\Support\Authorization\PlatformTeam::isLastMember().)
 *   - The account being added is active, and has two-step sign-in on.
 *   - Never a manager's stand-in (`status = 'delegate'`), a deleted account
 *     or an erased one: those answer "not found".
 *
 * 🔴 Each change is written to `super_admin_audit_log` in the same
 * transaction. If the record cannot be written, the change is rolled back.
 *
 * 🔴 Cross-community on purpose: no `tenant_id` filter on the read, because
 * the platform team is not a community's. Correct only because nothing below
 * the platform team can call it. Query builder, never the User model: the
 * model filters to the caller's own community.
 */
final class PlatformTeamMembershipService
{
    public const CHANGES_PER_MINUTE = 10;

    /** `super_admin_audit_log.action_type` values (enum members since 17 Nov 2026). */
    public const ADDED_ACTION = 'platform_team_added';

    public const REMOVED_ACTION = 'platform_team_removed';

    public const DONE = 'done';

    public const NOT_FOUND = 'not_found';

    public const FAILED = 'failed';

    /** The caller left the team between the lock on the door and the write. */
    public const CALLER_NOT_ON_TEAM = 'caller_not_on_team';

    /** Refusals the page explains in words. Sent as the error's `code`. */
    public const TWO_STEP_REQUIRED = 'PLATFORM_TEAM_TWO_STEP_REQUIRED';

    public const NOT_ACTIVE = 'PLATFORM_TEAM_ACCOUNT_NOT_ACTIVE';

    public const ALREADY_MEMBER = 'PLATFORM_TEAM_ALREADY_MEMBER';

    public const NOT_MEMBER = 'PLATFORM_TEAM_NOT_A_MEMBER';

    public const CANNOT_REMOVE_SELF = 'PLATFORM_TEAM_CANNOT_REMOVE_SELF';

    public const REFUSALS = [
        self::TWO_STEP_REQUIRED,
        self::NOT_ACTIVE,
        self::ALREADY_MEMBER,
        self::NOT_MEMBER,
        self::CANNOT_REMOVE_SELF,
    ];

    /** @return string one of the constants above */
    public function add(int $actorId, int $targetId): string
    {
        return $this->change($actorId, $targetId, function (object $actor, object $target): string {
            if (self::onTeam($target)) {
                return self::ALREADY_MEMBER;
            }
            // `status` may be NULL; an account with none recorded is in use.
            if ((string) ($target->status ?? 'active') !== 'active') {
                return self::NOT_ACTIVE;
            }
            if (empty($target->totp_enabled)) {
                return self::TWO_STEP_REQUIRED;
            }

            $isGlobal = self::isGlobalSuperAdmin($target);
            $hadFlag = !empty($target->is_god);

            self::write($target, $isGlobal ? ['is_god' => 1] : ['is_god' => 1, 'is_super_admin' => 1]);

            if (!$isGlobal) {
                self::record($actor, $target, 'global_super_admin_granted', ['is_super_admin' => 0], ['is_super_admin' => 1], 'Granted global super admin to user #' . (int) $target->id . ' (added to the platform team)');
            }
            self::record($actor, $target, self::ADDED_ACTION, ['is_god' => $hadFlag ? 1 : 0], ['is_god' => 1], 'Added user #' . (int) $target->id . ' to the platform team');

            return self::DONE;
        });
    }

    /** @return string one of the constants above */
    public function remove(int $actorId, int $targetId): string
    {
        if ($actorId === $targetId) {
            return self::CANNOT_REMOVE_SELF;
        }

        return $this->change($actorId, $targetId, function (object $actor, object $target): string {
            if (empty($target->is_god)) {
                return self::NOT_MEMBER;
            }

            self::write($target, ['is_god' => 0]);
            self::record($actor, $target, self::REMOVED_ACTION, ['is_god' => 1], ['is_god' => 0], 'Removed user #' . (int) $target->id . ' from the platform team');

            return self::DONE;
        });
    }

    /**
     * Lock the caller and the account, check both, then run the act. Anything
     * thrown rolls the whole thing back and answers FAILED.
     *
     * @param callable(object, object): string $act
     */
    private function change(int $actorId, int $targetId, callable $act): string
    {
        try {
            return DB::transaction(function () use ($actorId, $targetId, $act): string {
                // One statement, in id order: the same order for every caller,
                // so two changes that cross cannot wait on each other for ever.
                $rows = DB::table('users')
                    ->whereIn('id', array_unique([$actorId, $targetId]))
                    ->orderBy('id')
                    ->lockForUpdate()
                    ->get([
                        'id', 'tenant_id', 'first_name', 'last_name', 'name', 'email',
                        'role', 'status', 'is_god', 'is_super_admin', 'totp_enabled',
                        'deleted_at', 'anonymized_at',
                    ])
                    ->keyBy('id');

                $actor = $rows->get($actorId);
                if ($actor === null || !self::onTeam($actor)) {
                    return self::CALLER_NOT_ON_TEAM;
                }

                $target = $rows->get($targetId);
                if ($target === null
                    || $target->deleted_at !== null
                    || $target->anonymized_at !== null
                    || ManagerDelegate::isDelegate($target)) {
                    return self::NOT_FOUND;
                }

                return $act($actor, $target);
            });
        } catch (\Throwable $e) {
            // Rolled back: nothing was changed and nothing was recorded.
            Log::error('Platform team: a membership change could not be made', [
                'actor' => $actorId,
                'target' => $targetId,
                // The kind of error only: a database error can quote values.
                'exception' => $e::class,
            ]);

            return self::FAILED;
        }
    }

    /** Both legs, exactly as App\Support\Authorization\PlatformTeam::includes() reads them. */
    private static function onTeam(object $row): bool
    {
        return !empty($row->is_god) && self::isGlobalSuperAdmin($row);
    }

    private static function isGlobalSuperAdmin(object $row): bool
    {
        return !empty($row->is_super_admin) || (string) ($row->role ?? 'member') === 'super_admin';
    }

    /** @param array<string, int> $flags */
    private static function write(object $target, array $flags): void
    {
        $update = DB::table('users')->where('id', (int) $target->id);
        // The row was read and locked above; its own community is named again
        // so the write can only ever land on that row.
        $target->tenant_id === null
            ? $update->whereNull('tenant_id')
            : $update->where('tenant_id', (int) $target->tenant_id);

        $update->update($flags);
    }

    /**
     * One row in the super admin audit log. Throws when it could not be
     * written faithfully, which rolls the change back.
     *
     * @param array<string, int> $old
     * @param array<string, int> $new
     */
    private static function record(object $actor, object $target, string $action, array $old, array $new, string $description): void
    {
        $recorded = SuperAdminAuditService::log(
            $action,
            'user',
            (int) $target->id,
            UserDisplayName::full($target, NameReason::AUDIT_LOG),
            $old,
            $new,
            $description,
            // Named outright: the audit service otherwise works the caller out
            // from the super admin panel's session, which this panel does not use.
            ['user_id' => (int) $actor->id, 'tenant_id' => (int) ($actor->tenant_id ?? 0)],
        );

        if (!$recorded) {
            throw new \RuntimeException("The platform team change '{$action}' could not be recorded");
        }
    }
}
