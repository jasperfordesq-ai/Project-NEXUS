<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\MemberProfileUpdated;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\User;
use App\Scopes\TenantScope;
use App\Services\OnboardingConfigService;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * UserService — Laravel DI-based service for user/profile operations.
 *
 * Eloquent queries on User are tenant-scoped via HasTenantScope.
 * Raw DB::table() queries are explicitly scoped with tenant_id filters.
 */
class UserService
{
    /** @var array<int, array{code: string, message: string}> */
    private static array $errors = [];

    public function __construct(
        private readonly User $user,
    ) {}

    /**
     * Get a user by ID with related data.
     */
    public static function getById(int $id): ?array
    {
        $user = User::query()
            ->with(['listings', 'badges'])
            ->find($id);

        if (! $user) {
            return null;
        }

        $data = $user->toArray();
        $data['name'] = UserDisplayName::resolve($user);

        return $data;
    }

    /**
     * Get the authenticated user's own profile (for /me endpoint).
     * Matches the legacy UserService::getOwnProfile() response shape.
     */
    public static function getOwnProfile(int $userId): ?array
    {
        return self::getMe($userId);
    }

    /**
     * Get the authenticated user's own profile (alias).
     */
    public static function getMe(int $userId): ?array
    {
        // Bypass tenant scope: $userId is from auth; user's record lives in
        // their home tenant which may differ from the current TenantContext.
        $user = User::withoutGlobalScope(TenantScope::class)
            ->with(['listings', 'badges'])
            ->find($userId);

        if (! $user) {
            return null;
        }

        $profile = self::formatProfile($user, true);

        // Add notification preferences
        $profile['notification_preferences'] = self::getNotificationPreferences($userId);

        // Add statistics
        $profile['stats'] = self::getUserStats($userId);

        // Add badges
        $profile['badges'] = self::getUserBadges($userId);

        // Add NexusScore summary
        $profile['nexus_score'] = self::getNexusScoreSummary($userId);

        return $profile;
    }

    /**
     * Get a user's public profile with privacy checks.
     * Matches the legacy UserService::getPublicProfile() response shape.
     */
    public static function getPublicProfile(int $userId, ?int $viewerId = null): ?array
    {
        /*
         * 🔴 Reset the error bag, as validate()/update() and friends already do.
         * This method never did, and `$errors` is STATIC: the controller reads
         * `$errors[0]['code']`, so in any process that serves more than one
         * lookup — a queue worker, a test run, Octane — the FIRST refusal recorded
         * stuck to every later one. A member who genuinely did not exist was
         * reported as PROFILE_INCOMPLETE (and, once the privacy branches gained a
         * code, as PROFILE_PRIVATE) purely because an earlier lookup in the same
         * process had been refused that way. Caught by
         * UsersControllerTest::test_show_reports_a_missing_user_as_not_found_not_private.
         */
        self::$errors = [];

        $user = User::query()
            ->with(['listings', 'badges'])
            ->find($userId);

        if (! $user) {
            return null;
        }

        // Check if either user has blocked the other
        if ($viewerId && $viewerId !== $userId) {
            if (BlockUserService::isBlockedEither($viewerId, $userId)) {
                self::setError('FORBIDDEN', 'This profile is not available');
                return null;
            }
        }

        // Check onboarding visibility gating (admin-configurable)
        // If the viewer is looking at someone else's profile, check if the target
        // meets the tenant's visibility requirements (onboarding complete, avatar, bio).
        if ($viewerId !== $userId) {
            if (!OnboardingConfigService::isProfileVisible(null, $userId)) {
                self::setError('PROFILE_INCOMPLETE', 'This member\'s profile is not yet complete');
                return null;
            }
        }

        // Check privacy settings
        $privacyLevel = $user->privacy_profile ?? 'public';

        /*
         * A profile withheld by its owner's privacy setting now says so.
         *
         * 🔴 These two branches returned null with NO error code, so the
         * controller fell through to a bare NOT_FOUND — indistinguishable from a
         * member who does not exist. Every client therefore told the viewer
         * "Page not found" about a real member who had simply chosen to be seen
         * only by their connections. PROFILE_INCOMPLETE right above has always
         * had its own code for exactly this reason; this is the same fix.
         *
         * Deliberately ADDITIVE: still 404, still null, only the code is new. A
         * client that does not know PROFILE_PRIVATE keeps its current behaviour.
         */
        if ($privacyLevel !== 'public' && $viewerId !== $userId) {
            if ($privacyLevel === 'members' && ! $viewerId) {
                self::setError('PROFILE_PRIVATE', 'This profile is not shared publicly');
                return null;
            }
            if ($privacyLevel === 'connections') {
                if (! $viewerId || ! self::areConnected($userId, $viewerId)) {
                    self::setError('PROFILE_PRIVATE', 'This profile is not shared publicly');
                    return null;
                }
            }
        }

        $profile = self::formatProfile($user, false);

        // Hide last name from non-admin viewers — surnames are private by default
        if ($viewerId !== $userId) {
            if (!$viewerId || !self::isViewerAdmin($viewerId)) {
                unset($profile['last_name']);
                if (($user->profile_type ?? 'individual') !== 'organisation') {
                    $profile['name'] = $user->first_name ?? '';
                }
            }
        }

        // Add connection status if viewer is logged in
        if ($viewerId && $viewerId !== $userId) {
            $profile['connection_status'] = self::getConnectionStatus($userId, $viewerId);
        }

        // Add public stats
        $stats = self::getPublicStats($userId);
        $profile['stats'] = $stats;

        // Flatten key stats to root for frontend compatibility
        $profile['total_hours_given'] = $stats['total_hours_given'] ?? 0;
        $profile['total_hours_received'] = $stats['total_hours_received'] ?? 0;
        $profile['groups_count'] = $stats['groups_count'] ?? 0;
        $profile['events_attended'] = $stats['events_attended'] ?? 0;
        $profile['rating'] = $stats['average_rating'] ?? null;

        // Add badges
        $profile['badges'] = self::getUserBadges($userId);

        // Add NexusScore summary
        $profile['nexus_score'] = self::getNexusScoreSummary($userId);

        return $profile;
    }

