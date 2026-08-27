<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\CreditDonation;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * CreditDonationService
 *
 * Manages credit donations — distinct from exchanges.
 * Members can donate credits to another member or the community fund.
 *
 * All queries are tenant-scoped via TenantContext::getId().
 */
class CreditDonationService
{
    /**
     * Donate credits from one user to another.
     *
     * @param int $tenantId Tenant ID
     * @param int $fromUserId Donor user ID
     * @param int $toUserId Recipient user ID
     * @param float $amount Amount to donate
     * @param string|null $message Optional message
     * @return bool
     */
    public function donate(int $tenantId, int $fromUserId, int $toUserId, float $amount, ?string $message = null): bool
    {
        if ($amount <= 0 || $fromUserId === $toUserId) {
            return false;
        }

        $donor = User::where('tenant_id', $tenantId)->where('id', $fromUserId)->first();
        if (!$donor || (float) ($donor->balance ?? 0) < $amount) {
            return false;
        }

        $recipient = User::where('tenant_id', $tenantId)->where('id', $toUserId)->first();
        if (!$recipient) {
            return false;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $fromUserId,
            $toUserId,
            $tenantId,
            'credit_donation',
        );

        $success = DB::transaction(function () use ($tenantId, $fromUserId, $toUserId, $amount, $message, $recipient) {
            // Atomic deduct
            $affected = DB::table('users')
                ->where('id', $fromUserId)
                ->where('tenant_id', $tenantId)
                ->where('balance', '>=', $amount)
                ->decrement('balance', $amount);

            if ($affected === 0) {
                return false;
            }

            DB::table('users')
                ->where('id', $toUserId)
                ->where('tenant_id', $tenantId)
                ->increment('balance', $amount);

            // Stored receipt line — a persisted string can only be in ONE
            // language, so render it in the RECIPIENT's (they read it in
            // their wallet history; the donor's confirmation is separate).
            // Rendering at call time would bake in the donor's locale.
            $description = LocaleContext::withLocale(
                $recipient,
                fn () => __('svc_notifications_2.credit_donation.transaction_description', [
                    'message' => $message ?: __('svc_notifications_2.credit_donation.no_message'),
                ])
            );

            $transactionId = DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => $fromUserId,
                'receiver_id' => $toUserId,
                'amount' => $amount,
                'description' => $description,
                'transaction_type' => 'donation',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            CreditDonation::create([
                'tenant_id' => $tenantId,
                'donor_id' => $fromUserId,
                'recipient_type' => 'user',
                'recipient_id' => $toUserId,
                'amount' => $amount,
                'message' => $message ?? '',
                'transaction_id' => $transactionId,
            ]);

            return true;
        });

        if ($success) {
            try {
                DonationEmailService::sendDonationEmails($tenantId, $donor, $recipient, $amount, $message);
            } catch (\Throwable $e) {
                Log::warning('CreditDonationService: donation email failed: ' . $e->getMessage());
            }

            // In-app bell to the RECIPIENT — their balance just changed, but the
            // member-to-member donation path was previously email-only / silent.
            // Rendered in the recipient's preferred_language; never breaks the
            // already-committed financial transaction.
            try {
                $donorName = trim(
                    UserDisplayName::resolve($donor)
                        ?: (string) ($donor->name ?? '')
                );

                LocaleContext::withLocale($recipient, function () use ($toUserId, $amount, $donorName, $tenantId) {
                    $message = $donorName !== ''
                        ? __('svc_notifications.credit_donation.received_bell', [
                            'amount' => $amount,
                            'donor'  => $donorName,
                        ])
                        : __('svc_notifications.credit_donation.received_bell_anonymous', [
                            'amount' => $amount,
                        ]);

                    Notification::createNotification(
                        $toUserId,
                        $message,
                        '/wallet',
                        'transaction',
                        false,
                        $tenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) $toUserId, 'transaction', $message, '/wallet');
                });
            } catch (\Throwable $e) {
                Log::warning('CreditDonationService: donation recipient bell failed: ' . $e->getMessage());
            }
        }

