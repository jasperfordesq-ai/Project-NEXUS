<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Core\TenantContext;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use InvalidArgumentException;
use RuntimeException;

/**
 * CaringHourGiftService — gift banked hours to another tenant member.
 *
 * KISS-canonical pattern: a member who has accumulated banked hours can
 * gift some of them to another member. Common use case: children gifting
 * hours to grandparents who can't easily earn them themselves.
 *
 * Lifecycle:
 *   send()    → debits sender, creates pending gift
 *   accept()  → credits recipient, marks accepted
 *   decline() → refunds sender, marks declined
 *   revert()  → sender cancels pending gift, refunds sender
 */
class CaringHourGiftService
{
    private const STATUS_PENDING = 'pending';
    private const STATUS_ACCEPTED = 'accepted';
    private const STATUS_DECLINED = 'declined';
    private const STATUS_REVERTED = 'reverted';

    private const MAX_MESSAGE_LEN = 500;

    /**
     * @return array{gift_id:int,status:string}
     */
    public function send(int $senderId, int $recipientId, float $hours, ?string $message): array
    {
        $tenantId = (int) TenantContext::getId();

        if ($senderId <= 0 || $recipientId <= 0) {
            throw new InvalidArgumentException(__('api.caring_hour_gift_participants_required'));
        }
        if ($senderId === $recipientId) {
            throw new InvalidArgumentException(__('api.caring_hour_gift_self'));
        }
        if ($hours <= 0) {
            throw new InvalidArgumentException(__('api.caring_hour_gift_hours_gt_zero'));
        }
        if (round($hours, 2) != $hours) {
            throw new InvalidArgumentException(__('api.caring_hour_gift_hours_precision'));
        }

        $message = $message !== null ? trim($message) : null;
        if ($message !== null && $message !== '' && mb_strlen($message) > self::MAX_MESSAGE_LEN) {
            throw new InvalidArgumentException(__('api.caring_hour_gift_message_too_long'));
        }
        if ($message === '') {
            $message = null;
        }

        return DB::transaction(function () use ($tenantId, $senderId, $recipientId, $hours, $message): array {
            $sender = DB::table('users')
                ->where('id', $senderId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first(['id', 'balance']);
            if (!$sender) {
                throw new RuntimeException(__('api.caring_hour_gift_sender_not_found'));
            }
            if ((float) $sender->balance < $hours) {
                throw new RuntimeException(__('api.caring_hour_gift_insufficient_hours'));
            }

            $recipient = DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', $tenantId)
                ->whereNull('deleted_at')
                ->first(['id']);
            if (!$recipient) {
                throw new RuntimeException(__('api.caring_hour_gift_recipient_not_found'));
            }

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                $senderId,
                $recipientId,
                $tenantId,
                'caring_hour_gift',
            );

            // Debit sender immediately — hours are held in pending state until
            // the recipient accepts (or sender reverts / recipient declines).
            DB::table('users')
                ->where('id', $senderId)
                ->where('tenant_id', $tenantId)
                ->decrement('balance', $hours);

            $giftId = (int) DB::table('caring_hour_gifts')->insertGetId([
                'tenant_id'         => $tenantId,
                'sender_user_id'    => $senderId,
                'recipient_user_id' => $recipientId,
                'hours'             => round($hours, 2),
                'message'           => $message,
                'status'            => self::STATUS_PENDING,
                'created_at'        => now(),
                'updated_at'        => now(),
            ]);

            return ['gift_id' => $giftId, 'status' => self::STATUS_PENDING];
        });
    }

