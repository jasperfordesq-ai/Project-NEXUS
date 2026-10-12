<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Authorization;

use App\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * The recorded identity of a manager from another community.
 *
 * 🔴 OWNER, 12 October 2026: "Go with option 3" — give a manager from above a
 * recorded identity inside each community it manages.
 *
 * Why it exists: about 45 event tables record the acting account with a
 * composite foreign key (<actor>, tenant_id) -> users(id, tenant_id), so the
 * database only accepts an actor who belongs to the record's community. A
 * tenant super admin managing a community below its own (or the platform owner
 * acting in any community) does not. So, inside that community, it acts as its
 * DELEGATE: a users row with status 'delegate', role 'admin', no password and a
 * non-deliverable email, linked to the real account in
 * `tenant_manager_delegates`. Records then name the delegate, which carries
 * the manager's name.
 *
 * Guarantees:
 *   - created only for an account CrossTenantEntry::mayEnter() admits into the
 *     community, and USABLE only while that is still true (isUsable());
 *   - never signs in: Authenticate refuses every status but 'active', the
 *     password is NULL, and TokenService refuses to mint a token for it;
 *   - cannot be taken over: database triggers refuse giving it a password,
 *     changing its email, role, community or platform flags, or turning it
 *     back into an ordinary account (migration 2026_10_12_180000).
 *
 * Personal data: the manager's first and last name are copied in (DPO-11).
 */
final class ManagerDelegate
{
    public const STATUS = 'delegate';

    private const TABLE = 'tenant_manager_delegates';

    /** @param object|array<string,mixed>|null $user */
    public static function isDelegate(object|array|null $user): bool
    {
        return $user !== null && (string) (data_get($user, 'status') ?? '') === self::STATUS;
    }

    /**
     * The delegate that acts for $principal in $tenantId, created on first use.
     * Null when the principal may not enter that community.
     */
    public static function forPrincipal(User $principal, int $tenantId, bool $lock = false): ?User
    {
        if ($tenantId <= 0 || (int) $principal->tenant_id === $tenantId) {
            return null;
        }
        if ((string) $principal->status !== 'active' || $principal->deleted_at !== null) {
            return null;
        }
        if (! CrossTenantEntry::mayEnter($principal, $tenantId) || ! Schema::hasTable(self::TABLE)) {
            return null;
        }

        $delegate = self::existing((int) $principal->id, $tenantId, $lock)
            ?? self::create($principal, $tenantId)
            ?? self::existing((int) $principal->id, $tenantId, $lock);

        if ($delegate === null) {
            return null;
        }

        self::syncName($delegate, $principal);

        return $delegate;
    }

    /**
     * May this delegate act in $tenantId right now? Its link must be intact and
     * the account it stands for must still be active and still admitted to the
     * community. Checked on every use, so revoking the manager's tenant super
     * admin flag (or moving it) stops the delegate at once.
     */
    public static function isUsable(object|array $delegate, int $tenantId): bool
    {
        $principal = self::principalOf($delegate);
        if ($principal === null || (int) data_get($delegate, 'tenant_id') !== $tenantId) {
            return false;
        }

        return (string) $principal->status === 'active'
            && $principal->deleted_at === null
            && CrossTenantEntry::mayEnter($principal, $tenantId);
    }

    /**
     * May this account ACT (as opposed to being acted on)? An active account,
     * or a delegate that is still usable in its community. Use it wherever an
     * actor check reads "status = 'active'", so a delegate passes there and
     * nowhere else — member-facing queries keep "active" and never see one.
     *
     * @param object|array<string,mixed>|null $user Needs id, tenant_id, status, deleted_at.
     */
    public static function isActingAccount(object|array|null $user): bool
    {
        if ($user === null || data_get($user, 'deleted_at') !== null) {
            return false;
        }
        $status = (string) (data_get($user, 'status') ?? '');
        if ($status === 'active') {
            return true;
        }

        return $status === self::STATUS && self::isUsable($user, (int) data_get($user, 'tenant_id'));
    }

