<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Services\NotificationDispatcher;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ExchangeService — Laravel DI-based service for exchange workflow operations.
 *
 * Manages the structured exchange lifecycle between members.
 */
class ExchangeService
{
    public const STATUS_PENDING = 'pending_provider';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_DECLINED = 'declined';
    public const STATUS_CANCELLED = 'cancelled';

    /**
     * Get all exchanges for a user with cursor-based pagination.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public function getAll(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $cursor = $filters['cursor'] ?? null;

        $tenantId = TenantContext::getId();

        $query = DB::table('exchange_requests as er')
            ->leftJoin('listings as l', 'er.listing_id', '=', 'l.id')
            ->leftJoin('users as req', 'er.requester_id', '=', 'req.id')
            ->leftJoin('users as prov', 'er.provider_id', '=', 'prov.id')
            ->where('er.tenant_id', $tenantId)
            ->where(fn ($q) => $q->where('er.requester_id', $userId)->orWhere('er.provider_id', $userId))
            ->select(
                'er.*',
                'l.title as listing_title',
                'l.type as listing_type',
                'req.name as requester_name',
                'req.avatar_url as requester_avatar',
                'prov.name as provider_name',
                'prov.avatar_url as provider_avatar'
            );

        if (! empty($filters['status'])) {
            if ($filters['status'] === 'active') {
                $query->whereIn('er.status', [
                    self::STATUS_PENDING,
                    self::STATUS_ACCEPTED,
                    'pending_broker',
                    'in_progress',
                ]);
            } elseif ($filters['status'] === 'needs_confirmation') {
                $query->whereIn('er.status', ['completed', 'pending_confirmation']);
            } else {
                $query->where('er.status', $filters['status']);
            }
        }
        if ($cursor !== null) {
            $query->where('er.id', '<', (int) base64_decode($cursor));
        }

        $query->orderByDesc('er.id');
        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        return [
            'items'    => $items->map(fn ($i) => (array) $i)->values()->all(),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Count the user's exchanges that are genuinely waiting on THEM to act —
     * the signal behind the dashboard "exchanges need your attention" banner.
     *
     * Member-actionable states only (never raw wallet transactions):
     *   1. pending_provider where the user is the provider → accept/decline.
     *   2. pending_confirmation where the user's own confirmation is still
     *      missing → confirm the hours.
     *   3. completed where the user hasn't reviewed the linked transaction → review.
     *
     * Deliberately excludes pending_broker (broker's job), accepted/scheduled/
     * in_progress (in flight, no blocking click), disputed (resolved by a broker/
     * admin), and terminal states. Returns 0 when nothing needs the user.
     */
    public function countNeedingAttention(int $userId): int
    {
        $tenantId = (int) (TenantContext::getId() ?? 0);
        if ($tenantId <= 0 || $userId <= 0) {
            return 0;
        }

        // Single source of truth: when the exchange workflow is disabled there is
        // nothing actionable, so every caller (accessible banner + React endpoint)
        // sees 0 — keeping the two dashboards in agreement.
        if (! BrokerControlConfigService::isExchangeWorkflowEnabled()) {
            return 0;
        }

        return (int) $this->needingAttentionFilter(DB::table('exchange_requests as er'), $userId, $tenantId)->count();
    }

    /**
     * The exchanges needing the user's action, shaped for display (the dashboard
     * "needs your attention" card). Same filter as countNeedingAttention(), plus
     * the counterparty + listing + the specific action the user must take.
     *
     * @return list<array<string, mixed>>
     */
    public function getNeedingAttention(int $userId, int $limit = 5): array
    {
        $tenantId = (int) (TenantContext::getId() ?? 0);
        if ($tenantId <= 0 || $userId <= 0) {
            return [];
        }

        // Same workflow gate as countNeedingAttention() — keep callers consistent.
        if (! BrokerControlConfigService::isExchangeWorkflowEnabled()) {
            return [];
        }

        $query = DB::table('exchange_requests as er')
            ->leftJoin('listings as l', 'er.listing_id', '=', 'l.id')
            ->leftJoin('users as req', 'er.requester_id', '=', 'req.id')
            ->leftJoin('users as prov', 'er.provider_id', '=', 'prov.id');

        $rows = $this->needingAttentionFilter($query, $userId, $tenantId)
            ->orderByDesc('er.id')
            ->limit(max(1, min($limit, 20)))
            ->get([
                'er.id', 'er.status', 'er.requester_id', 'er.provider_id',
                'er.requester_confirmed_at', 'er.provider_confirmed_at',
                'l.title as listing_title',
                'req.name as requester_name', 'req.avatar_url as requester_avatar',
                'prov.name as provider_name', 'prov.avatar_url as provider_avatar',
            ]);

        return $rows->map(function ($r) use ($userId) {
            $isRequester = (int) $r->requester_id === $userId;
            $isProvider  = (int) $r->provider_id === $userId;

            // The chip cue: a verb when it's the member's turn to act, otherwise a
            // neutral "active" state they're tracking in flight.
            $myConfirmMissing = ($isRequester && $r->requester_confirmed_at === null)
                || ($isProvider && $r->provider_confirmed_at === null);
            $action = match (true) {
                $r->status === self::STATUS_PENDING && $isProvider          => 'accept',  // your turn to respond
                $r->status === 'pending_confirmation' && $myConfirmMissing   => 'confirm', // your turn to confirm hours
                $r->status === self::STATUS_COMPLETED                        => 'review',  // your turn to review
                default                                                      => 'active',  // in flight / awaiting the other party
            };

            return [
                'id'                  => (int) $r->id,
                'status'              => (string) $r->status,
                'action'              => $action,
                'listing_title'       => $r->listing_title !== null ? (string) $r->listing_title : null,
                'counterparty_name'   => $isRequester ? ($r->provider_name ?? '') : ($r->requester_name ?? ''),
                'counterparty_avatar' => $isRequester ? ($r->provider_avatar ?? null) : ($r->requester_avatar ?? null),
            ];
        })->all();
    }

