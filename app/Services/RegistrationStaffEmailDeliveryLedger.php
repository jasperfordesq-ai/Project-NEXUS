<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Durable per-recipient claim state for registration staff email.
 * Captured intent is claimed before the inline sender calls a provider.
 * A false/ambiguous send result stays UNKNOWN until reconciliation.
 */
final class RegistrationStaffEmailDeliveryLedger
{
    private const TABLE = 'registration_staff_email_deliveries';

    public static function captureInTransaction(int $tenantId, int $registrantId, int $recipientId): int
    {
        if ($tenantId <= 0 || $registrantId <= 0 || $recipientId <= 0 || DB::transactionLevel() < 1) {
            throw new \InvalidArgumentException('A valid in-transaction registration delivery identity is required');
        }

        // The caller chooses eligible staff; this boundary still rejects a
        // cross-tenant identity before a pending email record can be created.
        foreach ([$registrantId, $recipientId] as $userId) {
            if (!DB::table('users')->where('id', $userId)->where('tenant_id', $tenantId)->exists()) {
                throw new \InvalidArgumentException('Registration delivery identity crosses a tenant boundary');
            }
        }

        DB::table(self::TABLE)->insertOrIgnore([
            'tenant_id' => $tenantId,
            'registrant_user_id' => $registrantId,
            'recipient_user_id' => $recipientId,
            // Legacy inline mail still runs. Capture intent for crash recovery
            // without making this row claimable by a later worker on rollout.
            'status' => 'captured',
            'attempts' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $id = (int) DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->where('recipient_user_id', $recipientId)
            ->value('id');
        if ($id <= 0) {
            throw new \RuntimeException('Registration email delivery was not persisted');
        }
        return $id;
    }

    /** A claimed row is never automatically reclaimed after a crash. */
    public static function claimPending(int $tenantId, int $deliveryId): ?string
    {
        if ($tenantId <= 0 || $deliveryId <= 0) {
            throw new \InvalidArgumentException('A valid tenant-scoped registration delivery is required');
        }
        $token = (string) Str::uuid();
        $claimed = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $deliveryId)
            ->where('status', 'pending')
            ->update([
                'status' => 'claimed',
                'claim_token' => $token,
                'claimed_at' => now(),
                'attempts' => DB::raw('attempts + 1'),
                'updated_at' => now(),
            ]);
        return $claimed === 1 ? $token : null;
    }

    /**
     * Atomically reserve a captured inline-send intent. A crash after this
     * transition cannot cause an automatic second provider call on replay.
     *
     * @return array{id:int, token:string}|null
     */
    public static function claimCapturedForInline(int $tenantId, int $registrantId, int $recipientId): ?array
    {
        if ($tenantId <= 0 || $registrantId <= 0 || $recipientId <= 0) {
            throw new \InvalidArgumentException('A valid tenant-scoped registration delivery is required');
        }

        $token = (string) Str::uuid();
        $claimed = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->where('recipient_user_id', $recipientId)
            ->where('status', 'captured')
            ->whereExists(function ($query) use ($tenantId, $recipientId): void {
                $query->selectRaw('1')->from('users')
                    ->where('users.id', $recipientId)
                    ->where('users.tenant_id', $tenantId)
                    ->where('users.status', 'active')
                    ->whereNotNull('users.email')
                    ->where('users.email', '<>', '')
                    ->where(function ($staff) {
                        $staff->whereIn('users.role', ['super_admin', 'admin', 'tenant_admin', 'broker', 'coordinator'])
                            ->orWhere('users.is_admin', 1)
                            ->orWhere('users.is_super_admin', 1)
                            ->orWhere('users.is_tenant_super_admin', 1)
                            ->orWhere('users.is_god', 1);
                    });
            })
            ->update([
                'status' => 'claimed',
                'claim_token' => $token,
                'claimed_at' => now(),
                'attempts' => DB::raw('attempts + 1'),
                'updated_at' => now(),
            ]);
        if ($claimed !== 1) {
            return null;
        }

        $id = (int) DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->where('recipient_user_id', $recipientId)
            ->where('claim_token', $token)
            ->value('id');
        if ($id <= 0) {
            throw new \RuntimeException('Claimed registration delivery was not found');
        }
        return ['id' => $id, 'token' => $token];
    }

    public static function hasIntentForRegistrant(int $tenantId, int $registrantId): bool
    {
        if ($tenantId <= 0 || $registrantId <= 0) {
            return false;
        }
        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->exists();
    }

    /** Cancel never-attempted rows when the recipient has lost staff access. */
    public static function cancelCapturedOutsideRecipients(int $tenantId, int $registrantId, array $eligibleRecipientIds): int
    {
        if ($tenantId <= 0 || $registrantId <= 0) {
            throw new \InvalidArgumentException('A valid tenant-scoped registration is required');
        }
        $query = DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->where('status', 'captured');
        if ($eligibleRecipientIds !== []) {
            $query->whereNotIn('recipient_user_id', array_map('intval', $eligibleRecipientIds));
        }
        return $query->update([
            'status' => 'cancelled',
            'last_error_code' => 'RECIPIENT_NO_LONGER_ELIGIBLE',
            'resolved_at' => now(),
            'updated_at' => now(),
        ]);
    }

    public static function cancelCapturedForRegistrant(int $tenantId, int $registrantId): int
    {
        if ($tenantId <= 0 || $registrantId <= 0) {
            throw new \InvalidArgumentException('A valid tenant-scoped registration is required');
        }
        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('registrant_user_id', $registrantId)
            ->where('status', 'captured')
            ->update([
                'status' => 'cancelled',
                'last_error_code' => 'REGISTRANT_UNAVAILABLE',
                'resolved_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * ACCEPTED means the provider confirmed acceptance, not delivery/read.
     * UNKNOWN is retained for possible acceptance after timeout or crash.
     */
    public static function resolveClaim(
        int $tenantId,
        int $deliveryId,
        string $token,
        string $outcome,
        ?string $providerMessageId = null,
        ?string $errorCode = null,
    ): bool {
        if ($tenantId <= 0 || $deliveryId <= 0
            || !in_array($outcome, ['accepted', 'definite_failure', 'unknown'], true)
            || $token === ''
            || ($outcome !== 'accepted' && $providerMessageId !== null)
            || ($outcome === 'accepted' && $errorCode !== null)
            || ($errorCode !== null && !preg_match('/^[A-Z][A-Z0-9_]{0,63}$/D', $errorCode))) {
            throw new \InvalidArgumentException('Invalid registration email delivery outcome');
        }

        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('id', $deliveryId)
            ->where('status', 'claimed')
            ->where('claim_token', $token)
            ->update([
                'status' => $outcome,
                'provider_message_id' => $providerMessageId,
                'last_error_code' => $errorCode,
                'resolved_at' => now(),
                'updated_at' => now(),
            ]) === 1;
    }
}