    /** The real account a delegate stands for, or null. */
    public static function principalOf(object|array $delegate): ?User
    {
        if (! self::isDelegate($delegate) || ! Schema::hasTable(self::TABLE)) {
            return null;
        }

        $link = DB::table(self::TABLE)
            ->where('delegate_user_id', (int) data_get($delegate, 'id'))
            ->where('tenant_id', (int) data_get($delegate, 'tenant_id'))
            ->first(['principal_user_id']);
        $principalId = (int) ($link->principal_user_id ?? 0);
        if ($principalId <= 0) {
            return null;
        }

        /** @var User|null $principal */
        $principal = User::withoutGlobalScopes()->whereKey($principalId)->first();

        return $principal;
    }

    private static function existing(int $principalId, int $tenantId, bool $lock): ?User
    {
        $link = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('principal_user_id', $principalId)
            ->first(['delegate_user_id']);
        if ($link === null) {
            return null;
        }

        $query = User::withoutGlobalScopes()
            ->whereKey((int) $link->delegate_user_id)
            ->where('tenant_id', $tenantId)
            ->where('status', self::STATUS);
        if ($lock) {
            $query->lockForUpdate();
        }

        /** @var User|null $delegate */
        $delegate = $query->first();

        return $delegate;
    }

    private static function create(User $principal, int $tenantId): ?User
    {
        $firstName = (string) ($principal->first_name ?? '');
        $lastName = (string) ($principal->last_name ?? '');
        $name = trim($firstName . ' ' . $lastName);
        $now = now();

        try {
            DB::transaction(function () use ($principal, $tenantId, $firstName, $lastName, $name, $now): void {
                // Inserted directly: no model events, so no search indexing,
                // welcome email or other "new member" side effect.
                $delegateId = (int) DB::table('users')->insertGetId([
                    'tenant_id' => $tenantId,
                    'first_name' => $firstName !== '' ? $firstName : null,
                    'last_name' => $lastName !== '' ? $lastName : null,
                    'name' => $name !== '' ? $name : 'Manager',
                    // RFC 2606 reserved domain: nothing can ever be delivered.
                    'email' => 'manager-' . (int) $principal->id . '-' . $tenantId . '@delegate.invalid',
                    'password_hash' => null,
                    'role' => 'admin',
                    'status' => self::STATUS,
                    'is_approved' => 1,
                    'is_admin' => 0,
                    'is_super_admin' => 0,
                    'is_tenant_super_admin' => 0,
                    'is_god' => 0,
                    'onboarding_completed' => 1,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);

                DB::table(self::TABLE)->insert([
                    'tenant_id' => $tenantId,
                    'delegate_user_id' => $delegateId,
                    'principal_user_id' => (int) $principal->id,
                    'principal_tenant_id' => (int) $principal->tenant_id,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            });
        } catch (QueryException $exception) {
            // A concurrent first use created it: the unique keys refused the
            // second insert and the caller re-reads the winner.
            if ((int) ($exception->errorInfo[1] ?? 0) === 1062) {
                return null;
            }
            throw $exception;
        }

        return self::existing((int) $principal->id, $tenantId, false);
    }

    /** Keep the recorded name the manager's current name. Name only — the triggers refuse anything else. */
    private static function syncName(User $delegate, User $principal): void
    {
        $firstName = $principal->first_name;
        $lastName = $principal->last_name;
        if ($delegate->first_name === $firstName && $delegate->last_name === $lastName) {
            return;
        }

        $name = trim((string) $firstName . ' ' . (string) $lastName);
        DB::table('users')
            ->where('id', (int) $delegate->id)
            ->where('tenant_id', (int) $delegate->tenant_id)
            ->where('status', self::STATUS)
            ->update([
                'first_name' => $firstName,
                'last_name' => $lastName,
                'name' => $name !== '' ? $name : 'Manager',
                'updated_at' => now(),
            ]);
        $delegate->first_name = $firstName;
        $delegate->last_name = $lastName;
    }
}