    /**
     * Shared WHERE for "exchanges needing the user's action": (1) pending_provider
     * where they are the provider, (2) pending_confirmation where their own
     * confirmation is still missing, (3) completed and not yet reviewed by them.
     *
     * @param  \Illuminate\Database\Query\Builder  $query  Aliased `exchange_requests as er`.
     */
    private function needingAttentionFilter($query, int $userId, int $tenantId)
    {
        return $query
            ->where('er.tenant_id', $tenantId)
            ->where(fn ($q) => $q->where('er.requester_id', $userId)->orWhere('er.provider_id', $userId))
            ->where(function ($outer) use ($userId, $tenantId) {
                // ANY active (non-terminal) exchange the member is part of — as
                // requester OR provider, whether it is their turn to act now or they
                // are tracking it in flight (a sent request awaiting a reply, work in
                // progress, hours to confirm, a dispute). Excludes only terminal
                // states (cancelled/expired/declined) and already-reviewed completions.
                $outer->whereIn('er.status', [
                    self::STATUS_PENDING,   // pending_provider
                    'pending_broker',
                    self::STATUS_ACCEPTED,  // accepted
                    'scheduled',
                    'in_progress',
                    'pending_confirmation',
                    'disputed',
                ])
                // PLUS a completed exchange the member has not reviewed yet.
                ->orWhere(function ($s) use ($userId, $tenantId) {
                    $s->where('er.status', self::STATUS_COMPLETED)
                      ->whereNotNull('er.transaction_id')
                      ->whereNotExists(function ($sub) use ($userId, $tenantId) {
                          $sub->selectRaw('1')
                              ->from('reviews as r')
                              ->whereColumn('r.transaction_id', 'er.transaction_id')
                              ->where('r.tenant_id', $tenantId)
                              ->where('r.reviewer_id', $userId);
                      });
                });
            });
    }

    /**
     * Get a single exchange by ID.
     */
    public function getById(int $id): ?array
    {
        $exchange = DB::table('exchange_requests')->where('tenant_id', TenantContext::getId())->where('id', $id)->first();
        return $exchange ? (array) $exchange : null;
    }

    /**
     * Create a new exchange request.
     */
    public function create(int $requesterId, int $listingId, array $data = []): ?int
    {
        $listing = DB::table('listings')->where('tenant_id', TenantContext::getId())->where('id', $listingId)->first();
        if (! $listing) {
            return null;
        }
        if ($requesterId === (int) $listing->user_id) {
            return null;
        }

        $id = DB::table('exchange_requests')->insertGetId([
            'tenant_id'       => TenantContext::getId(),
            'listing_id'      => $listingId,
            'requester_id'    => $requesterId,
            'provider_id'     => $listing->user_id,
            'proposed_hours'  => max(0.25, min(24, (float) ($data['proposed_hours'] ?? 1))),
            'requester_notes' => $data['message'] ?? null,
            'status'          => self::STATUS_PENDING,
            'created_at'      => now(),
            'updated_at'      => now(),
        ]);

        // Notify the provider (listing owner) about the new request
        try {
            NotificationDispatcher::send(
                (int) $listing->user_id,
                'exchange_request_received',
                ['exchange_id' => $id]
            );
        } catch (\Throwable $e) {
            Log::warning('[ExchangeService] create notification failed: ' . $e->getMessage());
        }

        return $id;
    }

    /**
     * Accept an exchange request.
     */
    public function accept(int $exchangeId, int $providerId): bool
    {
        $updated = DB::table('exchange_requests')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $exchangeId)
            ->where('provider_id', $providerId)
            ->where('status', self::STATUS_PENDING)
            ->update(['status' => self::STATUS_ACCEPTED, 'updated_at' => now()]) > 0;

        if ($updated) {
            try {
                $exchange = DB::table('exchange_requests')->where('tenant_id', TenantContext::getId())->where('id', $exchangeId)->first();
                if ($exchange) {
                    NotificationDispatcher::send(
                        (int) $exchange->requester_id,
                        'exchange_accepted',
                        ['exchange_id' => $exchangeId]
                    );
                }
            } catch (\Throwable $e) {
                Log::warning('[ExchangeService] accept notification failed: ' . $e->getMessage());
            }
        }

        return $updated;
    }

    /**
     * Complete an exchange.
     */
    public function complete(int $exchangeId, int $userId): bool
    {
        $exchange = DB::table('exchange_requests')->where('tenant_id', TenantContext::getId())->where('id', $exchangeId)->first();
        if (! $exchange || $exchange->status !== self::STATUS_ACCEPTED) {
            return false;
        }

        if ((int) $exchange->requester_id !== $userId && (int) $exchange->provider_id !== $userId) {
            return false;
        }

        $updated = DB::table('exchange_requests')
            ->where('tenant_id', TenantContext::getId())
            ->where('id', $exchangeId)
            ->update([
                'status'       => self::STATUS_COMPLETED,
                'completed_at' => now(),
                'updated_at'   => now(),
            ]) > 0;

        if ($updated) {
            try {
                $hours = (float) ($exchange->proposed_hours ?? 1);
                $data  = ['exchange_id' => $exchangeId, 'hours' => $hours];
                NotificationDispatcher::send((int) $exchange->requester_id, 'exchange_completed', $data);
                NotificationDispatcher::send((int) $exchange->provider_id,  'exchange_completed', $data);
            } catch (\Throwable $e) {
                Log::warning('[ExchangeService] complete notification failed: ' . $e->getMessage());
            }
        }

        return $updated;
    }
}
