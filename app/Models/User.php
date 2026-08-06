<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Models;

use App\Models\Concerns\HasTenantScope;
use App\Services\TokenService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\HasApiTokens;
use App\Core\TenantContext;

class User extends Authenticatable
{
    use HasApiTokens, HasFactory, HasTenantScope;

    protected $table = 'users';

    protected $fillable = [
        'name', 'first_name', 'last_name', 'email', 'username',
        'status', 'avatar_url', 'bio', 'tagline', 'location', 'latitude', 'longitude',
        'phone', 'is_verified', 'is_approved',
        'onboarding_completed', 'date_of_birth',
        'profile_type', 'organization_name', 'totp_enabled',
        // Privacy toggles — written by UserService::updatePrivacy() via fill()/save().
        // Without these here, mass-assignment protection silently drops them and the
        // React settings page's "save" writes nothing (profile visibility + search
        // indexing revert). updatePrivacy() strictly whitelists + validates these and
        // is self-scoped to the authenticated user.
        'privacy_profile', 'privacy_search',
        // notification_preferences intentionally excluded from $fillable —
        // it is a sensitive JSON blob mass-assignable only via the explicit
        // updateNotificationPreferences(int $userId, array $prefs) static method
        // below (with tenant scoping + structural validation).
        'email_verified_at', 'last_active_at',
    ];

    protected $hidden = [
        'password_hash', 'totp_secret', 'totp_backup_codes',
        'remember_token', 'api_token', 'verification_token', 'two_factor_secret',
        'tenant_id', 'is_god', 'is_super_admin', 'is_tenant_super_admin',
        'balance', 'notification_preferences',
        // Legacy safeguarding/vetting fields remain private even if a model is
        // accidentally serialized outside an explicit API resource.
        'vetting_status', 'vetting_expires_at',
        'works_with_children', 'works_with_vulnerable_adults',
        'no_home_visits', 'requires_home_visits',
        'safeguarding_notes', 'safeguarding_reviewed_by', 'safeguarding_reviewed_at',
    ];

    protected $appends = ['avatar', 'tagline'];

    protected $casts = [
        'latitude' => 'float',
        'longitude' => 'float',
        'balance' => 'decimal:2',
        'is_verified' => 'boolean',
        'is_admin' => 'boolean',
        'is_super_admin' => 'boolean',
        'is_god' => 'boolean',
        'is_tenant_super_admin' => 'boolean',
        'is_approved' => 'boolean',
        'onboarding_completed' => 'boolean',
        'totp_enabled' => 'boolean',
        'email_verified_at' => 'datetime',
        'last_active_at' => 'datetime',
        'notification_preferences' => 'array',
    ];

    /**
     * Accessor: React frontend expects 'avatar' (alias for avatar_url).
     */
    public function getAvatarAttribute(): ?string
    {
        return $this->avatar_url;
    }

    /**
     * Accessor: React frontend expects 'tagline'.
     * Returns the real tagline column if set, otherwise falls back to a
     * truncated bio so every member has something displayed.
     */
    public function getTaglineAttribute(): ?string
    {
        $raw = $this->getRawOriginal('tagline');
        if (!empty($raw)) {
            return $raw;
        }
        // Fallback: first 120 chars of bio
        $bio = $this->getRawOriginal('bio') ?? $this->bio;
        return $bio ? mb_substr($bio, 0, 120) : null;
    }

    /**
     * Mutator: strip HTML tags from phone numbers to prevent stored XSS / display corruption.
     */
    public function setPhoneAttribute(?string $value): void
    {
        $this->attributes['phone'] = $value !== null ? strip_tags($value) : null;
    }

    public function getAuthPassword(): string
    {
        return $this->password_hash;
    }

    public function listings(): HasMany
    {
        return $this->hasMany(Listing::class);
    }

    public function groups(): \Illuminate\Database\Eloquent\Relations\BelongsToMany
    {
        return $this->belongsToMany(Group::class, 'group_members')
                     ->withPivot('role', 'status')
                     ->withTimestamps();
    }

