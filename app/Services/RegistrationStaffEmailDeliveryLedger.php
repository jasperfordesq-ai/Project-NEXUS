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
     * @return array{id:int, token:string, dispatch_id:string}|null
     */
    public static function claimCapturedForInline(int $tenantId, int $registrantId, int $recipientId): ?array
    {
        if ($tenantId <= 0 || $registrantId <= 0 || $recipientId <= 0) {
            throw new \InvalidArgumentException('A valid tenant-scoped registration delivery is required');
        }

        $token = (string) Str::uuid();
        $dispatchId = (string) Str::uuid();
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
                'dispatch_id' => $dispatchId,
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
        return ['id' => $id, 'token' => $token, 'dispatch_id' => $dispatchId];
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

    /** Hold crashed or timed-out claims for reconciliation, never for retry. */
    public static function holdStaleClaimsUnknown(?int $tenantId = null, int $limit = 100): int
    {
        if (($tenantId !== null && $tenantId <= 0) || $limit < 1 || $limit > 1000) {
            throw new \InvalidArgumentException('Invalid stale-claim scope or limit');
        }
        $cutoff = now()->subMinutes(20);
        $query = DB::table(self::TABLE)
            ->where('status', 'claimed')
            ->where('claimed_at', '<=', $cutoff);
        if ($tenantId !== null) {
            $query->where('tenant_id', $tenantId);
        }
        $ids = $query->orderBy('claimed_at')->limit($limit)->pluck('id')->all();
        if ($ids === []) {
            return 0;
        }
        return DB::table(self::TABLE)
            ->whereIn('id', $ids)
            ->where('status', 'claimed')
            ->where('claimed_at', '<=', $cutoff)
            ->update([
                'status' => 'unknown',
                'last_error_code' => 'CLAIM_EXPIRED_UNCONFIRMED',
                'resolved_at' => now(),
                'updated_at' => now(),
            ]);
    }

    /**
     * Resolve UNKNOWN only from one exact positive local transport receipt.
     * Absence, failure, or multiple log rows cannot establish non-acceptance
     * and remain for provider/operator review.
     */
    public static function reconcileConfirmedMailLog(?int $tenantId = null, int $limit = 100): int
    {
        if (($tenantId !== null && $tenantId <= 0) || $limit < 1 || $limit > 1000) {
            throw new \InvalidArgumentException('Invalid mail-log reconciliation scope or limit');
        }
        $keySql = "CONCAT('admin_new_registration:', d.tenant_id, ':', d.registrant_user_id, ':', d.recipient_user_id)";
        $candidates = DB::table(self::TABLE . ' as d')
            ->where('d.status', 'unknown')
            ->whereNotNull('d.dispatch_id')
            ->whereExists(function ($query) use ($keySql): void {
                $query->selectRaw('1')->from('email_log as e')
                    ->whereColumn('e.tenant_id', 'd.tenant_id')
                    ->whereColumn('e.dispatch_id', 'd.dispatch_id')
                    ->where('e.category', 'admin_new_registration')
                    ->whereRaw('e.idempotency_key = ' . $keySql)
                    ->whereIn('e.status', ['sent', 'delivered']);
            })
            ->whereRaw("(SELECT COUNT(*) FROM email_log e2 WHERE e2.tenant_id = d.tenant_id AND e2.dispatch_id = d.dispatch_id AND e2.category = 'admin_new_registration' AND e2.idempotency_key = {$keySql}) = 1");
        if ($tenantId !== null) {
            $candidates->where('d.tenant_id', $tenantId);
        }
        $ids = $candidates->orderBy('d.id')->limit($limit)->pluck('d.id')->all();
        $resolved = 0;
        foreach ($ids as $id) {
            $resolved += DB::transaction(static function () use ($id): int {
                $delivery = DB::table(self::TABLE)
                    ->where('id', $id)->where('status', 'unknown')
                    ->lockForUpdate()->first();
                if ($delivery === null || $delivery->dispatch_id === null) {
                    return 0;
                }
                $key = 'admin_new_registration:' . $delivery->tenant_id . ':'
                    . $delivery->registrant_user_id . ':' . $delivery->recipient_user_id;
                $logs = DB::table('email_log')
                    ->where('tenant_id', $delivery->tenant_id)
                    ->where('dispatch_id', $delivery->dispatch_id)
                    ->where('category', 'admin_new_registration')
                    ->where('idempotency_key', $key)
                    ->lockForUpdate()->limit(2)
                    ->get(['id', 'status', 'provider_message_id']);
                if ($logs->count() !== 1 || !in_array($logs[0]->status, ['sent', 'delivered'], true)) {
                    return 0;
                }
                return DB::table(self::TABLE)
                    ->where('id', $delivery->id)
                    ->where('tenant_id', $delivery->tenant_id)
                    ->where('status', 'unknown')
                    ->where('dispatch_id', $delivery->dispatch_id)
                    ->update([
                        'status' => 'accepted',
                        'provider_message_id' => $logs[0]->provider_message_id,
                        'last_error_code' => null,
                        'reconciled_from_email_log_id' => $logs[0]->id,
                        'reconciled_at' => now(),
                        'updated_at' => now(),
                    ]);
            });
        }
        return $resolved;
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
