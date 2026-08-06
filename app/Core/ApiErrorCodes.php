<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Core;

/**
 * ApiErrorCodes - Standardised error codes for the NEXUS API
 *
 * All API error responses should include a code from this class for machine-readable
 * error handling. Codes are grouped by category:
 *
 * AUTH_*       - Authentication and authorization errors
 * VALIDATION_* - Request validation errors
 * RESOURCE_*   - Resource-related errors (not found, conflict, etc.)
 * RATE_*       - Rate limiting errors
 * UPLOAD_*     - File upload errors
 * SERVER_*     - Internal server errors
 *
 * Usage:
 *   $this->respondWithError(ApiErrorCodes::AUTH_TOKEN_EXPIRED, 'Your session has expired', null, 401);
 *
 * @package App\Core
 */
class ApiErrorCodes
{
    // ============================================
    // AUTHENTICATION ERRORS (401, 403)
    // ============================================

    /** Token has expired and needs refresh */
    public const AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED';

    /** Token signature is invalid or token is malformed */
    public const AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID';

    /** No authentication token/session provided */
    public const AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING';

    /** Access token expired, use refresh token to get new one */
    public const AUTH_REFRESH_REQUIRED = 'AUTH_REFRESH_REQUIRED';

    /** A concurrent request already consumed this refresh token */
    public const AUTH_REFRESH_SUPERSEDED = 'AUTH_REFRESH_SUPERSEDED';

    /** User doesn't have required role/permissions */
    public const AUTH_INSUFFICIENT_PERMISSIONS = 'AUTH_INSUFFICIENT_PERMISSIONS';

    /** User account is suspended */
    public const AUTH_ACCOUNT_SUSPENDED = 'AUTH_ACCOUNT_SUSPENDED';

    /** User account has been deleted */
    public const AUTH_ACCOUNT_DELETED = 'AUTH_ACCOUNT_DELETED';

    /** Invalid credentials (email/password) */
    public const AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS';

    /** CSRF token is missing or invalid */
    public const AUTH_CSRF_INVALID = 'AUTH_CSRF_INVALID';

    /** Invalid tenant ID provided in X-Tenant-ID header */
    public const INVALID_TENANT = 'INVALID_TENANT';

    /** Token tenant_id doesn't match X-Tenant-ID header */
    public const TENANT_MISMATCH = 'TENANT_MISMATCH';

    /** User is a super admin but their tenant lacks Super Panel access (e.g., no sub-tenant capability) */
    public const SUPER_PANEL_ACCESS_DENIED = 'SUPER_PANEL_ACCESS_DENIED';

    /** 2FA code required to complete login */
    public const AUTH_2FA_REQUIRED = 'AUTH_2FA_REQUIRED';

    /** 2FA code is invalid */
    public const AUTH_2FA_INVALID = 'AUTH_2FA_INVALID';

    /** 2FA session has expired */
    public const AUTH_2FA_EXPIRED = 'AUTH_2FA_EXPIRED';

    /** 2FA challenge token not found or expired */
    public const AUTH_2FA_TOKEN_EXPIRED = 'AUTH_2FA_TOKEN_EXPIRED';

    /** 2FA challenge token not recognised */
    public const AUTH_2FA_TOKEN_INVALID = 'AUTH_2FA_TOKEN_INVALID';

    /** Too many failed 2FA attempts, must re-login */
    public const AUTH_2FA_MAX_ATTEMPTS = 'AUTH_2FA_MAX_ATTEMPTS';

    /** Email address has not been verified */
    public const AUTH_EMAIL_NOT_VERIFIED = 'AUTH_EMAIL_NOT_VERIFIED';

    /** Account is pending admin approval */
    public const AUTH_ACCOUNT_PENDING_APPROVAL = 'AUTH_ACCOUNT_PENDING_APPROVAL';

    /** Registration is closed for this community */
    public const REGISTRATION_CLOSED = 'REGISTRATION_CLOSED';

    // ============================================
    // WEBAUTHN ERRORS (400, 401)
    // ============================================

    /** WebAuthn challenge not found or expired */
    public const AUTH_WEBAUTHN_CHALLENGE_EXPIRED = 'AUTH_WEBAUTHN_CHALLENGE_EXPIRED';

    /** WebAuthn challenge verification failed */
    public const AUTH_WEBAUTHN_CHALLENGE_INVALID = 'AUTH_WEBAUTHN_CHALLENGE_INVALID';

    /** WebAuthn credential/passkey not registered */
    public const AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND = 'AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND';