    public function connections(): HasMany
    {
        return $this->hasMany(Connection::class);
    }

    public function reviewsReceived(): HasMany
    {
        return $this->hasMany(Review::class, 'receiver_id');
    }

    public function reviewsGiven(): HasMany
    {
        return $this->hasMany(Review::class, 'reviewer_id');
    }

    public function notifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }

    public function sentTransactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'sender_id');
    }

    public function receivedTransactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'receiver_id');
    }

    public function badges(): HasMany
    {
        return $this->hasMany(UserBadge::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', 'active');
    }

    public function scopeAdmins(Builder $query): Builder
    {
        return $query->whereIn('role', ['admin', 'super_admin', 'tenant_admin']);
    }

    public function scopeVerified(Builder $query): Builder
    {
        return $query->where('is_verified', true);
    }

    /**
     * Standard user lookup columns. Kept private to avoid duplicating the select list.
     */
    private static function findByIdSelectColumns(): array
    {
        return [
            'id', 'first_name', 'last_name',
            DB::raw("CASE
                WHEN profile_type = 'organisation' AND organization_name IS NOT NULL AND organization_name != '' THEN organization_name
                ELSE CONCAT(COALESCE(first_name, ''), ' ', COALESCE(last_name, ''))
            END as name"),
            'organization_name', 'email', 'role', 'status', 'profile_type', 'balance', 'bio', 'tagline',
            'location', 'latitude', 'longitude', 'skills', 'phone', 'avatar_url',
            'created_at', 'tenant_id', 'is_approved', 'preferred_language',
            'privacy_profile', 'privacy_search',
            'is_admin', 'is_super_admin', 'is_god', 'is_tenant_super_admin', 'onboarding_completed',
            DB::raw('COALESCE(xp, 0) as xp'),
            DB::raw('COALESCE(level, 1) as level'),
            'last_active_at', 'last_login_at',
        ];
    }

    /**
     * Find user by ID, returning as array for legacy compatibility.
     *
     * SECURITY: Always enforces tenant_id scoping when $withTenant=true and a tenant
     * context is set. Super-admin cross-tenant lookups must use findByIdGlobal() with
     * an explicit Sanctum-authenticated super-admin caller — NEVER via session flags.
     */
    public static function findById(int $id, bool $withTenant = true): ?array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('users')
            ->select(self::findByIdSelectColumns())
            ->where('id', $id);

        if ($withTenant && $tenantId) {
            $query->where('tenant_id', $tenantId);
        }

        $row = $query->first();
        return $row ? (array) $row : null;
    }

    /**
     * Find user by ID WITHOUT tenant scoping. Intended only for legitimate
     * super-admin / platform-level flows. Callers MUST verify the current request
     * is authenticated as a super admin via Sanctum (Auth::user()->is_super_admin)
     * BEFORE invoking this method. Do not gate on $_SESSION.
     */
    public static function findByIdGlobal(int $id): ?array
    {
        $row = DB::table('users')
            ->select(self::findByIdSelectColumns())
            ->where('id', $id)
            ->first();

        return $row ? (array) $row : null;
    }

    /**
     * Find user by email (tenant-scoped, allows super admins).
     */
    public static function findByEmail(string $email): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('users')
            ->where('email', $email)
            ->where(function ($q) use ($tenantId) {
                $q->where('tenant_id', $tenantId)
                  ->orWhere('is_super_admin', 1)
                  ->orWhere('is_tenant_super_admin', 1);
            })
            ->first();

        return $row ? (array) $row : null;
    }

    /**
     * Find user by email globally (no tenant scope).
     */
    public static function findGlobalByEmail(string $email): ?array
    {
        $row = DB::table('users')->where('email', $email)->first();
        return $row ? (array) $row : null;
    }

    /**
     * Update user's last active timestamp.
     */
    public static function updateLastActive(int $userId): void
    {
        try {
            DB::table('users')->where('id', $userId)->where('tenant_id', TenantContext::getId())->update(['last_active_at' => now()]);
        } catch (\Exception $e) {
            // Column may not exist yet - silently fail
        }
    }

    /**
     * Create a user with explicit tenant ID.
     */
    public static function createWithTenant(array $data, int $tenantId): ?int
    {
        $email = $data['email'] ?? '';

        // Check if email already exists
        $existing = DB::table('users')->where('email', $email)->first();
        if ($existing) {
            return null;
        }

        $firstName = $data['first_name'] ?? '';
        $lastName = $data['last_name'] ?? '';
        $password = $data['password'] ?? '';
        $hash = password_hash($password, PASSWORD_ARGON2ID);

        $userId = DB::table('users')->insertGetId([
            'tenant_id' => $tenantId,
            'first_name' => $firstName,
            'last_name' => $lastName,
            'name' => trim($firstName . ' ' . $lastName),
            'email' => $email,
            'password_hash' => $hash,
            'role' => $data['role'] ?? 'member',
            'location' => $data['location'] ?? null,
            'phone' => $data['phone'] ?? null,
            'profile_type' => $data['profile_type'] ?? 'individual',
            'organization_name' => $data['organization_name'] ?? null,
            'is_approved' => $data['is_approved'] ?? 1,
            'is_tenant_super_admin' => $data['is_tenant_super_admin'] ?? 0,
            'created_at' => now(),
        ]);

        // Seed federation settings
        if ($userId > 0) {
            try {
                DB::statement(
                    "INSERT IGNORE INTO federation_user_settings (
                        user_id, federation_optin, profile_visible_federated,
                        messaging_enabled_federated, transactions_enabled_federated,
                        appear_in_federated_search, show_skills_federated,
                        show_location_federated, service_reach, opted_in_at, created_at
                    ) VALUES (?, 0, 0, 0, 0, 0, 0, 0, 'local_only', NULL, NOW())",
                    [$userId]
                );
            } catch (\Exception $e) {
                \Illuminate\Support\Facades\Log::warning("User::createWithTenant federation seed error: " . $e->getMessage());
            }
        }

        return (int) $userId;
    }

    /**
     * Get notification preferences for a user.
     */
    public static function getNotificationPreferences(int $userId): array
    {
        $defaults = [
            'email_messages' => 1,
            'email_listings' => 1,
            'email_digest' => 0,
            'email_connections' => 1,
            'email_transactions' => 1,
            'email_reviews' => 1,
            'email_events' => 1,
            'push_enabled' => 1,
            'push_campaigns_opted_in' => 0,
            'email_org_payments' => 1,
            'email_org_transfers' => 1,
            'email_org_membership' => 1,
            'email_org_admin' => 1,
            'email_gamification_digest' => 1,
            'email_gamification_milestones' => 1,
            'caring_smart_nudges' => 1,
        ];

        try {
            $tenantId = TenantContext::getId();
            $row = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->value('notification_preferences');

            if ($row) {
                return json_decode($row, true) ?: $defaults;
            }
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[User::getNotificationPreferences] Error: ' . $e->getMessage());
        }

        return $defaults;
    }

    /**
     * Update notification preferences for a user.
     */
    public static function updateNotificationPreferences(int $userId, array $prefs): bool
    {
        // Allowlist of permitted notification preference keys. Any unknown keys
        // are silently dropped. This prevents callers from stuffing arbitrary
        // JSON (and potentially sensitive fields) into the column via the API.
        $allowed = [
            'email_messages', 'email_listings', 'email_digest',
            'email_connections', 'email_transactions',
            'email_reviews', 'email_events', 'push_enabled', 'push_campaigns_opted_in',
            'email_org_payments', 'email_org_transfers', 'email_org_membership',
            'email_org_admin', 'email_gamification_digest',
            'email_gamification_milestones',
            'caring_smart_nudges',
        ];

        $sanitized = [];
        foreach ($allowed as $key) {
            if (array_key_exists($key, $prefs)) {
                $value = filter_var($prefs[$key], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
                if ($value === null) {
                    return false;
                }
                $sanitized[$key] = $value ? 1 : 0;
            }
        }

        if ($sanitized === []) {
            return false;
        }

        try {
            $tenantId = TenantContext::getId();
            $query = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId);

            // Atomic JSON_SET avoids lost updates when independent settings
            // requests or an unsubscribe arrive at the same time.
            $assignments = [];
            foreach ($sanitized as $key => $value) {
                $assignments[] = "'$.{$key}', {$value}";
            }
            $document = "CASE WHEN JSON_VALID(notification_preferences) THEN notification_preferences ELSE JSON_OBJECT() END";
            $updated = $query->update([
                'notification_preferences' => DB::raw('JSON_SET(' . $document . ', ' . implode(', ', $assignments) . ')'),
                'updated_at' => now(),
            ]);

            return $updated === 1 || $query->exists();
        } catch (\Exception $e) {
            \Illuminate\Support\Facades\Log::warning('[User::updateNotificationPreferences] Error: ' . $e->getMessage());
            return false;
        }
    }

    /**
     * Update admin-controlled fields (role, is_approved, optionally is_super_admin).
     */
    public static function updateAdminFields(int $userId, array $fields): bool
    {
        $tenantId = $fields['tenant_id'] ?? TenantContext::getId();
        $updateData = [];

        if (isset($fields['role'])) {
            $updateData['role'] = $fields['role'];
        }
        if (isset($fields['is_approved'])) {
            $updateData['is_approved'] = $fields['is_approved'];
        }

        // Super admin changes require god privileges
        if (isset($fields['is_super_admin'])) {
            $currentUser = DB::table('users')->where('id', $userId)->value('is_super_admin');
            $currentIsSuperAdmin = !empty($currentUser);

            if ((bool) $fields['is_super_admin'] !== $currentIsSuperAdmin) {
                if (empty($_SESSION['is_god'])) {
                    \Illuminate\Support\Facades\Log::warning("SECURITY: Blocked unauthorized is_super_admin change for user {$userId}");
                } else {
                    $updateData['is_super_admin'] = $fields['is_super_admin'] ? 1 : 0;
                }
            }
        }

        if (empty($updateData)) {
            return true;
        }

        $affected = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->update($updateData);

        return $affected > 0;
    }

    /**
     * Check if a user has god-level privileges.
     *
     * When called without arguments, checks the current session.
     * When called with a userId, queries the database.
     */
    public static function isGod(?int $userId = null): bool
    {
        if ($userId === null) {
            return !empty($_SESSION['is_god']);
        }

        $isGod = DB::table('users')
            ->where('id', $userId)
            ->value('is_god');

        return !empty($isGod);
    }

    /**
     * Check if user is a tenant super admin (can access Super Admin Panel).
     */
    public static function isTenantSuperAdmin(int $userId): bool
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->select(['is_tenant_super_admin', 'is_super_admin'])
            ->first();

        return $user && ($user->is_tenant_super_admin || $user->is_super_admin);
    }

    /**
     * Check if user is the Master super admin (tenant_id = 1 + super admin).
     */
    public static function isMasterSuperAdmin(int $userId): bool
    {
        $user = DB::table('users')
            ->where('id', $userId)
            ->select(['tenant_id', 'is_tenant_super_admin', 'is_super_admin'])
            ->first();

        return $user
            && (int) $user->tenant_id === 1
            && ($user->is_tenant_super_admin || $user->is_super_admin);
    }

    /**
     * Move a user to a different tenant (updates users.tenant_id).
     *
     * Returns the result shape the super-admin move endpoints consume.
     * NB: only the users row moves — the user's content stays in the old
     * tenant (a full content migration has never been implemented).
     *
     * 🔴 The money consequence of that, spelled out because it is not obvious and
     * no test covers it: `users.balance` is a column on `users`, so it moves WITH
     * the member, while every `transactions` row keeps the OLD tenant_id and
     * Transaction is tenant-scoped. The member therefore arrives in the
     * destination tenant with a real balance and an EMPTY history (zero earned,
     * zero spent, zero transactions per WalletService::getBalance()), while the
     * origin tenant keeps that history attributed to a member who is no longer
     * there. Nothing recomputes balance from the ledger, and there is no repair
     * tooling. Callers must not present this as "transfer a member between
     * timebanks" — it reassigns an account.
     *
     * `moved` is the affected-row count of the single UPDATE (0 or 1). `failed`
     * carries precondition codes, not a list of tables:
     * - 'already_in_tenant'         destination equals the current tenant
     * - 'email_conflict'            destination already has this email
     *                               (unique_email_tenant would reject the UPDATE)
     * - 'username_conflict'         destination already has this username
     *                               (idx_tenant_username would reject the UPDATE)
     * - 'passkey_recovery_required' passkey-only account, see below
     * - 'tenant_records_pin_user'   the user has rows in tables whose composite
     *                               FK references users(id, tenant_id) — MariaDB
     *                               RESTRICTs the parent UPDATE, so the move is
     *                               impossible while those records exist. The
     *                               blocking tables are returned in 'pinned'.
     *
     * @return array{success: bool, moved: int, failed: array<string>, pinned: array<string, int>}
     */
    public static function moveTenant(int $userId, int $newTenantId): array
    {
        $outcome = DB::transaction(static function () use ($userId, $newTenantId): array {
            $user = DB::table('users')
                ->where('id', $userId)
                ->select(['tenant_id', 'password_hash', 'email', 'username'])
                ->lockForUpdate()
                ->first();

            if ($user === null) {
                return ['affected' => 0, 'failed' => []];
            }

            if ((int) $user->tenant_id === $newTenantId) {
                return ['affected' => 0, 'failed' => ['already_in_tenant']];
            }

            // users carries UNIQUE (email, tenant_id) and UNIQUE (tenant_id,
            // username). Without these pre-checks a collision in the destination
            // surfaces as a QueryException → HTTP 500 with no usable message.
            $emailTaken = $user->email !== null && DB::table('users')
                ->where('tenant_id', $newTenantId)
                ->where('email', $user->email)
                ->exists();
            if ($emailTaken) {
                return ['affected' => 0, 'failed' => ['email_conflict']];
            }

            $usernameTaken = is_string($user->username) && $user->username !== ''
                && DB::table('users')
                    ->where('tenant_id', $newTenantId)
                    ->where('username', $user->username)
                    ->exists();
            if ($usernameTaken) {
                return ['affected' => 0, 'failed' => ['username_conflict']];
            }

            // Dozens of tables (the events subsystem's audit/consent/registration
            // records) pair their actor column with tenant_id in a composite FK to
            // users(id, tenant_id) with no ON UPDATE action, so any row there
            // RESTRICTs the tenant_id UPDATE below. Detect them up front and fail
            // with a structured reason instead of a raw FK error. The two tables
            // this transaction clears itself are excluded.
            $pinned = self::tenantPinnedUserRecords($userId);
            if ($pinned !== []) {
                return ['affected' => 0, 'failed' => ['tenant_records_pin_user'], 'pinned' => $pinned];
            }

            // A passkey is cryptographically scoped to the tenant's RP ID and
            // must never follow an account into a different tenant. Delete all
            // credentials for this user before changing the referenced tenant;
            // the transaction restores them if the move itself fails.
            $oldTenantId = (int) $user->tenant_id;
            $passkeyCount = DB::table('webauthn_credentials')
                ->where('user_id', $userId)
                ->where('tenant_id', $oldTenantId)
                ->lockForUpdate()
                ->count();
            if (
                $passkeyCount > 0
                && (!is_string($user->password_hash) || $user->password_hash === '')
            ) {
                return ['affected' => 0, 'failed' => ['passkey_recovery_required']];
            }

            // A tenant move is a security-boundary change. Revoke every bearer
            // session in the same transaction so an old token cannot inherit
            // destination-tenant access or newly granted privileges.
            if (app(TokenService::class)->revokeAllTokensForUser($userId) < 1) {
                throw new \RuntimeException('Unable to revoke sessions before tenant move.');
            }
            $userModel = self::withoutGlobalScopes()->find($userId);
            if ($userModel === null) {
                throw new \RuntimeException('Unable to resolve user before tenant move.');
            }
            $userModel->tokens()->delete();

            // revokeAllTokensForUser() above only stamps revoked_at on these
            // rows, but fk_refresh_sessions_user_tenant pairs (user_id,
            // tenant_id) against users(id, tenant_id), so any remaining row —
            // revoked or not — RESTRICTs the tenant_id UPDATE below. They are
            // all dead sessions at this point (the global revocation JTI in
            // revoked_tokens outlives them), so delete rather than re-home
            // them: rewriting their tenant_id would falsify where the sessions
            // actually happened.
            DB::table('refresh_token_sessions')
                ->where('user_id', $userId)
                ->delete();

            DB::table('webauthn_credentials')
                ->where('user_id', $userId)
                ->delete();

            $affected = DB::table('users')
                ->where('id', $userId)
                ->update(['tenant_id' => $newTenantId]);

            return ['affected' => $affected, 'failed' => []];
        });

        $affected = (int) $outcome['affected'];

        return [
            'success' => $affected > 0,
            'moved'   => (int) $affected,
            'failed'  => $outcome['failed'],
            'pinned'  => $outcome['pinned'] ?? [],
        ];
    }

    /**
     * Tables holding rows that pin this user to their current tenant.
     *
     * A composite FK `(x_user_id, tenant_id) REFERENCES users (id, tenant_id)`
     * guarantees the actor belongs to the same tenant as the record. MariaDB
     * enforces it with RESTRICT on the parent UPDATE, so a user with any such
     * row cannot change tenant. The list is read from information_schema rather
     * than hardcoded so new composite FKs are picked up automatically.
     *
     * webauthn_credentials and refresh_token_sessions are excluded — moveTenant()
     * clears both inside its transaction.
     *
     * @return array<string, int> table name => row count, only tables with rows
     */
    private static function tenantPinnedUserRecords(int $userId): array
    {
        static $constraints = null;

        if ($constraints === null) {
            $constraints = DB::select(
                "SELECT kcu.TABLE_NAME AS table_name, kcu.COLUMN_NAME AS column_name
                 FROM information_schema.KEY_COLUMN_USAGE kcu
                 WHERE kcu.TABLE_SCHEMA = DATABASE()
                   AND kcu.REFERENCED_TABLE_NAME = 'users'
                   AND kcu.REFERENCED_COLUMN_NAME = 'id'
                   AND kcu.TABLE_NAME NOT IN ('webauthn_credentials', 'refresh_token_sessions')
                   AND EXISTS (
                       SELECT 1
                       FROM information_schema.KEY_COLUMN_USAGE paired
                       WHERE paired.TABLE_SCHEMA = kcu.TABLE_SCHEMA
                         AND paired.TABLE_NAME = kcu.TABLE_NAME
                         AND paired.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
                         AND paired.REFERENCED_TABLE_NAME = 'users'
                         AND paired.REFERENCED_COLUMN_NAME = 'tenant_id'
                   )"
            );
        }

        $pinned = [];
        foreach ($constraints as $constraint) {
            $count = DB::table($constraint->table_name)
                ->where($constraint->column_name, $userId)
                ->count();
            if ($count > 0) {
                $pinned[$constraint->table_name] = ($pinned[$constraint->table_name] ?? 0) + $count;
            }
        }

        return $pinned;
    }
}
