<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services\Social;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Models\Social\Appreciation;
use App\Models\Social\AppreciationReaction;
use App\Services\SafeguardingInteractionPolicy;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * AppreciationService — SOC14 Thank-you / appreciation system.
 */
class AppreciationService
{
    public const ALLOWED_CONTEXTS = ['vol_log', 'listing_completion', 'general', 'event_help'];
    public const ALLOWED_REACTIONS = ['heart', 'clap', 'star'];
    public const DAILY_SEND_LIMIT = 10;

    /**
     * Send an appreciation; rate-limit 10 per sender per day.
     *
     * @throws \DomainException on rate-limit / sender==receiver
     */
    public function send(int $senderId, int $receiverId, string $message, ?string $contextType = null, ?int $contextId = null, bool $isPublic = true): Appreciation
    {
        if ($senderId === $receiverId) {
            throw new \DomainException('cannot_thank_self');
        }
        if (mb_strlen($message) > 500) {
            throw new \DomainException('message_too_long');
        }
        if ($contextType !== null && !in_array($contextType, self::ALLOWED_CONTEXTS, true)) {
            throw new \DomainException('invalid_context');
        }
        $participants = DB::table('users')
            ->whereIn('id', [$senderId, $receiverId])
            ->select(['id', 'tenant_id'])
            ->get()
            ->keyBy('id');

        $senderTenantId = $participants->get($senderId)?->tenant_id;
        if ($senderTenantId === null) {
            throw new \DomainException('sender_not_found');
        }

        $tenantId = (int) $senderTenantId;
        $receiverTenantId = $participants->get($receiverId)?->tenant_id;
        if ($receiverTenantId === null || (int) $receiverTenantId !== $tenantId) {
            throw new \DomainException('receiver_not_found');
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $senderId,
            $receiverId,
            $tenantId,
            'appreciation',
        );

        $today = now()->toDateString();
        $rateKey = "appreciation_sent:{$tenantId}:{$senderId}:{$today}";
        $count = (int) Cache::get($rateKey, 0);
        if ($count >= self::DAILY_SEND_LIMIT) {
            throw new \DomainException('rate_limit_exceeded');
        }

        $appreciation = Appreciation::create([
            'sender_id' => $senderId,
            'receiver_id' => $receiverId,
            'tenant_id' => $tenantId,
            'message' => $message,
            'context_type' => $contextType,
            'context_id' => $contextId,
            'is_public' => $isPublic,
            'reactions_count' => 0,
        ]);

        Cache::put($rateKey, $count + 1, now()->endOfDay());

        $this->notifyReceiver($appreciation);

        return $appreciation;
    }

