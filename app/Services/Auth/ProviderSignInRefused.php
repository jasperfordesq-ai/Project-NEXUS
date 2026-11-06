<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

use App\Core\ApiErrorCodes;
use App\Support\Authorization\MinimumAge;

/**
 * Why a sign-in through a provider (Google, Facebook, SSO) did not complete
 * (E-121, 6 Nov 2026).
 *
 * Every refusal used to become one generic "Sign-in failed", so a member who
 * had just signed up in a community that approves new members was told their
 * sign-in failed while their account sat waiting. The reason now travels to the
 * website as one of the fixed codes below, through the exchange step that only
 * the browser which started the sign-in can complete — never as free text in
 * an address (F-196). The website supplies all the wording.
 *
 * Extends RuntimeException so existing callers that catch or expect one keep
 * working; the message stays the technical one those callers relied on.
 */
final class ProviderSignInRefused extends \RuntimeException
{
    public const PENDING_APPROVAL = 'pending_approval';
    public const IDENTITY_CHECK_PENDING = 'identity_check_pending';
    public const IDENTITY_CHECK_FAILED = 'identity_check_failed';
    public const EMAIL_UNVERIFIED = 'email_unverified';
    public const SUSPENDED = 'suspended';
    public const UNDER_18 = 'under_18';
    /** A sign-in (not a sign-up) with a provider account no member here has. */
    public const NO_ACCOUNT = 'no_account';
    /** The community is closed to sign-ups, or invitation-only. */
    public const REGISTRATION_CLOSED = 'registration_closed';

    public const REASONS = [
        self::PENDING_APPROVAL,
        self::IDENTITY_CHECK_PENDING,
        self::IDENTITY_CHECK_FAILED,
        self::EMAIL_UNVERIFIED,
        self::SUSPENDED,
        self::UNDER_18,
        self::NO_ACCOUNT,
        self::REGISTRATION_CLOSED,
    ];

    public function __construct(
        public readonly string $reason,
        string $message = '',
        public readonly bool $isNewAccount = false,
    ) {
        if (!in_array($reason, self::REASONS, true)) {
            throw new \InvalidArgumentException('Unknown provider sign-in refusal reason.');
        }
        parent::__construct($message !== '' ? $message : 'Provider sign-in refused: ' . $reason);
    }

    /**
     * The refusal for a login-gate result (TenantSettingsService::
     * checkLoginGatesForUser), or null for a code with no member-facing reason.
     *
     * @param array<string,mixed> $gate
     */
    public static function fromGate(array $gate, bool $isNewAccount = false): ?self
    {
        $reason = match ((string) ($gate['code'] ?? '')) {
            ApiErrorCodes::AUTH_ACCOUNT_PENDING_APPROVAL => self::PENDING_APPROVAL,
            'AUTH_PENDING_VERIFICATION' => self::IDENTITY_CHECK_PENDING,
            'AUTH_VERIFICATION_FAILED' => self::IDENTITY_CHECK_FAILED,
            'AUTH_EMAIL_NOT_VERIFIED' => self::EMAIL_UNVERIFIED,
            ApiErrorCodes::AUTH_ACCOUNT_SUSPENDED => self::SUSPENDED,
            MinimumAge::accountRefusal()['code'] => self::UNDER_18,
            default => null,
        };

        return $reason === null ? null : new self($reason, '', $isNewAccount);
    }
}