        return $success;
    }

    /**
     * Get donation history for a user.
     *
     * @param int $tenantId Tenant ID
     * @param int $userId User ID
     * @param string $direction 'sent' or 'received'
     * @return array
     */
    public function getDonations(int $tenantId, int $userId, string $direction = 'sent'): array
    {
        $query = CreditDonation::with(['donor:id,name,avatar_url', 'recipient:id,name,avatar_url'])
            ->where('tenant_id', $tenantId);

        if ($direction === 'sent') {
            $query->where('donor_id', $userId);
        } else {
            $query->where('recipient_type', 'user')->where('recipient_id', $userId);
        }

        return $query->orderByDesc('created_at')->get()->toArray();
    }

    /**
     * Get total amount donated by a user.
     *
     * @param int $tenantId Tenant ID
     * @param int $userId User ID
     * @return float
     */
    public function getTotalDonated(int $tenantId, int $userId): float
    {
        return (float) CreditDonation::where('tenant_id', $tenantId)
            ->where('donor_id', $userId)
            ->sum('amount');
    }

    /**
     * Donate credits to the community fund.
     *
     * Deducts from user balance and credits the community fund via CommunityFundService.
     *
     * @param int $userId Donor user ID
     * @param float $amount Amount to donate
     * @param string $message Optional message
     * @return array{success: bool, error?: string}
     */
    public function donateToCommunityFund(int $userId, float $amount, string $message = ''): array
    {
        if ($amount <= 0) {
            return ['success' => false, 'error' => __('api.amount_must_be_greater_than_0')];
        }

        // CommunityFundService::receiveDonation handles balance checks, deduction,
        // fund credit, transaction logging, and credit_donations record creation atomically.
        return CommunityFundService::receiveDonation($userId, $amount, $message);
    }

    /**
     * Donate credits to another member.
     *
     * Delegates to the existing donate() method which handles everything atomically.
     *
     * @param int $userId Donor user ID
     * @param int $recipientId Recipient user ID
     * @param float $amount Amount to donate
     * @param string $message Optional message
     * @return array{success: bool, error?: string}
     */
    public function donateToMember(int $userId, int $recipientId, float $amount, string $message = ''): array
    {
        $tenantId = TenantContext::getId();

        $result = $this->donate($tenantId, $userId, $recipientId, $amount, $message);

        if ($result) {
            return ['success' => true];
        }

        return ['success' => false, 'error' => __('api.donation_failed_check_recipient')];
    }

    /**
     * Get paginated donation history for a user (both sent and received).
     *
     * @param int $userId User ID
     * @param int $limit Max records to return
     * @param int $offset Offset for pagination
     * @return array{items: array, total: int}
     */
    public function getDonationHistory(int $userId, int $limit = 20, int $offset = 0): array
    {
        $tenantId = TenantContext::getId();

        $total = (int) DB::table('credit_donations')
            ->where('tenant_id', $tenantId)
            ->where(function ($query) use ($userId) {
                $query->where('donor_id', $userId)
                    ->orWhere(function ($q) use ($userId) {
                        $q->where('recipient_type', 'user')
                          ->where('recipient_id', $userId);
                    });
            })
            ->count();

        $rows = DB::table('credit_donations as cd')
            ->leftJoin('users as donor', function ($join) {
                $join->on('cd.donor_id', '=', 'donor.id')
                    ->whereColumn('cd.tenant_id', '=', 'donor.tenant_id');
            })
            ->leftJoin('users as recipient', function ($join) {
                $join->on('cd.recipient_id', '=', 'recipient.id')
                     ->whereColumn('cd.tenant_id', '=', 'recipient.tenant_id')
                     ->where('cd.recipient_type', '=', 'user');
            })
            ->where('cd.tenant_id', $tenantId)
            ->where(function ($query) use ($userId) {
                $query->where('cd.donor_id', $userId)
                    ->orWhere(function ($q) use ($userId) {
                        $q->where('cd.recipient_type', 'user')
                          ->where('cd.recipient_id', $userId);
                    });
            })
            ->orderByDesc('cd.created_at')
            ->offset($offset)
            ->limit($limit)
            ->select(
                'cd.id',
                'cd.donor_id',
                'cd.recipient_type',
                'cd.recipient_id',
                'cd.amount',
                'cd.message',
                'cd.created_at',
                DB::raw(UserDisplayName::sql('donor', 'donor_name')),
                'donor.avatar_url as donor_avatar',
                DB::raw(UserDisplayName::sql('recipient', 'recipient_name')),
                'recipient.avatar_url as recipient_avatar'
            )
            ->get();

        $items = $rows->map(function ($row) use ($userId) {
            return [
                'id' => (int) $row->id,
                'donor_id' => (int) $row->donor_id,
                'recipient_type' => $row->recipient_type,
                'recipient_id' => $row->recipient_id ? (int) $row->recipient_id : null,
                'amount' => round((float) $row->amount, 2),
                'message' => $row->message ?? '',
                'created_at' => $row->created_at,
                'direction' => $row->donor_id == $userId ? 'sent' : 'received',
                'donor_name' => trim($row->donor_name ?? ''),
                'donor_avatar' => $row->donor_avatar ?? '',
                'recipient_name' => $row->recipient_type === 'community_fund'
                    ? __('svc_notifications_2.credit_donation.community_fund')
                    : trim($row->recipient_name ?? ''),
                'recipient_avatar' => $row->recipient_avatar ?? '',
            ];
        })->all();

        return ['items' => $items, 'total' => $total];
    }
}
