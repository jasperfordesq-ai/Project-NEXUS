<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use App\Core\TenantContext;

/**
 * AuthService — Laravel DI-based service for authentication operations.
 *
 * Eloquent/DI counterpart to legacy static authentication logic.
 * Eloquent queries on User are tenant-scoped via HasTenantScope.
 * Raw DB::table() queries on api_tokens are tenant-scoped by joining
 * through the users table to verify tenant ownership.
 */
class AuthService
{
    public function __construct(
        private readonly User $user,
    ) {}

    /**
     * Authenticate a user by email and password.
     *
     * Returns the user + token on success, null on invalid credentials,
     * or a {success: false, error: ...} array when rate-limited.
     *
     * @return array{user: array, token: string}|array{success: false, error: string}|null
     */
    public function login(string $email, string $password, ?string $deviceType = null): ?array
    {
        $key = 'login:' . request()->ip() . ':' . $email;
        if (RateLimiter::tooManyAttempts($key, 5)) {
            $seconds = RateLimiter::availableIn($key);
            return ['success' => false, 'error' => __('api.too_many_login_attempts_seconds', ['seconds' => $seconds])];
        }
        RateLimiter::hit($key, 300); // 5 minute decay

        /** @var User|null $user */
        $user = $this->user->newQuery()
            ->where('email', $email)
            ->where('status', 'active')
            ->where('is_approved', true)
            ->first();

        if (! $user || ! Hash::check($password, $user->password)) {
            return null;
        }

        $token = $this->createApiToken($user->id, $deviceType);

        $user->update(['last_login_at' => now()]);

        return [
            'user'  => $user->only(['id', 'first_name', 'last_name', 'email', 'role', 'avatar_url']),
            'token' => $token,
        ];
    }

    /**
     * Logout by revoking the given token.
     */
    public function logout(string $token): bool
    {
        $tenantId = TenantContext::getId();

        $deleted = DB::table('api_tokens')
            ->join('users', 'api_tokens.user_id', '=', 'users.id')
            ->where('api_tokens.token', hash('sha256', $token))
            ->where('users.tenant_id', $tenantId)
            ->delete() > 0;

        // Clear legacy session bridge to prevent stale authentication
        if (session_status() === PHP_SESSION_ACTIVE) {
            $_SESSION = [];
            session_destroy();
        }

        return $deleted;
    }

    /**
     * Validate an API token and return the associated user.
     */
    public function validateToken(string $token): ?User
    {
        $tenantId = TenantContext::getId();

        $record = DB::table('api_tokens')
            ->join('users', 'api_tokens.user_id', '=', 'users.id')
            ->where('api_tokens.token', hash('sha256', $token))
            ->where('api_tokens.expires_at', '>', now())
            ->where('users.tenant_id', $tenantId)
            ->where('users.status', 'active')
            ->where('users.is_approved', true)
            ->select('api_tokens.*')
            ->first();

        if (! $record) {
            return null;
        }

        // User model query is already tenant-scoped via HasTenantScope
        return $this->user->newQuery()->find($record->user_id);
    }

    /**
     * Create a new API token for a user.
     */
    private function createApiToken(int $userId, ?string $deviceType = null): string
    {
        $token = Str::random(64);
        $expiresAt = $deviceType === 'mobile' ? now()->addDays(90) : now()->addDays(30);

        DB::table('api_tokens')->insert([
            'user_id'     => $userId,
            'token'       => hash('sha256', $token),
            'device_type' => $deviceType,
            'expires_at'  => $expiresAt,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        return $token;
    }
}