    private function notifyReceiver(Appreciation $appreciation): void
    {
        try {
            $tenantId = $appreciation->tenant_id;
            $sender = DB::table('users')
                ->where('id', $appreciation->sender_id)
                ->where('tenant_id', $tenantId)
                ->select(['name'])
                ->first();
            $senderName = $sender->name ?? null;

            $receiver = DB::table('users')
                ->where('id', $appreciation->receiver_id)
                ->where('tenant_id', $tenantId)
                ->select(['email', 'name', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language', 'tenant_id'])
                ->first();
            if (!$receiver) {
                return;
            }
            $link = '/users/' . $appreciation->receiver_id . '/appreciations';

            LocaleContext::withLocale($receiver, function () use ($appreciation, $senderName, $link) {
                $displayName = $senderName ?: __('notifications.appreciation_someone');
                $message = __('notifications.appreciation_received', ['name' => $displayName]);
                Notification::createNotification((int) $appreciation->receiver_id, $message, $link, 'appreciation');
                \App\Services\NotificationDispatcher::fanOutPush((int) $appreciation->receiver_id, 'appreciation', $message, $link);
            });

            // Send mail (LocaleContext is wrapped inside the Mailable).
            \App\Mail\AppreciationReceived::send(
                (object) [
                    'id' => $appreciation->receiver_id,
                    'email' => $receiver->email ?? null,
                    'name' => $receiver->name ?? null,
                    'first_name' => $receiver->first_name ?? null,
                    'last_name' => $receiver->last_name ?? null,
                    'preferred_language' => $receiver->preferred_language ?? null,
                    'tenant_id' => $receiver->tenant_id ?? $tenantId,
                ],
                $senderName,
                $appreciation->message,
                (bool) $appreciation->is_public,
            );
        } catch (\Throwable $e) {
            Log::warning('AppreciationService::notifyReceiver: ' . $e->getMessage());
        }
    }

    public function react(int $appreciationId, int $userId, string $reactionType): array
    {
        if (!in_array($reactionType, self::ALLOWED_REACTIONS, true)) {
            throw new \DomainException('invalid_reaction');
        }
        $tenantId = TenantContext::getId();
        $appreciation = Appreciation::where('id', $appreciationId)
            ->where('tenant_id', $tenantId)
            ->firstOrFail();

        return DB::transaction(function () use ($appreciation, $userId, $reactionType, $tenantId) {
            $existing = AppreciationReaction::where('appreciation_id', $appreciation->id)
                ->where('user_id', $userId)
                ->first();
            if ($existing) {
                if ($existing->reaction_type === $reactionType) {
                    // toggle off
                    $existing->delete();
                    Appreciation::where('id', $appreciation->id)
                        ->where('reactions_count', '>', 0)
                        ->decrement('reactions_count');
                    return ['reacted' => false, 'reaction_type' => null];
                }
                $this->assertReactionContactAllowed($appreciation, $userId, (int) $tenantId);
                // swap
                $existing->reaction_type = $reactionType;
                $existing->save();
                return ['reacted' => true, 'reaction_type' => $reactionType];
            }
            $this->assertReactionContactAllowed($appreciation, $userId, (int) $tenantId);
            AppreciationReaction::create([
                'appreciation_id' => $appreciation->id,
                'user_id' => $userId,
                'reaction_type' => $reactionType,
                'tenant_id' => $tenantId,
                'created_at' => now(),
            ]);
            Appreciation::where('id', $appreciation->id)->increment('reactions_count');
            return ['reacted' => true, 'reaction_type' => $reactionType];
        });
    }

    private function assertReactionContactAllowed(Appreciation $appreciation, int $userId, int $tenantId): void
    {
        $recipientIds = array_values(array_unique(array_filter(
            [(int) $appreciation->sender_id, (int) $appreciation->receiver_id],
            static fn (int $recipientId): bool => $recipientId > 0 && $recipientId !== $userId,
        )));
        if ($recipientIds === []) {
            return;
        }

        app(SafeguardingInteractionPolicy::class)->assertManyLocalContactsAllowed(
            $userId,
            $recipientIds,
            $tenantId,
            'appreciation_reaction',
        );
    }

    public function removeReaction(int $appreciationId, int $userId): bool
    {
        $tenantId = TenantContext::getId();
        $existing = AppreciationReaction::where('appreciation_id', $appreciationId)
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->first();
        if (!$existing) {
            return false;
        }
        return DB::transaction(function () use ($existing, $appreciationId) {
            $existing->delete();
            Appreciation::where('id', $appreciationId)
                ->where('reactions_count', '>', 0)
                ->decrement('reactions_count');
            return true;
        });
    }

    public function getReceivedAppreciations(int $userId, int $page = 1, int $perPage = 20, bool $publicOnly = true): array
    {
        $q = Appreciation::where('receiver_id', $userId)
            ->where('tenant_id', TenantContext::getId())
            ->orderByDesc('created_at');
        if ($publicOnly) {
            $q->where('is_public', true);
        }
        $paginator = $q->paginate($perPage, ['*'], 'page', $page);
        $items = $paginator->items();
        $this->attachSenderInfo($items);
        return [
            'data' => $items,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ];
    }

    public function getMyAppreciations(int $userId, int $page = 1, int $perPage = 20): array
    {
        $tenantId = TenantContext::getId();
        $paginator = Appreciation::where('tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('receiver_id', $userId)->orWhere('sender_id', $userId);
            })
            ->orderByDesc('created_at')
            ->paginate($perPage, ['*'], 'page', $page);
        $items = $paginator->items();
        $this->attachSenderInfo($items);
        return [
            'data' => $items,
            'meta' => [
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ],
        ];
    }

    /**
     * @return array<int,array{user_id:int,name:string|null,avatar_url:string|null,count:int}>
     */
    public function getMostAppreciatedMembers(?int $tenantId = null, string $period = 'last_30d', int $limit = 10): array
    {
        $tenantId = $tenantId ?? TenantContext::getId();
        $since = match ($period) {
            'last_7d' => now()->subDays(7),
            'last_30d' => now()->subDays(30),
            'last_90d' => now()->subDays(90),
            'all_time' => null,
            default => now()->subDays(30),
        };

        $q = DB::table('appreciations as a')
            ->join('users as u', 'u.id', '=', 'a.receiver_id')
            ->where('a.tenant_id', $tenantId)
            ->where('a.is_public', true)
            ->select(
                'a.receiver_id as user_id',
                'u.name as name',
                'u.avatar_url as avatar_url',
                DB::raw('COUNT(a.id) as count')
            )
            ->groupBy('a.receiver_id', 'u.name', 'u.avatar_url')
            ->orderByDesc('count')
            ->limit($limit);
        if ($since) {
            $q->where('a.created_at', '>=', $since);
        }
        return $q->get()->map(fn ($r) => [
            'user_id' => (int) $r->user_id,
            'name' => $r->name,
            'avatar_url' => $r->avatar_url,
            'count' => (int) $r->count,
        ])->all();
    }

    public function getAppreciationsForContext(string $contextType, int $contextId): array
    {
        return Appreciation::where('tenant_id', TenantContext::getId())
            ->where('context_type', $contextType)
            ->where('context_id', $contextId)
            ->where('is_public', true)
            ->orderByDesc('created_at')
            ->get()
            ->all();
    }

    /** @param Appreciation[] $items */
    private function attachSenderInfo(array $items): void
    {
        if (empty($items)) return;
        $tenantId = TenantContext::getId();
        $senderIds = array_unique(array_map(fn ($a) => $a->sender_id, $items));
        $rows = DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $senderIds)
            ->select(['id', 'name', 'avatar_url'])
            ->get()
            ->keyBy('id');
        foreach ($items as $a) {
            $u = $rows->get($a->sender_id);
            $a->sender = $u ? ['id' => $u->id, 'name' => $u->name, 'avatar_url' => $u->avatar_url] : null;
        }
    }
}
