<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

use App\Core\TenantContext;
use App\Events\UserRegistered;
use App\Listeners\NotifyAdminOfNewRegistration;
use App\Models\User;
use App\Services\RegistrationStaffEmailDeliveryLedger;
use App\Services\StartingBalanceService;
use Illuminate\Support\Facades\Log;

/**
 * What a new account made by a provider sign-up (Google, Facebook, SSO) gets,
 * the same as a sign-up through the form (E-121, 6 Nov 2026).
 *
 * The form (RegistrationService) fires UserRegistered — the member's welcome
 * email and every staff member's "new member" email and alert — and grants the
 * starting balance once the account is active. Provider sign-ups did neither:
 * staff got only the registration policy step's in-app alert, nobody got an
 * email, and an open community's new member got no starting balance.
 *
 * Two halves, because one must happen inside the account's transaction and the
 * other only after it commits:
 *  - captureStaffAlertIntent(): inside, so a process lost after commit can be
 *    recovered by RecoverCapturedRegistrationStaffAlerts, exactly as the form does.
 *  - afterAccountCreated(): after, so no email ever goes out about an account a
 *    rollback or a deadlock retry then removes.
 *
 * Callers pass `staffAlertedByCaller: true` to
 * RegistrationOrchestrationService::processRegistration(), so staff hear once.
 */
final class ProviderSignUpFollowThrough
{
    /** Inside the account-creation transaction. */
    public static function captureStaffAlertIntent(int $tenantId, int $userId): void
    {
        foreach (NotifyAdminOfNewRegistration::recipientsFor($tenantId) as $staff) {
            if (!empty($staff->email)) {
                RegistrationStaffEmailDeliveryLedger::captureInTransaction($tenantId, $userId, (int) $staff->id);
            }
        }
    }

    /**
     * After the account-creation transaction has committed. Never throws: a
     * failure here must not undo a valid account, so it is logged instead.
     */
    public static function afterAccountCreated(int $userId, int $tenantId): void
    {
        TenantContext::runForTenant($tenantId, static function () use ($userId, $tenantId): void {
            $user = User::query()->whereKey($userId)->where('tenant_id', $tenantId)->first();
            if ($user === null) {
                Log::error('Provider sign-up follow-through: new account not found', [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                ]);

                return;
            }

            // Settled by now: the policy step ran inside the committed transaction.
            $awaitingApproval = $user->status === 'pending' || empty($user->is_approved);

            try {
                event(new UserRegistered($user, $tenantId, null, $awaitingApproval));
            } catch (\Throwable $e) {
                Log::warning('Provider sign-up: UserRegistered dispatch failed', [
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                    'error' => $e->getMessage(),
                ]);
            }

            // A community that approves new members grants the starting balance
            // when a member is approved (AdminUsersController::grantWelcomeCredits);
            // granting here too would double-credit. Idempotent either way.
            if (!$awaitingApproval && $user->status === 'active') {
                try {
                    StartingBalanceService::applyToNewUser($userId);
                } catch (\Throwable $e) {
                    Log::warning('Provider sign-up: starting balance grant failed', [
                        'user_id' => $userId,
                        'tenant_id' => $tenantId,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        });
    }
}