    /**
     * Update a user profile.
     *
     * Bypass HasTenantScope on the lookup: $id is always the authenticated
     * user's id (from requireAuth()) and the user record lives in their HOME
     * tenant. A super-admin acting on a different tenant has TenantContext set
     * to the viewed tenant, but their own user row only exists in their home
     * tenant — without bypassing the scope, findOrFail throws "No query
     * results for model [User]".
     */
    public static function update(int $id, array $data): User
    {
        /** @var User $user */
        $user = User::withoutGlobalScope(TenantScope::class)->findOrFail($id);

        $allowed = [
            'first_name', 'last_name', 'email', 'bio', 'tagline', 'location', 'latitude', 'longitude',
            'phone', 'avatar_url', 'organization_name', 'profile_type', 'date_of_birth',
        ];

        $user->fill(collect($data)->only($allowed)->all());
        $user->save();

        return $user->fresh();
    }

    /**
     * Search users by name, email, or location.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function search(string $term, int $limit = 20): array
    {
        $limit = min($limit, 100);
        $like = '%' . $term . '%';

        $query = User::query()
            ->select('id', 'first_name', 'last_name', 'avatar_url', 'organization_name',
                     'profile_type', 'bio', 'tagline', 'location', 'created_at', 'is_verified',
                     'xp', 'level', 'status', 'onboarding_completed')
            ->where(function (Builder $q) use ($like) {
                $q->where('first_name', 'LIKE', $like)
                  ->orWhere('last_name', 'LIKE', $like)
                  ->orWhere('organization_name', 'LIKE', $like)
                  ->orWhereRaw("CONCAT(first_name, ' ', last_name) LIKE ?", [$like]);
            })
            ->whereNotIn('status', ['banned', 'suspended', 'deleted'])
            // Soft-deleted accounts (status='inactive' + deleted_at) must
            // never surface as "Deleted User" rows in search
            ->whereNull('deleted_at')
            ->where(function (Builder $q) {
                $q->where('privacy_search', true)
                  ->orWhereNull('privacy_search');
            })
            ->orderByDesc('id')
            ->limit($limit + 1);

        // Apply onboarding visibility gating
        OnboardingConfigService::applyVisibilityScope($query);

        $items = $query->get();

        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->toArray(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get profile stats for sidebar widget.
     * Matches legacy UserService::getProfileStats() response shape.
     */
    public static function getProfileStats(int $userId): array
    {
        $tenantId = TenantContext::getId();

        // Count offers
        $offersCount = DB::table('listings')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('type', 'offer')
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', 'active');
            })
            ->count();

        // Count requests
        $requestsCount = DB::table('listings')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('type', 'request')
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', 'active');
            })
            ->count();

        // Hours given
        $givenTotal = (float) DB::table('transactions')
            ->where('sender_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'completed')
            ->sum('amount');

        // Hours received
        $receivedTotal = (float) DB::table('transactions')
            ->where('receiver_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'completed')
            ->sum('amount');

        // Wallet balance
        $balance = (float) (User::query()->where('id', $userId)->value('balance') ?? 0);

        return [
            'listings_count'  => $offersCount + $requestsCount,
            'given_count'     => round($givenTotal, 1),
            'received_count'  => round($receivedTotal, 1),
            'offers_count'    => $offersCount,
            'requests_count'  => $requestsCount,
            'wallet_balance'  => round($balance, 2),
        ];
    }

    /**
     * Validate profile update data before applying it.
     *
     * @return bool True if valid, false if errors (check getErrors()).
     */
    public static function validateProfileUpdate(array $data): bool
    {
        self::$errors = [];

        // first_name: optional, max 100 chars (mb_strlen for multibyte/emoji support)
        if (isset($data['first_name']) && mb_strlen($data['first_name']) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'First name must not exceed 100 characters', 'field' => 'first_name'];
        }

        // last_name: optional, max 100 chars (mb_strlen for multibyte/emoji support)
        if (isset($data['last_name']) && mb_strlen($data['last_name']) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'Last name must not exceed 100 characters', 'field' => 'last_name'];
        }

        // bio: optional, max 5000 chars (mb_strlen for multibyte/emoji support)
        if (isset($data['bio']) && mb_strlen($data['bio']) > 5000) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'Bio must not exceed 5000 characters', 'field' => 'bio'];
        }

        // profile_type: must be 'individual' or 'organisation'
        if (isset($data['profile_type']) && !in_array($data['profile_type'], ['individual', 'organisation'], true)) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'Profile type must be individual or organisation', 'field' => 'profile_type'];
        }

        // phone: optional, if provided must be valid (7+ digits after stripping non-digits)
        if (isset($data['phone']) && $data['phone'] !== '') {
            $digits = preg_replace('/[^0-9]/', '', $data['phone']);
            if (strlen($digits) < 7) {
                self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'Phone number is invalid', 'field' => 'phone'];
            }
        }

        return empty(self::$errors);
    }

    /**
     * Update a user profile (alias for update()).
     *
     * Validates data first via validateProfileUpdate(), then applies changes.
     * If the email address is changed, sends a security notification to the OLD email.
     *
     * @return bool True on success, false on failure (check getErrors()).
     */
    public static function updateProfile(int $userId, array $data): bool
    {
        // If user has id_verified badge, lock name and DOB fields
        if (isset($data['first_name']) || isset($data['last_name']) || isset($data['date_of_birth'])) {
            $tenantId = \App\Core\TenantContext::getId();
            $hasIdBadge = \Illuminate\Support\Facades\DB::table('member_verification_badges')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where('badge_type', 'id_verified')
                ->whereNull('revoked_at')
                ->exists();

            if ($hasIdBadge) {
                unset($data['first_name'], $data['last_name'], $data['date_of_birth']);
            }
        }

        if (!empty($data) && !self::validateProfileUpdate($data)) {
            return false;
        }

        // Capture old email + preferred language BEFORE the update for security notification
        $oldEmail = null;
        $userLocale = null;
        $userTenantId = null;
        if (isset($data['email']) && $data['email'] !== '') {
            try {
                $currentUser = User::query()->find($userId);
                if ($currentUser) {
                    $oldEmail   = $currentUser->email;
                    $userLocale = $currentUser->preferred_language ?? null;
                    $userTenantId = (int) ($currentUser->tenant_id ?? TenantContext::getId());
                }
            } catch (\Throwable $e) {
                Log::warning('Failed to fetch old email for change notification', ['user_id' => $userId, 'error' => $e->getMessage()]);
            }
        }

        // Snapshot BEFORE so we can diff to the set of actually-changed fields.
        $before = [];
        try {
            $beforeUser = User::query()->find($userId);
            if ($beforeUser) {
                $before = $beforeUser->only(array_keys($data));
            }
        } catch (\Throwable $e) {
            // Diffing is optional — continue without snapshot
            $before = [];
        }

        try {
            $updated = self::update($userId, $data);
        } catch (\Throwable $e) {
            Log::warning('Profile update failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            self::setError('UPDATE_FAILED', $e->getMessage());
            return false;
        }

        // Dispatch MemberProfileUpdated for federation + future listeners.
        try {
            $changedFields = [];
            foreach ($data as $field => $value) {
                if (!array_key_exists($field, $before) || $before[$field] !== $value) {
                    $changedFields[] = (string) $field;
                }
            }
            if (!empty($changedFields) && ($updated ?? null) instanceof User) {
                MemberProfileUpdated::dispatch(
                    $updated,
                    $changedFields,
                    (int) ($updated->tenant_id ?? TenantContext::getId()),
                );
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to dispatch MemberProfileUpdated', [
                'user_id' => $userId,
                'error'   => $e->getMessage(),
            ]);
        }

        // Sync all of this user's active listings whenever their profile location changes.
        if (!empty($changedFields ?? []) && !empty(array_intersect($changedFields ?? [], ['location', 'latitude', 'longitude']))
            && ($updated ?? null) instanceof User) {
            try {
                DB::table('listings')
                    ->where('user_id', $userId)
                    ->where('tenant_id', TenantContext::getId())
                    ->where('status', '!=', 'deleted')
                    ->update([
                        'location'   => $updated->location,
                        'latitude'   => $updated->latitude,
                        'longitude'  => $updated->longitude,
                        'updated_at' => now(),
                    ]);
            } catch (\Throwable $e) {
                Log::warning('Failed to sync listing locations after profile location update', [
                    'user_id' => $userId,
                    'error'   => $e->getMessage(),
                ]);
            }
        }

        // Security notification: bell + email to OLD address when email is changed
        if ($oldEmail && isset($data['email']) && $oldEmail !== $data['email']) {
            $notificationTenantId = (int) ($userTenantId ?? $updated->tenant_id ?? TenantContext::getId());
            TenantContext::runForTenant($notificationTenantId, function () use ($userId, $oldEmail, $updated, $userLocale, $notificationTenantId): void {
                LocaleContext::withLocale($userLocale, function () use ($userId, $oldEmail, $updated, $notificationTenantId) {
                try {
                    Notification::createNotification(
                        $userId,
                        __('svc_notifications.user_security.email_changed'),
                        null,
                        'email_changed',
                        false,
                        $notificationTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $userId, 'email_changed', __('svc_notifications.user_security.email_changed'), null);
                } catch (\Throwable $e) {
                    Log::warning('Failed to create email change notification', ['user_id' => $userId, 'error' => $e->getMessage()]);
                }

                try {
                    $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';

                    $html = EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('emails.security.email_changed_title'))
                        ->previewText(__('emails.security.email_changed_preview'))
                        ->paragraph(__('emails.security.email_changed_body', ['community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8')]))
                        ->highlight(__('emails.security.email_changed_warning'))
                        ->render();

                    $subject = __('emails.security.email_changed_subject', ['community' => $tenantName]);
                    if (!EmailDispatchService::sendRaw($oldEmail, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $notificationTenantId])) {
                        Log::warning('Email change notification send returned false', ['user_id' => $userId]);
                    }
                } catch (\Throwable $e) {
                    Log::warning('Failed to send email change notification to old address', ['user_id' => $userId, 'error' => $e->getMessage()]);
                }
                });
            });
        }

        return true;
    }

    /**
     * Update user password after verifying the current one.
     */
    public static function updatePassword(int $userId, string $currentPassword, string $newPassword): bool
    {
        self::$errors = [];
        $tenantId = (int) TenantContext::getId();
        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->find($userId);

        if (! $user) {
            self::setError('NOT_FOUND', __('api.user_not_found'));
            return false;
        }

        if (! Hash::check($currentPassword, $user->password_hash)) {
            self::setError('INVALID_PASSWORD', __('api.user_invalid_password'));
            return false;
        }

        // 12 matches registration (RegistrationController) and the reset flow
        // (PasswordResetController::MIN_PASSWORD_LENGTH) — change-password must
        // not be a weaker back door.
        if (strlen($newPassword) < 12) {
            self::setError('WEAK_PASSWORD', __('api.password_min_length_generic', ['length' => 12]));
            return false;
        }

        if (PasswordHistoryService::isReused((int) $user->id, (int) $user->tenant_id, $newPassword, $user->password_hash)) {
            self::setError('PASSWORD_REUSED', __('api.password_reused'));
            return false;
        }

        try {
            $passwordOutcome = DB::transaction(function () use (
                $userId,
                $tenantId,
                $currentPassword,
                $newPassword
            ): array {
                // This is the authoritative validation. The fast checks above
                // improve the common error path, but a competing password
                // mutation may have committed since they ran. Serialise on the
                // tenant user row and repeat both credential and history checks.
                $user = User::query()
                    ->where('tenant_id', $tenantId)
                    ->whereKey($userId)
                    ->lockForUpdate()
                    ->first();
                if ($user === null) {
                    return ['status' => 'user_missing'];
                }

                if (!Hash::check($currentPassword, $user->password_hash)) {
                    return ['status' => 'invalid_password'];
                }

                if (PasswordHistoryService::isReused(
                    (int) $user->id,
                    (int) $user->tenant_id,
                    $newPassword,
                    $user->password_hash
                )) {
                    return ['status' => 'password_reused'];
                }

                $previousHash = $user->password_hash;
                $user->password_hash = Hash::make($newPassword);
                if (!$user->save()) {
                    throw new \RuntimeException('Unable to update password.');
                }

                PasswordHistoryService::record(
                    (int) $user->id,
                    (int) $user->tenant_id,
                    $previousHash
                );

                // Any reset link issued before this authenticated password
                // change must stop working. Keep this tenant/email-scoped
                // invalidation in the same user-locked transaction so it
                // cannot commit independently of the password and sessions.
                DB::table('password_resets')
                    ->where('tenant_id', (int) $user->tenant_id)
                    ->where('email', strtolower(trim((string) $user->email)))
                    ->delete();

                // Password changes are a security boundary: the hash update
                // and revocation of JWT, refresh-family, and Sanctum sessions
                // succeed or roll back together.
                if (app(TokenService::class)->revokeAllTokensForUser(
                    (int) $user->id,
                    'password_change'
                ) < 1) {
                    throw new \RuntimeException('Unable to revoke sessions after password change.');
                }

                return ['status' => 'updated', 'user' => $user];
            }, 3);
        } catch (\Throwable $e) {
            Log::error('UserService::updatePassword transaction failed', [
                'user_id' => $user->id,
                'tenant_id' => $user->tenant_id,
                'error' => $e->getMessage(),
            ]);
            self::setError('UPDATE_FAILED', __('api.server_error'));
            return false;
        }

        $status = $passwordOutcome['status'] ?? null;
        if ($status !== 'updated' || !(($passwordOutcome['user'] ?? null) instanceof User)) {
            if ($status === 'user_missing') {
                self::setError('NOT_FOUND', __('api.user_not_found'));
            } elseif ($status === 'invalid_password') {
                self::setError('INVALID_PASSWORD', __('api.user_invalid_password'));
            } elseif ($status === 'password_reused') {
                self::setError('PASSWORD_REUSED', __('api.password_reused'));
            } else {
                self::setError('UPDATE_FAILED', __('api.server_error'));
            }

            return false;
        }

        /** @var User $user */
        $user = $passwordOutcome['user'];

        self::notifyPasswordChanged($user);

        return true;
    }

    private static function notifyPasswordChanged(User $user): void
    {
        $tenantId = (int) ($user->tenant_id ?? TenantContext::getId());
        $recipientLocale = $user->preferred_language ?? null;

        try {
            TenantContext::runForTenant($tenantId, function () use ($user, $recipientLocale): void {
                LocaleContext::withLocale($recipientLocale, function () use ($user): void {
                    Notification::createNotification(
                        (int) $user->id,
                        __('api_controllers_2.password_reset.changed_bell'),
                        null,
                        'password_changed',
                        false,
                        (int) $user->tenant_id
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $user->id, 'password_changed', __('api_controllers_2.password_reset.changed_bell'), null);
                });
            });
        } catch (\Throwable $e) {
            Log::warning('UserService::notifyPasswordChanged bell failed', [
                'user_id' => $user->id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }

        if (empty($user->email)) {
            return;
        }

        try {
            TenantContext::runForTenant($tenantId, function () use ($user, $recipientLocale, $tenantId): void {
                LocaleContext::withLocale($recipientLocale, function () use ($user, $tenantId): void {
                    $tenantName = TenantContext::get()['name'] ?? 'Project NEXUS';

                    $html = EmailTemplateBuilder::make()
                        ->theme('warning')
                        ->title(__('emails.security.password_changed_title'))
                        ->previewText(__('emails.security.password_changed_preview'))
                        ->paragraph(__('emails.security.password_changed_body'))
                        ->highlight(__('emails.security.password_changed_warning'))
                        ->render();

                    $subject = __('emails.security.password_changed_subject', ['community' => $tenantName]);
                    if (!EmailDispatchService::sendRaw($user->email, $subject, $html, null, null, null, 'security_alert', ['tenant_id' => $tenantId])) {
                        Log::warning('UserService::notifyPasswordChanged email returned false', [
                            'user_id' => $user->id,
                            'tenant_id' => $tenantId,
                        ]);
                    }
                });
            });
        } catch (\Throwable $e) {
            Log::warning('UserService::notifyPasswordChanged email failed', [
                'user_id' => $user->id,
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Upload and update user avatar.
     *
     * @param array $fileArray $_FILES-compatible array
     * @return string|null The new avatar URL, or null on failure (check getErrors()).
     */
    public static function updateAvatar(int $userId, array $fileArray): ?string
    {
        try {
            $avatarUrl = \App\Core\ImageUploader::upload($fileArray, 'profiles', [
                'crop'   => true,
                'width'  => 400,
                'height' => 400,
            ]);

            if (! $avatarUrl) {
                self::setError('UPLOAD_FAILED', 'Avatar upload returned empty result');
                return null;
            }

            // Bypass tenant scope: $userId is the authenticated user's id;
            // their user record lives in their home tenant, which may differ
            // from the current TenantContext (super-admin viewing another tenant).
            $user = User::withoutGlobalScope(TenantScope::class)->findOrFail($userId);
            $oldAvatarUrl = $user->avatar_url;
            $user->avatar_url = $avatarUrl;
            $user->save();

            // Best-effort cleanup of the previous avatar so a user who
            // changes their picture frequently doesn't leak orphaned files
            // into storage forever. Only touch files we know we produced
            // (under /uploads/profiles/) — never follow external URLs.
            if ($oldAvatarUrl && $oldAvatarUrl !== $avatarUrl && is_string($oldAvatarUrl)) {
                $path = parse_url($oldAvatarUrl, PHP_URL_PATH) ?: $oldAvatarUrl;
                if (preg_match('#^/uploads/profiles/#', $path)) {
                    $full = public_path(ltrim($path, '/'));
                    if (is_file($full) && !is_link($full)) {
                        @unlink($full);
                    }
                }
            }

            return $avatarUrl;
        } catch (\Throwable $e) {
            Log::warning('Avatar upload failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            self::setError('UPLOAD_FAILED', $e->getMessage());
            return null;
        }
    }

    /**
     * Soft-delete a user account: set status to 'deleted' and anonymize PII.
     */
    public static function deleteAccount(int $userId): bool
    {
        $user = User::query()->find($userId);

        if (! $user) {
            self::setError('NOT_FOUND', 'User not found');
            return false;
        }

        try {
            // users.status is enum('active','inactive','suspended','banned',
            // 'pending') — 'deleted' is not in the set and made every account
            // deletion throw before any anonymization ran. Soft-delete state =
            // status 'inactive' + deleted_at/anonymized_at stamps.
            $user->status        = 'inactive';
            $user->deleted_at    = now();
            $user->anonymized_at = now();
            $user->email      = 'deleted_' . $userId . '@anonymized.invalid';
            $user->first_name = 'Deleted';
            $user->last_name  = 'User';
            $user->bio        = null;
            $user->tagline    = null;
            $user->phone      = null;
            $user->avatar_url = null;
            $user->location   = null;
            $user->latitude   = null;
            $user->longitude  = null;
            $user->save();

            // GDPR Article 17: retract federated profile from all partner networks.
            try {
                $tenantId = (int) ($user->tenant_id ?? \App\Core\TenantContext::getId());
                if ($tenantId) {
                    \App\Events\UserFederatedOptOut::dispatch($userId, $tenantId, 'account_deleted');
                }
            } catch (\Throwable $e) {
                Log::warning('Federation retraction dispatch failed after account deletion', [
                    'user_id' => $userId,
                    'error'   => $e->getMessage(),
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('Account deletion failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            self::setError('DELETE_FAILED', $e->getMessage());
            return false;
        }
    }

    /**
     * Update user privacy settings.
     */
    public static function updatePrivacy(int $userId, array $privacyData): bool
    {
        self::$errors = [];

        $tenantId = TenantContext::getId();
        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->find($userId);

        if (! $user) {
            self::setError('NOT_FOUND', __('api.user_not_found'));
            return false;
        }

        try {
            $allowed = ['privacy_profile', 'privacy_search'];
            $filtered = collect($privacyData)->only($allowed)->all();

            if (empty($filtered)) {
                self::setError('VALIDATION_ERROR', 'No valid privacy fields provided');
                return false;
            }

            // Validate privacy_profile value
            if (isset($filtered['privacy_profile']) && !in_array($filtered['privacy_profile'], ['public', 'members', 'connections'], true)) {
                self::setError('VALIDATION_ERROR', 'Invalid privacy_profile value');
                return false;
            }

            if (array_key_exists('privacy_search', $filtered)) {
                $privacySearch = filter_var(
                    $filtered['privacy_search'],
                    FILTER_VALIDATE_BOOL,
                    FILTER_NULL_ON_FAILURE,
                );
                if ($privacySearch === null) {
                    self::setError(
                        'VALIDATION_ERROR',
                        __('api.user_invalid_notification_preference', ['field' => 'privacy_search']),
                    );
                    return false;
                }
                $filtered['privacy_search'] = $privacySearch;
            }

            $user->fill($filtered);
            $user->save();

            return true;
        } catch (\Throwable $e) {
            Log::warning('Privacy update failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            self::setError('UPDATE_FAILED', $e->getMessage());
            return false;
        }
    }

    /**
     * Update notification preferences for a user.
     */
    public static function updateNotificationPreferences(int $userId, array $prefs): bool
    {
        self::$errors = [];

        $allowed = [
            'email_messages', 'email_listings', 'email_digest',
            'email_connections', 'email_transactions', 'email_reviews',
            'email_gamification_digest', 'email_gamification_milestones',
            'email_org_payments', 'email_org_transfers', 'email_org_membership',
            'email_org_admin', 'push_enabled',
        ];

        $sanitized = [];
        foreach ($allowed as $key) {
            if (! array_key_exists($key, $prefs)) {
                continue;
            }

            $value = filter_var($prefs[$key], FILTER_VALIDATE_BOOL, FILTER_NULL_ON_FAILURE);
            if ($value === null) {
                self::setError(
                    'VALIDATION_ERROR',
                    __('api.user_invalid_notification_preference', ['field' => $key]),
                );
                return false;
            }
            $sanitized[$key] = $value ? 1 : 0;
        }

        if ($sanitized === []) {
            self::setError('VALIDATION_ERROR', __('api.user_no_valid_prefs'));
            return false;
        }

        try {
            $tenantId = TenantContext::getId();
            $belongsToTenant = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->exists();
            if (! $belongsToTenant) {
                self::setError('NOT_FOUND', __('api.user_not_found'));
                return false;
            }

            DB::table('user_notification_preferences')->updateOrInsert(
                ['user_id' => $userId],
                $sanitized,
            );
            return true;
        } catch (\Throwable $e) {
            Log::warning('Notification preferences update failed', ['user_id' => $userId, 'error' => $e->getMessage()]);
            self::setError('UPDATE_FAILED', __('api.user_prefs_update_failed'));
            return false;
        }
    }

    /**
     * Get nearby users using Haversine distance formula.
     *
     * @return array{items: array, has_more: bool}
     */
    public static function getNearby(float $lat, float $lon, array $filters = [], ?int $currentUserId = null): array
    {
        $radiusKm = (float) ($filters['radius_km'] ?? 50);
        $limit    = (int) ($filters['limit'] ?? 20);
        $limit    = min($limit, 100);
        $offset   = max((int) ($filters['offset'] ?? 0), 0);
        $search   = trim((string) ($filters['q'] ?? ''));

        // Haversine formula (result in km) — tenant scoping via HasTenantScope on User model
        $haversine = "(
            6371 * acos(
                cos(radians(?)) * cos(radians(latitude)) *
                cos(radians(longitude) - radians(?)) +
                sin(radians(?)) * sin(radians(latitude))
            )
        )";

        $tenantId = TenantContext::getId();

        $query = User::query()
            ->selectRaw(
                "users.*, $haversine AS distance,
                (SELECT AVG(rating) FROM reviews WHERE receiver_id = users.id AND tenant_id = ?) as rating,
                (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE sender_id = users.id AND status = 'completed' AND tenant_id = ?) as total_hours_given,
                (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE receiver_id = users.id AND status = 'completed' AND tenant_id = ?) as total_hours_received",
                [$lat, $lon, $lat, $tenantId, $tenantId, $tenantId]
            )
            ->whereNotNull('latitude')
            ->whereNotNull('longitude')
            ->where('status', 'active')
            ->where(function ($q) {
                $q->where('privacy_search', 1)->orWhereNull('privacy_search');
            })
            ->havingRaw('distance <= ?', [$radiusKm])
            ->orderBy('distance');

        if ($search !== '') {
            $memberIds = SearchService::searchUsersStatic($search, $tenantId);
            if ($memberIds !== false && !empty($memberIds)) {
                $query->whereIn('id', array_map('intval', $memberIds));
            } elseif ($memberIds !== false) {
                $query->whereRaw('1 = 0');
            } else {
                $like = '%' . $search . '%';
                $query->where(function ($subQuery) use ($search, $like) {
                    $subQuery->whereRaw(
                        "MATCH(first_name, last_name, bio, skills) AGAINST(? IN BOOLEAN MODE)",
                        [$search]
                    )
                    ->orWhere('name', 'LIKE', $like)
                    ->orWhere('location', 'LIKE', $like);
                });
            }
        }

        if ($currentUserId) {
            $query->where('id', '!=', $currentUserId);
        }

        // Apply onboarding visibility gating
        OnboardingConfigService::applyVisibilityScope($query);

        $items = $query->offset($offset)->limit($limit + 1)->get();

        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        // Collect user IDs for batch badge lookup
        $userIds = $items->pluck('id')->all();
        $badgesByUser = [];
        if (!empty($userIds) && TenantContext::hasFeature('gamification')) {
            $placeholders = implode(',', array_fill(0, count($userIds), '?'));
            $badgeRows = DB::select(
                "SELECT user_id, badge_key, name, icon
                 FROM user_badges
                 WHERE user_id IN ($placeholders) AND tenant_id = ? AND is_showcased = 1
                 ORDER BY showcase_order ASC",
                array_merge(array_map('intval', $userIds), [$tenantId])
            );
            foreach ($badgeRows as $row) {
                $uid = (int) $row->user_id;
                if (!isset($badgesByUser[$uid])) {
                    $badgesByUser[$uid] = [];
                }
                if (count($badgesByUser[$uid]) < 3) {
                    $def = \App\Services\GamificationService::getBadgeByKey($row->badge_key);
                    $badgesByUser[$uid][] = [
                        'badge_key' => $row->badge_key,
                        'name'      => $def['name'] ?? $row->name ?? $row->badge_key,
                        'icon'      => $def['icon'] ?? $row->icon ?? '',
                    ];
                }
            }
        }

        $result = $items->map(function (User $user) use ($badgesByUser) {
            return [
                'id'                   => $user->id,
                'name'                 => ($user->profile_type === 'organisation' && $user->organization_name)
                                              ? $user->organization_name
                                              : UserDisplayName::resolve($user),
                'first_name'           => $user->first_name,
                'last_name'            => $user->last_name,
                'avatar'               => $user->avatar_url,
                'tagline'              => $user->getRawOriginal('tagline') ?: ($user->bio ? mb_substr($user->bio, 0, 120) : null),
                'location'             => $user->location,
                'latitude'             => $user->latitude,
                'longitude'            => $user->longitude,
                'created_at'           => $user->created_at?->toISOString(),
                'is_verified'          => (bool) $user->is_verified,
                'xp'                   => (int) ($user->xp ?? 0),
                'level'                => (int) ($user->level ?? 0),
                'rating'               => $user->rating ? (float) $user->rating : null,
                'total_hours_given'    => (int) ($user->total_hours_given ?? 0),
                'total_hours_received' => (int) ($user->total_hours_received ?? 0),
                'showcased_badges'     => $badgesByUser[$user->id] ?? [],
                'distance'             => round((float) $user->distance, 1),
            ];
        })->all();

        return [
            'items'    => $result,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get accumulated errors from the last operation.
     *
     * @return array<int, array{code: string, message: string}>
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Record an error for the current operation.
     */
    protected static function setError(string $code, string $message): void
    {
        self::$errors[] = ['code' => $code, 'message' => $message];
    }

    // ================================================================
    // Private helpers
    // ================================================================

    /**
     * Check whether the given viewer user ID belongs to an admin.
     * Bypasses tenant scope so super-admins from other tenants are recognised.
     */
    private static function isViewerAdmin(int $viewerId): bool
    {
        $viewer = User::withoutGlobalScope(TenantScope::class)
            ->select(['id', 'role', 'is_admin', 'is_super_admin', 'is_tenant_super_admin', 'is_god'])
            ->find($viewerId);
        if (!$viewer) {
            return false;
        }
        return in_array($viewer->role ?? '', ['admin', 'tenant_admin', 'super_admin', 'god'], true)
            || (bool) ($viewer->is_admin ?? false)
            || (bool) ($viewer->is_super_admin ?? false)
            || (bool) ($viewer->is_tenant_super_admin ?? false)
            || (bool) ($viewer->is_god ?? false);
    }

    /**
     * Format user model for API response.
     */
    private static function formatProfile(User $user, bool $includePrivate = false): array
    {
        $profile = [
            'id'                => $user->id,
            'name'              => ($user->profile_type === 'organisation' && $user->organization_name)
                                    ? $user->organization_name
                                    : UserDisplayName::resolve($user),
            'first_name'        => $user->first_name,
            'last_name'         => $user->last_name,
            'avatar_url'        => $user->avatar_url,
            'bio'               => $user->bio,
            'tagline'           => $user->tagline ?? null,
            'location'          => $user->location,
            'latitude'          => $user->latitude,
            'longitude'         => $user->longitude,
            'skills'            => $user->skills ? array_map('trim', explode(',', $user->skills)) : null,
            'profile_type'      => $user->profile_type ?? 'individual',
            'organization_name' => $user->organization_name,
            'created_at'        => $user->created_at?->toISOString(),
            'is_online'         => $user->last_active_at && $user->last_active_at->diffInMinutes(now()) < 5,
            'online_status'     => self::getOnlineStatusText($user->last_active_at),
        ];

        // Gamification fields
        if (isset($user->xp)) {
            $profile['xp'] = (int) $user->xp;
        }
        if (isset($user->level)) {
            $profile['level'] = (int) $user->level;
        }

        // Federated reputation fields (only when federation feature is enabled)
        if (TenantContext::hasFeature('federation')) {
            $fedOpt = \Illuminate\Support\Facades\DB::table('federation_user_settings')
                ->where('user_id', $user->id)
                ->where('federation_optin', 1)
                ->exists();

            if ($fedOpt) {
                $profile['federated_partner_id'] = $user->tenant_id;

                $agg = \Illuminate\Support\Facades\DB::table('reviews')
                    ->where('receiver_id', $user->id)
                    ->where('review_type', 'federated')
                    ->where('show_cross_tenant', 1)
                    ->where(function ($q) {
                        $q->whereNull('status')->orWhereIn('status', ['active', 'approved']);
                    })
                    ->selectRaw('COUNT(*) as cnt, AVG(rating) as avg_rating')
                    ->first();

                $cnt = (int) ($agg->cnt ?? 0);
                $avg = ($agg->avg_rating !== null && $cnt > 0) ? round((float) $agg->avg_rating, 2) : null;
                $profile['federated_reputation_score'] = $avg;
                $profile['federated_reputation_count'] = $cnt;
            } else {
                $profile['federated_partner_id']       = null;
                $profile['federated_reputation_score'] = null;
                $profile['federated_reputation_count'] = 0;
            }
        }

        // Private fields (only for own profile)
        if ($includePrivate) {
            $profile['tenant_id']               = $user->tenant_id;
            $profile['email']                   = $user->email;
            $profile['phone']                   = $user->phone;
            $profile['date_of_birth']           = $user->date_of_birth;
            $profile['status']                  = $user->status ?? 'active';
            $profile['email_verified_at']       = $user->email_verified_at?->toISOString();
            $profile['balance']                 = (float) ($user->balance ?? 0);
            $profile['role']                    = $user->role ?? 'member';
            $profile['is_admin']                = in_array($user->role ?? '', ['admin', 'tenant_admin', 'super_admin'])
                                                    || (bool) $user->is_super_admin
                                                    || (bool) $user->is_tenant_super_admin;
            $profile['is_super_admin']          = (bool) $user->is_super_admin;
            $profile['is_god']                  = (bool) $user->is_god;
            $profile['is_tenant_super_admin']   = (bool) $user->is_tenant_super_admin;
            $profile['is_approved']             = (bool) ($user->is_approved ?? false);
            $profile['privacy_profile']         = $user->privacy_profile ?? 'public';
            $profile['privacy_search']          = (bool) ($user->privacy_search ?? true);
            $profile['onboarding_completed']    = (bool) ($user->onboarding_completed ?? false);
            $profile['preferred_language']       = $user->preferred_language ?? 'en';
            $profile['has_2fa_enabled']          = (bool) ($user->totp_enabled ?? false);
            $profile['preferred_theme']          = $user->preferred_theme ?? 'system';
            $profile['theme_preferences']        = $user->theme_preferences ? json_decode($user->theme_preferences, true) : null;
        }

        return $profile;
    }

    /**
     * Get user stats (own profile).
     */
    private static function getUserStats(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $avgRating = DB::table('reviews')
            ->where('receiver_id', $userId)
            ->where('tenant_id', $tenantId)
            ->avg('rating');

        return [
            'listings_count'     => DB::table('listings')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->where(function ($q) { $q->whereNull('status')->orWhere('status', 'active'); })
                ->count(),
            'transactions_count' => DB::table('transactions')
                ->where('tenant_id', $tenantId)
                ->where(function ($q) use ($userId) {
                    $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
                })
                ->count(),
            'connections_count'  => DB::table('connections')
                ->where('tenant_id', $tenantId)
                ->where('status', 'accepted')
                ->where(function ($q) use ($userId) {
                    $q->where('requester_id', $userId)->orWhere('receiver_id', $userId);
                })
                ->count(),
            'reviews_count'      => DB::table('reviews')
                ->where('receiver_id', $userId)
                ->where('tenant_id', $tenantId)
                ->count(),
            'average_rating'     => $avgRating ? round((float) $avgRating, 1) : null,
        ];
    }

    /**
     * Get public stats (includes hours, groups, events).
     */
    private static function getPublicStats(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $stats = self::getUserStats($userId);
        unset($stats['transactions_count']);

        $hourRows = DB::table('transactions')
            ->selectRaw("
                SUM(CASE WHEN sender_id = ? THEN amount ELSE 0 END) as given,
                SUM(CASE WHEN receiver_id = ? THEN amount ELSE 0 END) as received
            ", [$userId, $userId])
            ->where('tenant_id', $tenantId)
            ->where('status', 'completed')
            ->where(function ($q) use ($userId) {
                $q->where('sender_id', $userId)->orWhere('receiver_id', $userId);
            })
            ->first();

        $stats['total_hours_given']    = round((float) ($hourRows->given    ?? 0), 1);
        $stats['total_hours_received'] = round((float) ($hourRows->received ?? 0), 1);

        // group_members has no tenant_id column — scope through groups.tenant_id
        $stats['groups_count'] = (int) DB::table('group_members')
            ->join('groups', 'group_members.group_id', '=', 'groups.id')
            ->where('group_members.user_id', $userId)
            ->where('group_members.status', 'active')
            ->where('groups.tenant_id', $tenantId)
            ->count();

        $stats['events_attended'] = (int) DB::table('event_rsvps')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('status', 'going')
            ->count();

        return $stats;
    }

    /**
     * Get user badges.
     */
    private static function getUserBadges(int $userId): array
    {
        try {
            $tenantId = TenantContext::getId();

            return DB::table('user_badges')
                ->join('badges', function ($join) {
                    $join->on('user_badges.badge_key', '=', 'badges.badge_key')
                         ->on('user_badges.tenant_id', '=', 'badges.tenant_id');
                })
                ->where('user_badges.user_id', $userId)
                ->where('user_badges.tenant_id', $tenantId)
                ->select('badges.name', 'badges.badge_key', 'badges.icon', 'badges.description', 'user_badges.awarded_at as earned_at')
                ->orderByDesc('user_badges.awarded_at')
                ->get()
                ->map(fn ($row) => (array) $row)
                ->all();
        } catch (\Throwable $e) {
            Log::warning('Failed to load user badges', ['user_id' => $userId, 'error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get notification preferences for a user.
     */
    private static function getNotificationPreferences(int $userId): array
    {
        try {
            // user_notification_preferences has no tenant_id column;
            // tenant isolation is enforced by the caller passing a tenant-scoped userId.
            $row = DB::table('user_notification_preferences')
                ->where('user_id', $userId)
                ->first();

            if (! $row) {
                return [];
            }

            return (array) $row;
        } catch (\Throwable $e) {
            Log::warning('Failed to load notification preferences', ['user_id' => $userId, 'error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Check if two users are connected.
     */
    private static function areConnected(int $userId1, int $userId2): bool
    {
        $tenantId = TenantContext::getId();

        return DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where('status', 'accepted')
            ->where(function ($q) use ($userId1, $userId2) {
                $q->where(function ($q2) use ($userId1, $userId2) {
                    $q2->where('requester_id', $userId1)->where('receiver_id', $userId2);
                })->orWhere(function ($q2) use ($userId1, $userId2) {
                    $q2->where('requester_id', $userId2)->where('receiver_id', $userId1);
                });
            })
            ->exists();
    }

    /**
     * Get connection status between two users.
     */
    private static function getConnectionStatus(int $targetUserId, int $viewerId): ?string
    {
        $tenantId = TenantContext::getId();

        $connection = DB::table('connections')
            ->where('tenant_id', $tenantId)
            ->where(function ($q) use ($targetUserId, $viewerId) {
                $q->where(function ($q2) use ($targetUserId, $viewerId) {
                    $q2->where('requester_id', $viewerId)->where('receiver_id', $targetUserId);
                })->orWhere(function ($q2) use ($targetUserId, $viewerId) {
                    $q2->where('requester_id', $targetUserId)->where('receiver_id', $viewerId);
                });
            })
            ->first();

        if (! $connection) {
            return null;
        }

        return $connection->status;
    }

    /**
     * Get NexusScore summary for a user (cached, returns null if unavailable).
     *
     * @return array{total_score: float, tier: string, percentile: int}|null
     */
    private static function getNexusScoreSummary(int $userId): ?array
    {
        try {
            $tenantId = TenantContext::getId();

            if (! \Illuminate\Support\Facades\Schema::hasTable('nexus_score_cache')) {
                return null;
            }

            $cached = DB::table('nexus_score_cache')
                ->where('user_id', $userId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (! $cached || empty($cached->total_score)) {
                return null;
            }

            // Determine tier from score (matches NexusScoreService::calculateTier thresholds)
            $score = (float) $cached->total_score;
            $tier = match (true) {
                $score >= 900 => 'Legendary',
                $score >= 800 => 'Elite',
                $score >= 700 => 'Expert',
                $score >= 600 => 'Advanced',
                $score >= 500 => 'Proficient',
                $score >= 400 => 'Intermediate',
                $score >= 300 => 'Developing',
                $score >= 200 => 'Beginner',
                default       => 'Novice',
            };

            return [
                'total_score' => round($score, 1),
                'tier'        => $cached->tier ?? $tier,
                'percentile'  => (int) ($cached->percentile ?? 0),
            ];
        } catch (\Throwable $e) {
            Log::warning('Failed to load NexusScore summary', ['user_id' => $userId, 'error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Get online status text.
     */
    private static function getOnlineStatusText($lastActiveAt): string
    {
        if (! $lastActiveAt) {
            return 'offline';
        }

        $minutes = $lastActiveAt->diffInMinutes(now());

        if ($minutes < 5) {
            return 'online';
        }
        if ($minutes < 60) {
            return 'away';
        }

        return 'offline';
    }
}