    /** WebAuthn operation failed (generic) */
    public const AUTH_WEBAUTHN_FAILED = 'AUTH_WEBAUTHN_FAILED';

    // ============================================
    // VALIDATION ERRORS (400, 422)
    // ============================================

    /** Required field is missing */
    public const VALIDATION_REQUIRED_FIELD = 'VALIDATION_REQUIRED_FIELD';

    /** Field format is invalid (e.g., email format) */
    public const VALIDATION_INVALID_FORMAT = 'VALIDATION_INVALID_FORMAT';

    /** Field value is not in allowed set */
    public const VALIDATION_INVALID_VALUE = 'VALIDATION_INVALID_VALUE';

    /** Field value already exists (e.g., duplicate email) */
    public const VALIDATION_DUPLICATE = 'VALIDATION_DUPLICATE';

    /** Generic validation error */
    public const VALIDATION_ERROR = 'VALIDATION_ERROR';

    /** Cloudflare Turnstile challenge failed or missing */
    public const TURNSTILE_FAILED = 'TURNSTILE_FAILED';

    /** Value is too short */
    public const VALIDATION_TOO_SHORT = 'VALIDATION_TOO_SHORT';

    /** Value is too long */
    public const VALIDATION_TOO_LONG = 'VALIDATION_TOO_LONG';

    /** Value is out of allowed range */
    public const VALIDATION_OUT_OF_RANGE = 'VALIDATION_OUT_OF_RANGE';

    // ============================================
    // RESOURCE ERRORS (404, 409, 410)
    // ============================================

    /** Requested resource was not found */
    public const RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND';

    /** Resource already exists (conflict) */
    public const RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS';

    /** Resource state conflict (e.g., already completed) */
    public const RESOURCE_CONFLICT = 'RESOURCE_CONFLICT';

    /** Tenant move would remove a user's only usable passkey-based sign-in method */
    public const USER_MOVE_PASSKEY_RECOVERY_REQUIRED = 'USER_MOVE_PASSKEY_RECOVERY_REQUIRED';

    /** Tenant move refused: destination tenant already has an account with this email */
    public const USER_MOVE_EMAIL_CONFLICT = 'USER_MOVE_EMAIL_CONFLICT';

    /** Tenant move refused: destination tenant already has an account with this username */
    public const USER_MOVE_USERNAME_CONFLICT = 'USER_MOVE_USERNAME_CONFLICT';

    /** Tenant move refused: DB records (composite FK to users(id, tenant_id)) pin the user to their tenant */
    public const USER_MOVE_HISTORY_LOCKED = 'USER_MOVE_HISTORY_LOCKED';

    /** Resource has been deleted */
    public const RESOURCE_DELETED = 'RESOURCE_DELETED';

    /** User doesn't have access to this resource */
    public const RESOURCE_FORBIDDEN = 'RESOURCE_FORBIDDEN';

    // ============================================
    // RATE LIMITING ERRORS (429)
    // ============================================

    /** Too many requests - rate limit exceeded */
    public const RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED';

    // ============================================
    // UPLOAD ERRORS (400, 413)
    // ============================================

    /** File size exceeds maximum allowed */
    public const UPLOAD_TOO_LARGE = 'UPLOAD_TOO_LARGE';

    /** File type is not allowed */
    public const UPLOAD_INVALID_TYPE = 'UPLOAD_INVALID_TYPE';

    /** File upload failed for unknown reason */
    public const UPLOAD_FAILED = 'UPLOAD_FAILED';

    /** No file was provided in the request */
    public const UPLOAD_NO_FILE = 'UPLOAD_NO_FILE';

    // ============================================
    // SERVER ERRORS (500, 503)
    // ============================================

    /** Internal server error */
    public const SERVER_INTERNAL_ERROR = 'SERVER_INTERNAL_ERROR';

    /** Server is in maintenance mode */
    public const SERVER_MAINTENANCE = 'SERVER_MAINTENANCE';

    /** A dependent service (database, cache, etc.) failed */
    public const SERVER_DEPENDENCY_FAILED = 'SERVER_DEPENDENCY_FAILED';

    // ============================================
    // LEGACY COMPATIBILITY
    // ============================================
    // These map to codes used in existing API responses for backwards compatibility

    /** Generic forbidden (used by requireAdmin, etc.) */
    public const FORBIDDEN = 'FORBIDDEN';

    /** Generic rate limited (legacy) */
    public const RATE_LIMITED = 'RATE_LIMITED';

