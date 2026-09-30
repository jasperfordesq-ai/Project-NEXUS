<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Identity;

use App\Services\AuditLogService;
use Illuminate\Support\Facades\Log;

/**
 * How an account an administrator creates is admitted (E-062 F-278).
 *
 * Owner decision, 29 Sep 2026: an administrator creating an account (single
 * create, CSV import, assisted onboarding, paper onboarding, super-admin
 * create) IS the approval, so the account is approved immediately. But when
 * the community's joining rules require an identity check
 * (`verified_identity` / `government_id`), the account must still pass that
 * check — unless the administrator explicitly attests that they checked the
 * person's identity themselves. That attestation is recorded (who, when) in
 * the audit log. Every other mode keeps "active immediately".
 *
 * Usage: call decide() before the insert and write its `columns`; call
 * afterCreate() once the row exists.
 */
final class AdminCreatedAccountAdmission
{
    public const SOURCE_ADMIN_CREATE = 'admin_create';
    public const SOURCE_CSV_IMPORT = 'csv_import';
    public const SOURCE_ASSISTED_ONBOARDING = 'assisted_onboarding';
    public const SOURCE_PAPER_ONBOARDING = 'paper_onboarding';
    public const SOURCE_SUPER_ADMIN_CREATE = 'super_admin_create';
    public const SOURCE_VEREIN_IMPORT = 'verein_import';

    /** The request field an administrator sets to attest an identity check. */
    public const ATTESTATION_FIELD = 'identity_checked_by_admin';

    /**
     * Whether the request carries an explicit identity attestation.
     *
     * @param array<string,mixed> $input
     */
    public static function attestationFromInput(array $input): bool
    {
        return filter_var($input[self::ATTESTATION_FIELD] ?? false, FILTER_VALIDATE_BOOLEAN);
    }

    /**
     * @return array{
     *   requires_identity_check: bool,
     *   held: bool,
     *   attested: bool,
     *   registration_mode: string,
     *   columns: array{is_approved:int, status:string}
     * }
     */
    public static function decide(int $tenantId, bool $identityAttested): array
    {
        $mode = (string) (RegistrationPolicyService::getEffectivePolicy($tenantId)['registration_mode'] ?? '');
        $requiresIdentityCheck = in_array($mode, RegistrationPolicyService::IDENTITY_VERIFICATION_MODES, true);
        $held = $requiresIdentityCheck && !$identityAttested;

        return [
            'requires_identity_check' => $requiresIdentityCheck,
            'held' => $held,
            'attested' => $requiresIdentityCheck && $identityAttested,
            'registration_mode' => $mode,
            'columns' => [
                'is_approved' => 1,
                'status' => $held ? 'pending' : 'active',
            ],
        ];
    }

    /**
     * Once the account row exists: start the community's identity check for a
     * held account, or record the administrator's attestation.
     *
     * @param array{requires_identity_check: bool, held: bool, attested: bool, registration_mode: string} $decision
     */
    public static function afterCreate(array $decision, int $tenantId, int $userId, int $adminId, string $source): void
    {
        if ($decision['attested']) {
            $attestedAt = now()->toIso8601String();
            app(AuditLogService::class)->logAction(
                $tenantId,
                AuditLogService::ACTION_ADMIN_IDENTITY_ATTESTED,
                $adminId,
                [
                    'source' => $source,
                    'attested_by' => $adminId,
                    'attested_at' => $attestedAt,
                    'registration_mode' => $decision['registration_mode'],
                ],
                null,
                $userId
            );
            IdentityVerificationEventService::log(
                $tenantId,
                $userId,
                IdentityVerificationEventService::EVENT_ADMIN_APPROVED,
                null,
                $adminId,
                IdentityVerificationEventService::ACTOR_ADMIN,
                ['reason' => 'admin_identity_attestation', 'source' => $source, 'attested_at' => $attestedAt]
            );

            return;
        }

        if (!$decision['held']) {
            return;
        }

        // The same orchestration self-registration, social and SSO sign-up run:
        // it marks the identity check as outstanding (or applies the
        // community's configured fallback). A failure leaves the account
        // pending, never active — it is logged, not swallowed into a success.
        try {
            RegistrationOrchestrationService::processRegistration($userId, $tenantId);
        } catch (\Throwable $e) {
            Log::error('admin_created_account.identity_check_start_failed', [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'source' => $source,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
