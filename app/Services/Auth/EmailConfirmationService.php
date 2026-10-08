<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

use App\Services\TenantSettingsService;
use Illuminate\Support\Facades\DB;

/**
 * The one rule for recording that a member's email address is confirmed.
 *
 * Confirming an email is not just a timestamp: on a self-serve community it
 * also approves and activates the account, and on a community that screens
 * new members it activates only an already-approved one. Every path that
 * confirms an email must apply that same rule, or a member can end up
 * "confirmed" but stuck pending — and the verification link would then
 * short-circuit as "already verified" and never release them.
 *
 * Paths that confirm an email:
 *  - the member clicks the verification link (EmailVerificationController);
 *  - the member completes a password reset — reset links are only ever
 *    delivered by email, so using one proves the inbox is theirs;
 *  - an administrator vouches for the address: the "mark confirmed" action
 *    on an existing account uses confirm(); creating an account with an
 *    administrator-set password, or by CSV import, uses recordAdminVouched()
 *    (see there for why). Owner decision, 8 Oct 2026.
 *
 * An identity-check hold (E-035 F-152, E-062 F-278) is never released here.
 * 🔴 F-572: an administrator-created account held for its identity check is
 * stored approved (`is_approved = 1`) and `pending`, which is exactly the
 * shape the screening branch below activates — so before this guard, a held
 * member who asked the public resend form for a verification link went
 * `active` (visible to member search, digests and every other "live member"
 * query) while the check was still outstanding. Activation therefore also
 * requires that no identity check is unfinished or refused; passing the
 * check releases the account through RegistrationOrchestrationService.
 */
final class EmailConfirmationService
{
    public function __construct(
        private readonly TenantSettingsService $tenantSettings,
    ) {}

    /**
     * Record the member's email as confirmed. A no-op for an address that is
     * already confirmed, so the approval side effects never run twice.
     *
     * @return bool true when this call confirmed the address
     */
    public function confirm(int $userId, int $tenantId): bool
    {
        if (
            $this->tenantSettings->requiresAdminApproval($tenantId)
            || $this->tenantSettings->registrationActivationHold($tenantId) !== null
        ) {
            $affected = DB::update(
                "UPDATE users SET email_verified_at = NOW(), is_verified = 1,
                    status = CASE
                        WHEN status = 'pending' AND is_approved = 1
                             AND COALESCE(verification_status, 'none') NOT IN ('pending', 'failed', 'expired')
                        THEN 'active' ELSE status END
                 WHERE id = ? AND tenant_id = ? AND email_verified_at IS NULL",
                [$userId, $tenantId]
            );
        } else {
            $affected = DB::update(
                "UPDATE users SET email_verified_at = NOW(), is_verified = 1, is_approved = 1,
                    status = CASE WHEN status = 'pending' THEN 'active' ELSE status END
                 WHERE id = ? AND tenant_id = ? AND email_verified_at IS NULL",
                [$userId, $tenantId]
            );
        }

        return $affected > 0;
    }

    /**
     * Record the email of an account an administrator has just created as
     * confirmed, WITHOUT the activation rule above.
     *
     * A new administrator-created account's approval and status were already
     * decided by AdminCreatedAccountAdmission (F-278), and its identity check
     * releases it later. Applying confirm() here would let a held account
     * whose identity-check start failed (verification_status still 'none')
     * go live, which F-278 forbids. Activation that waits on the email —
     * approveAndRelease() after a passed check — still sees the confirmation.
     */
    public function recordAdminVouched(int $userId, int $tenantId): void
    {
        DB::update(
            "UPDATE users SET email_verified_at = COALESCE(email_verified_at, NOW()), is_verified = 1
             WHERE id = ? AND tenant_id = ?",
            [$userId, $tenantId]
        );
    }
}