    // ============================================
    // HELPER METHODS
    // ============================================

    /**
     * Get the recommended HTTP status code for an error code
     *
     * @param string $code The error code
     * @return int HTTP status code
     */
    public static function getHttpStatus(string $code): int
    {
        return match ($code) {
            // 400 Bad Request
            self::VALIDATION_REQUIRED_FIELD,
            self::VALIDATION_INVALID_FORMAT,
            self::VALIDATION_INVALID_VALUE,
            self::VALIDATION_ERROR,
            self::VALIDATION_TOO_SHORT,
            self::VALIDATION_TOO_LONG,
            self::VALIDATION_OUT_OF_RANGE,
            self::UPLOAD_NO_FILE,
            self::INVALID_TENANT => 400,

            // 401 Unauthorized
            self::AUTH_TOKEN_EXPIRED,
            self::AUTH_TOKEN_INVALID,
            self::AUTH_TOKEN_MISSING,
            self::AUTH_REFRESH_REQUIRED,
            self::AUTH_INVALID_CREDENTIALS,
            self::AUTH_2FA_REQUIRED,
            self::AUTH_2FA_INVALID,
            self::AUTH_2FA_EXPIRED,
            self::AUTH_2FA_TOKEN_EXPIRED,
            self::AUTH_2FA_TOKEN_INVALID,
            self::AUTH_2FA_MAX_ATTEMPTS,
            self::AUTH_WEBAUTHN_CHALLENGE_EXPIRED,
            self::AUTH_WEBAUTHN_CHALLENGE_INVALID,
            self::AUTH_WEBAUTHN_CREDENTIAL_NOT_FOUND,
            self::AUTH_WEBAUTHN_FAILED => 401,

            // 403 Forbidden
            self::AUTH_INSUFFICIENT_PERMISSIONS,
            self::AUTH_ACCOUNT_SUSPENDED,
            self::AUTH_ACCOUNT_DELETED,
            self::AUTH_CSRF_INVALID,
            self::RESOURCE_FORBIDDEN,
            self::FORBIDDEN,
            self::TENANT_MISMATCH,
            self::REGISTRATION_CLOSED,
            self::SUPER_PANEL_ACCESS_DENIED => 403,

            // 404 Not Found
            self::RESOURCE_NOT_FOUND => 404,

            // 409 Conflict
            self::VALIDATION_DUPLICATE,
            self::AUTH_REFRESH_SUPERSEDED,
            self::RESOURCE_ALREADY_EXISTS,
            self::RESOURCE_CONFLICT,
            self::USER_MOVE_PASSKEY_RECOVERY_REQUIRED,
            self::USER_MOVE_EMAIL_CONFLICT,
            self::USER_MOVE_USERNAME_CONFLICT,
            self::USER_MOVE_HISTORY_LOCKED => 409,

            // 410 Gone
            self::RESOURCE_DELETED => 410,

            // 413 Payload Too Large
            self::UPLOAD_TOO_LARGE => 413,

            // 422 Unprocessable Entity
            self::TURNSTILE_FAILED => 422,

            // 429 Too Many Requests
            self::RATE_LIMIT_EXCEEDED,
            self::RATE_LIMITED => 429,

            // 500 Internal Server Error
            self::SERVER_INTERNAL_ERROR,
            self::UPLOAD_FAILED => 500,

            // 503 Service Unavailable
            self::SERVER_MAINTENANCE,
            self::SERVER_DEPENDENCY_FAILED => 503,

            // Default
            default => 400,
        };
    }

    /**
     * Check if an error code is an authentication error
     *
     * @param string $code The error code
     * @return bool
     */
    public static function isAuthError(string $code): bool
    {
        return str_starts_with($code, 'AUTH_');
    }

    /**
     * Check if an error code is a validation error
     *
     * @param string $code The error code
     * @return bool
     */
    public static function isValidationError(string $code): bool
    {
        return str_starts_with($code, 'VALIDATION_');
    }

    /**
     * Check if an error code indicates the client should retry
     *
     * @param string $code The error code
     * @return bool
     */
    public static function isRetryable(string $code): bool
    {
        return in_array($code, [
            self::RATE_LIMIT_EXCEEDED,
            self::RATE_LIMITED,
            self::SERVER_MAINTENANCE,
            self::SERVER_DEPENDENCY_FAILED,
            self::AUTH_TOKEN_EXPIRED,
            self::AUTH_REFRESH_REQUIRED,
        ]);
    }
}
