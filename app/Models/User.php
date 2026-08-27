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
use App\Support\UserDisplayName;

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

    // `name` is appended as well as stored: a relation loaded with only
    // `first_name`/`last_name` (there are well over a hundred such constrained
    // eager loads) otherwise serialises with no `name` at all, and every front
    // end then falls back to concatenating the contact person -- which is the
    // wrong identity for an organisation account. Appending routes those rows
    // through getNameAttribute() instead.
    protected $appends = ['avatar', 'tagline', 'name'];

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
     * Accessor: the account's DISPLAY name.
     *
     * An organisation account (`profile_type = 'organisation'`) must be
     * identified everywhere by `organization_name`, never by the contact
     * person held in `first_name`/`last_name`. Every writer of `users.name`
     * now stores the resolved value, but this accessor is the defence-in-depth
     * layer: it also repairs rows written before that sync existed, and rows
     * whose organisation name changed without `name` being rewritten.
     *
     * 🔴 The precedence in UserDisplayName::fromParts() is load-order safe on
     * purpose. Dozens of queries select `name` WITHOUT `profile_type` or
     * `organization_name` (e.g. `->select(['email', 'first_name', 'name'])`),
     * and just as many select the name parts without `name`. Preferring the
     * stored value over a first-name-only reconstruction is what stops those
     * partial selects regressing to half a name.
     */
    public function getNameAttribute(): string
    {
        return UserDisplayName::resolve($this);
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
            // An organisation account must store its trading name here, not
            // the contact person's -- `users.name` is what most display paths read.
            'name' => UserDisplayName::forStorage(
                $data['profile_type'] ?? null,
                $data['organization_name'] ?? null,
                $firstName,
                $lastName,
            ),
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
     * Move a user to a different tenant.
     *
     * Moves the users row plus the member's solely-owned content — listings
     * (categories remapped), skills, interests — atomically, via
     * UserTenantContentMover. Open exchange requests carrying no money yet are
     * auto-cancelled with counterparty notification. Relational history stays
     * in the origin tenant BY DESIGN: transactions, messages, feed posts,
     * group memberships, event records, reviews, connections, volunteering
     * hours all involve other members or origin-tenant entities.
     *
     * 🔴 Money: `users.balance` is a column on `users`, so it moves WITH the
     * member, while every `transactions` row keeps the OLD tenant_id. The
     * member arrives with a real balance and an empty ledger; the origin
     * tenant keeps the history. Exchanges already carrying value
     * (in_progress / pending_confirmation / disputed) BLOCK the move.
     *
     * `moved` is the affected-row count of the users UPDATE (0 or 1).
     * `failed` carries precondition codes, with specifics in `details`:
     * - 'already_in_tenant'                  destination equals current tenant
     * - 'email_conflict' / 'username_conflict'  destination identity collision
     * - 'passkey_recovery_required'          passkey-only account, see below
     * - 'tenant_records_pin_user'            composite-FK rows (events
     *   subsystem) RESTRICT the users UPDATE; blocking tables in 'pinned'
     * - 'group_ownership_transfer_required'  solely-owned groups (names in
     *   details.groups) — transfer ownership first
     * - 'exchanges_in_flight'                exchanges with work/money at stake
     *   (count in details.exchange_count) — finish them first
     *
     * @return array{success: bool, moved: int, failed: array<string>, pinned: array<string, int>, details: array<string, mixed>, content: array<string, int>}
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

            $oldTenantId = (int) $user->tenant_id;

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

            // A group with no other owner would become permanently
            // unmanageable — every canModify/canManage check compares against
            // groups.owner_id, and the departed owner can never satisfy it
            // again. Transfer ownership first (AdminGroupsController exposes
            // GroupLifecycleService::transferOwnership), then move.
            $soloGroups = \App\Services\UserTenantContentMover::soloOwnedGroups($userId, $oldTenantId);
            if ($soloGroups !== []) {
                return [
                    'affected' => 0,
                    'failed' => ['group_ownership_transfer_required'],
                    'details' => ['groups' => array_values($soloGroups)],
                ];
            }

            // Exchanges with work done or money contested can neither be
            // auto-cancelled (value would be destroyed) nor completed after
            // the move (balance updates are tenant-scoped and would debit one
            // side while crediting nobody). They must be finished first.
            $inFlight = \App\Services\UserTenantContentMover::inFlightExchangeCount($userId, $oldTenantId);
            if ($inFlight > 0) {
                return [
                    'affected' => 0,
                    'failed' => ['exchanges_in_flight'],
                    'details' => ['exchange_count' => $inFlight],
                ];
            }

            // A passkey is cryptographically scoped to the tenant's RP ID and
            // must never follow an account into a different tenant. Delete all
            // credentials for this user before changing the referenced tenant;
            // the transaction restores them if the move itself fails.
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

            // Solely-owned content follows the member in the SAME transaction:
            // listings (categories remapped into the destination taxonomy),
            // skills, interests; open no-money-yet exchange requests are
            // cancelled with history rows. See UserTenantContentMover.
            $content = \App\Services\UserTenantContentMover::moveContentWithinTransaction(
                $userId,
                $oldTenantId,
                $newTenantId
            );

            return [
                'affected' => $affected,
                'failed' => [],
                'content' => $content['counts'],
                'moved_listing_ids' => $content['moved_listing_ids'],
                'notices' => $content['cancelled_exchange_notices'],
                'old_tenant_id' => $oldTenantId,
            ];
        });

        $affected = (int) $outcome['affected'];

        // Post-commit side effects: Meilisearch tenant separation is a filter
        // on a shared index, and the raw UPDATEs above fire no Eloquent
        // observers — reindex explicitly or the member (and their listings)
        // keep appearing in the OLD tenant's search. Counterparties of
        // auto-cancelled exchanges are notified in their own locale.
        if ($affected > 0) {
            \App\Services\UserTenantContentMover::afterMoveCommitted(
                $userId,
                (int) ($outcome['old_tenant_id'] ?? 0),
                $outcome['moved_listing_ids'] ?? [],
                $outcome['notices'] ?? []
            );
        }

        return [
            'success' => $affected > 0,
            'moved'   => (int) $affected,
            'failed'  => $outcome['failed'],
            'pinned'  => $outcome['pinned'] ?? [],
            'details' => $outcome['details'] ?? [],
            'content' => $outcome['content'] ?? [],
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