    public function accept(int $giftId, int $recipientId): void
    {
        $tenantId = (int) TenantContext::getId();

        DB::transaction(function () use ($tenantId, $giftId, $recipientId): void {
            $gift = DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$gift) {
                throw new RuntimeException(__('api.caring_hour_gift_not_found'));
            }
            if ((int) $gift->recipient_user_id !== $recipientId) {
                throw new RuntimeException(__('api.caring_hour_gift_recipient_only_accept'));
            }
            if ($gift->status !== self::STATUS_PENDING) {
                throw new RuntimeException(__('api.caring_hour_gift_no_longer_pending'));
            }

            DB::table('users')
                ->where('id', $recipientId)
                ->where('tenant_id', $tenantId)
                ->increment('balance', (float) $gift->hours);

            DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->update([
                    'status'      => self::STATUS_ACCEPTED,
                    'accepted_at' => now(),
                    'updated_at'  => now(),
                ]);
        });
    }

    public function decline(int $giftId, int $recipientId, ?string $reason): void
    {
        $tenantId = (int) TenantContext::getId();

        $reason = $reason !== null ? trim($reason) : null;
        if ($reason !== null && mb_strlen($reason) > self::MAX_MESSAGE_LEN) {
            $reason = mb_substr($reason, 0, self::MAX_MESSAGE_LEN);
        }
        if ($reason === '') {
            $reason = null;
        }

        DB::transaction(function () use ($tenantId, $giftId, $recipientId, $reason): void {
            $gift = DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$gift) {
                throw new RuntimeException(__('api.caring_hour_gift_not_found'));
            }
            if ((int) $gift->recipient_user_id !== $recipientId) {
                throw new RuntimeException(__('api.caring_hour_gift_recipient_only_decline'));
            }
            if ($gift->status !== self::STATUS_PENDING) {
                throw new RuntimeException(__('api.caring_hour_gift_no_longer_pending'));
            }

            // Refund sender
            DB::table('users')
                ->where('id', $gift->sender_user_id)
                ->where('tenant_id', $tenantId)
                ->increment('balance', (float) $gift->hours);

            DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->update([
                    'status'         => self::STATUS_DECLINED,
                    'declined_at'    => now(),
                    'decline_reason' => $reason,
                    'updated_at'     => now(),
                ]);
        });
    }

    public function revert(int $giftId, int $senderId): void
    {
        $tenantId = (int) TenantContext::getId();

        DB::transaction(function () use ($tenantId, $giftId, $senderId): void {
            $gift = DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();
            if (!$gift) {
                throw new RuntimeException(__('api.caring_hour_gift_not_found'));
            }
            if ((int) $gift->sender_user_id !== $senderId) {
                throw new RuntimeException(__('api.caring_hour_gift_sender_only_withdraw'));
            }
            if ($gift->status !== self::STATUS_PENDING) {
                throw new RuntimeException(__('api.caring_hour_gift_not_pending_withdraw'));
            }

            // Refund sender
            DB::table('users')
                ->where('id', $senderId)
                ->where('tenant_id', $tenantId)
                ->increment('balance', (float) $gift->hours);

            DB::table('caring_hour_gifts')
                ->where('id', $giftId)
                ->update([
                    'status'      => self::STATUS_REVERTED,
                    'reverted_at' => now(),
                    'updated_at'  => now(),
                ]);
        });
    }

    /**
     * Pending gifts the user has received (awaiting their accept/decline).
     *
     * @return list<array<string,mixed>>
     */
    public function myInbox(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();

        if (!Schema::hasTable('caring_hour_gifts')) {
            return [];
        }

        $avatarCol = $this->avatarColumn();

        $rows = DB::table('caring_hour_gifts as g')
            ->leftJoin('users as s', function ($j) {
                $j->on('s.id', '=', 'g.sender_user_id')
                  ->on('s.tenant_id', '=', 'g.tenant_id');
            })
            ->where('g.tenant_id', $tenantId)
            ->where('g.recipient_user_id', $userId)
            ->where('g.status', self::STATUS_PENDING)
            ->orderByDesc('g.created_at')
            ->get(array_filter([
                'g.id', 'g.hours', 'g.message', 'g.status', 'g.created_at',
                's.id as sender_id', 's.name as sender_name',
                's.first_name as sender_first', 's.last_name as sender_last',
                $avatarCol !== null ? "s.{$avatarCol} as sender_avatar" : null,
            ]));

        return $rows->map(fn (object $r): array => $this->formatGiftRow($r, 'received'))->all();
    }

    /**
     * Gifts the user has sent.
     *
     * @return list<array<string,mixed>>
     */
    public function mySent(int $userId): array
    {
        $tenantId = (int) TenantContext::getId();

        if (!Schema::hasTable('caring_hour_gifts')) {
            return [];
        }

        $avatarCol = $this->avatarColumn();

        $rows = DB::table('caring_hour_gifts as g')
            ->leftJoin('users as r', function ($j) {
                $j->on('r.id', '=', 'g.recipient_user_id')
                  ->on('r.tenant_id', '=', 'g.tenant_id');
            })
            ->where('g.tenant_id', $tenantId)
            ->where('g.sender_user_id', $userId)
            ->orderByDesc('g.created_at')
            ->limit(100)
            ->get(array_filter([
                'g.id', 'g.hours', 'g.message', 'g.status', 'g.created_at',
                'g.accepted_at', 'g.declined_at', 'g.reverted_at',
                'r.id as recipient_id', 'r.name as recipient_name',
                'r.first_name as recipient_first', 'r.last_name as recipient_last',
                $avatarCol !== null ? "r.{$avatarCol} as recipient_avatar" : null,
            ]));

        return $rows->map(fn (object $r): array => $this->formatGiftRow($r, 'sent'))->all();
    }

    /**
     * Resolve which avatar column the users table actually has — schemas
     * vary between profile_photo (legacy) and avatar_url (current).
     */
    private function avatarColumn(): ?string
    {
        if (Schema::hasColumn('users', 'profile_photo')) {
            return 'profile_photo';
        }
        if (Schema::hasColumn('users', 'avatar_url')) {
            return 'avatar_url';
        }
        return null;
    }

    private function formatGiftRow(object $row, string $perspective): array
    {
        $partnerKey = $perspective === 'received' ? 'sender' : 'recipient';
        $first = (string) ($row->{$partnerKey . '_first'} ?? '');
        $last  = (string) ($row->{$partnerKey . '_last'} ?? '');
        $name  = trim($first . ' ' . $last);
        if ($name === '') {
            $name = (string) ($row->{$partnerKey . '_name'} ?? '');
        }

        $avatar = (string) ($row->{$partnerKey . '_avatar'} ?? '');

        return [
            'id'         => (int) $row->id,
            'hours'      => round((float) $row->hours, 2),
            'message'    => $row->message !== null ? (string) $row->message : null,
            'status'     => (string) $row->status,
            'created_at' => (string) $row->created_at,
            'partner'    => [
                'id'         => (int) ($row->{$partnerKey . '_id'} ?? 0),
                'name'       => $name,
                'avatar_url' => $avatar !== '' ? $avatar : null,
            ],
        ];
    }
}
