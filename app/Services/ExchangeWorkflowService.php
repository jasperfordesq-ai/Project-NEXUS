<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\Mailer;
use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\ExchangeHistory;
use App\Models\ExchangeRequest;
use App\Models\Listing;
use App\Models\User;
use App\Support\Authorization\AdminTier;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ExchangeWorkflowService
 *
 * Manages the structured exchange workflow between members.
 * Supports broker approval, dual-party confirmation, and transaction creation.
 *
 * All queries are tenant-scoped via TenantContext::getId() or HasTenantScope.
 */
class ExchangeWorkflowService
{
    private const PURPOSE_LISTING_ROLE = 'listing_role';
    private const SCOPE_LISTING = 'listing';

    // Status constants
    public const STATUS_PENDING_PROVIDER = 'pending_provider';
    public const STATUS_PENDING_BROKER = 'pending_broker';
    public const STATUS_ACCEPTED = 'accepted';
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_PENDING_CONFIRMATION = 'pending_confirmation';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_DISPUTED = 'disputed';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_EXPIRED = 'expired';

    /** Valid status transitions */
    private const TRANSITIONS = [
        self::STATUS_PENDING_PROVIDER => [self::STATUS_PENDING_BROKER, self::STATUS_ACCEPTED, self::STATUS_CANCELLED, self::STATUS_EXPIRED],
        self::STATUS_PENDING_BROKER => [self::STATUS_ACCEPTED, self::STATUS_CANCELLED],
        self::STATUS_ACCEPTED => [self::STATUS_IN_PROGRESS, self::STATUS_CANCELLED],
        self::STATUS_IN_PROGRESS => [self::STATUS_PENDING_CONFIRMATION, self::STATUS_CANCELLED],
        self::STATUS_PENDING_CONFIRMATION => [self::STATUS_COMPLETED, self::STATUS_DISPUTED],
        self::STATUS_DISPUTED => [self::STATUS_COMPLETED, self::STATUS_CANCELLED],
        self::STATUS_COMPLETED => [],
        self::STATUS_CANCELLED => [],
        self::STATUS_EXPIRED => [],
    ];

    private BrokerControlConfigService $configService;

    public function __construct(BrokerControlConfigService $configService)
    {
        $this->configService = $configService;
    }

    /**
     * Initiate an exchange (legacy compat).
     */
    public static function initiate(int $tenantId, int $listingId, int $requesterId): ?int
    {
        return self::createRequest($requesterId, $listingId, []);
    }

    /**
     * Accept an exchange (legacy compat).
     */
    public static function accept(int $tenantId, int $exchangeId, int $userId): bool
    {
        return self::acceptRequest($exchangeId, $userId);
    }

    /**
     * Complete an exchange (legacy compat).
     */
    public static function complete(int $tenantId, int $exchangeId, int $userId, float $hours): bool
    {
        return self::confirmCompletion($exchangeId, $userId, $hours);
    }

    /**
     * Cancel an exchange (legacy compat).
     */
    public static function cancel(int $tenantId, int $exchangeId, int $userId, ?string $reason = null): bool
    {
        return self::cancelExchange($exchangeId, $userId, $reason ?? '');
    }

    /**
     * Create a new exchange request.
     *
     * @param int $requesterId User requesting the exchange
     * @param int $listingId Listing ID
     * @param array $data Request data (proposed_hours, message)
     * @return int|null Exchange ID or null
     */
    public static function createRequest(int $requesterId, int $listingId, array $data): ?int
    {
        $tenantId = TenantContext::getId();

        $listing = Listing::with('user')->find($listingId);
        if (!$listing) {
            return null;
        }

        $providerId = (int) $listing->user_id;

        if ($requesterId === $providerId) {
            return null;
        }

        if (! self::contactPolicyAllowsBoth(
            $requesterId,
            $providerId,
            $tenantId,
            'exchange_request',
        )) {
            return null;
        }

        $proposedHours = max(0.25, min(24, (float) ($data['proposed_hours'] ?? $listing->hours ?? 1)));
        $initialStatus = self::STATUS_PENDING_PROVIDER;

        $exchange = ExchangeRequest::create([
            'tenant_id' => $tenantId,
            'listing_id' => $listingId,
            'requester_id' => $requesterId,
            'provider_id' => $providerId,
            'proposed_hours' => $proposedHours,
            'requester_notes' => $data['message'] ?? null,
            'status' => $initialStatus,
        ]);

        self::logHistory($exchange->id, 'request_created', $requesterId, 'requester', null, $initialStatus);

        // Notify the listing owner (provider) about the new request
        try {
            NotificationDispatcher::send($providerId, 'exchange_request_received', [
                'exchange_id' => $exchange->id,
                'listing_title' => $listing->title ?? '',
                'proposed_hours' => $proposedHours,
            ]);
        } catch (\Throwable $e) {
            Log::warning("Exchange #{$exchange->id}: notification failed after createRequest", [
                'error' => $e->getMessage(),
            ]);
        }

        return $exchange->id;
    }

    /**
     * Provider accepts the exchange request.
     */
    public static function acceptRequest(int $exchangeId, int $providerId): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || (int) $exchange->provider_id !== $providerId) {
            return false;
        }
        if ($exchange->status !== self::STATUS_PENDING_PROVIDER) {
            return false;
        }

        if (! self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_accept',
        )) {
            return false;
        }

        $needsBroker = self::needsBrokerApproval(
            $exchange->listing_id,
            (float) $exchange->proposed_hours,
            (int) $exchange->requester_id,
            (int) $exchange->provider_id
        );
        $newStatus = $needsBroker ? self::STATUS_PENDING_BROKER : self::STATUS_ACCEPTED;

        $result = self::updateStatus($exchangeId, $newStatus, $providerId, 'provider', 'Provider accepted request');

        if ($result) {
            try {
                $requesterId = (int) $exchange->requester_id;
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'proposed_hours' => (float) $exchange->proposed_hours,
                ];

                if ($needsBroker) {
                    // Notify requester that exchange is pending broker approval
                    NotificationDispatcher::send($requesterId, 'exchange_pending_broker', $notificationData);
                    // Also notify admins/brokers
                    NotificationDispatcher::notifyAdmins('exchange_pending_broker', $notificationData);
                } else {
                    // Notify requester that exchange was accepted
                    NotificationDispatcher::send($requesterId, 'exchange_accepted', $notificationData);
                }
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after acceptRequest", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Provider declines the exchange request.
     */
    public static function declineRequest(int $exchangeId, int $providerId, string $reason = ''): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || (int) $exchange->provider_id !== $providerId) {
            return false;
        }
        if ($exchange->status !== self::STATUS_PENDING_PROVIDER) {
            return false;
        }

        $canIncludeMemberReason = self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_decline',
        );
        $safeReason = $canIncludeMemberReason ? $reason : '';

        $result = self::updateStatus($exchangeId, self::STATUS_CANCELLED, $providerId, 'provider', $safeReason ?: 'Provider declined');

        if ($result) {
            try {
                NotificationDispatcher::send((int) $exchange->requester_id, 'exchange_request_declined', [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'reason' => $safeReason,
                ]);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after declineRequest", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Broker approves the exchange.
     */
    public static function approveExchange(int $exchangeId, int $brokerId, string $notes = '', string $conditions = ''): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || $exchange->status !== self::STATUS_PENDING_BROKER) {
            return false;
        }

        if (! self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_broker_approval',
        )) {
            return false;
        }

        $exchange->update(['broker_id' => $brokerId, 'broker_notes' => $notes]);

        $result = self::updateStatus($exchangeId, self::STATUS_ACCEPTED, $brokerId, 'broker', $notes ?: 'Broker approved');

        if ($result) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'proposed_hours' => (float) $exchange->proposed_hours,
                ];
                NotificationDispatcher::send((int) $exchange->requester_id, 'exchange_approved', $notificationData);
                NotificationDispatcher::send((int) $exchange->provider_id, 'exchange_approved', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after approveExchange", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Broker rejects the exchange.
     */
    public static function rejectExchange(int $exchangeId, int $brokerId, string $reason): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || $exchange->status !== self::STATUS_PENDING_BROKER) {
            return false;
        }

        $exchange->update(['broker_id' => $brokerId, 'broker_notes' => $reason]);

        $result = self::updateStatus($exchangeId, self::STATUS_CANCELLED, $brokerId, 'broker', $reason);

        if ($result) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'reason' => $reason,
                ];
                NotificationDispatcher::send((int) $exchange->requester_id, 'exchange_rejected', $notificationData);
                NotificationDispatcher::send((int) $exchange->provider_id, 'exchange_rejected', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after rejectExchange", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Mark exchange as in progress.
     */
    public static function startProgress(int $exchangeId, int $userId): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || $exchange->status !== self::STATUS_ACCEPTED) {
            return false;
        }

        // Only the provider may start work (mirrors the React product rule). The
        // controller already restricts callers to the two parties; this closes
        // the gap where a requester could drive the workflow via a direct call.
        if ((int) $exchange->provider_id !== $userId) {
            return false;
        }

        if (! self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_start',
        )) {
            return false;
        }

        $result = self::updateStatus($exchangeId, self::STATUS_IN_PROGRESS, $userId, 'provider', 'Work started');

        if ($result) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'proposed_hours' => (float) $exchange->proposed_hours,
                ];
                // Notify the other party (not the one who started)
                $otherPartyId = ((int) $exchange->requester_id === $userId)
                    ? (int) $exchange->provider_id
                    : (int) $exchange->requester_id;
                NotificationDispatcher::send($otherPartyId, 'exchange_started', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after startProgress", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Mark exchange as ready for confirmation.
     */
    public static function markReadyForConfirmation(int $exchangeId, int $userId): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange || $exchange->status !== self::STATUS_IN_PROGRESS) {
            return false;
        }

        // Only the provider may mark work ready for confirmation (matches the
        // React product rule and closes the direct-call IDOR).
        if ((int) $exchange->provider_id !== $userId) {
            return false;
        }

        if (! self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_ready_confirmation',
        )) {
            return false;
        }

        $result = self::updateStatus($exchangeId, self::STATUS_PENDING_CONFIRMATION, $userId, 'provider', 'Work completed, pending confirmation');

        if ($result) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'proposed_hours' => (float) $exchange->proposed_hours,
                ];
                // Notify the other party to confirm hours
                $otherPartyId = ((int) $exchange->requester_id === $userId)
                    ? (int) $exchange->provider_id
                    : (int) $exchange->requester_id;
                NotificationDispatcher::send($otherPartyId, 'exchange_ready_confirmation', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after markReadyForConfirmation", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Confirm completion with hours.
     */
    public static function confirmCompletion(int $exchangeId, int $userId, float $hours): bool
    {
        return DB::transaction(function () use ($exchangeId, $userId, $hours) {
            // Lock the exchange row to prevent concurrent confirmation races
            $exchange = ExchangeRequest::query()
                ->lockForUpdate()
                ->find($exchangeId);

            if (!$exchange) {
                return false;
            }

            if (!in_array($exchange->status, [self::STATUS_IN_PROGRESS, self::STATUS_PENDING_CONFIRMATION], true)) {
                return false;
            }

            $isRequester = (int) $exchange->requester_id === $userId;
            $isProvider = (int) $exchange->provider_id === $userId;

            if (!$isRequester && !$isProvider) {
                return false;
            }

            // Re-evaluate at the irreversible confirmation boundary. A member
            // may have revoked a preference or a broker may have revoked an
            // attestation after work started; no confirmation or credit movement
            // may proceed under stale eligibility.
            if (! self::contactPolicyAllowsBoth(
                (int) $exchange->requester_id,
                (int) $exchange->provider_id,
                TenantContext::getId(),
                'exchange_confirm_completion',
            )) {
                return false;
            }

            // Adjust hours — read configured variance percentage from broker config
            $config = BrokerControlConfigService::getConfig('exchange_workflow');
            $variancePercent = (int) ($config['max_hour_variance_percent'] ?? 25);
            $varianceFactor = $variancePercent / 100;
            $minHours = (float) $exchange->proposed_hours * (1 - $varianceFactor);
            $maxHours = (float) $exchange->proposed_hours * (1 + $varianceFactor);
            $hours = max($minHours, min($maxHours, $hours));

            if ($isRequester) {
                $exchange->update([
                    'requester_confirmed_at' => now(),
                    'requester_confirmed_hours' => $hours,
                ]);
                self::logHistory($exchangeId, 'requester_confirmed', $userId, 'requester', null, null, "Confirmed $hours hours");
            } else {
                $exchange->update([
                    'provider_confirmed_at' => now(),
                    'provider_confirmed_hours' => $hours,
                ]);
                self::logHistory($exchangeId, 'provider_confirmed', $userId, 'provider', null, null, "Confirmed $hours hours");
            }

            if ($exchange->status === self::STATUS_IN_PROGRESS) {
                // Use direct update since updateStatus() now acquires its own lock
                // and we already hold the lock — avoid nested lock
                $oldStatus = $exchange->status;
                $newStatus = self::STATUS_PENDING_CONFIRMATION;
                $allowedTransitions = self::TRANSITIONS[$oldStatus] ?? [];
                if (in_array($newStatus, $allowedTransitions, true)) {
                    DB::table('exchange_requests')
                        ->where('id', $exchangeId)
                        ->update(['status' => $newStatus]);
                    self::logHistory($exchangeId, 'status_changed', $userId, $isRequester ? 'requester' : 'provider', $oldStatus, $newStatus);
                    $exchange->status = $newStatus;
                }
            }

            // Refresh to get latest confirmation data (we already hold the lock)
            $exchange->refresh();
            if ($exchange->requester_confirmed_at && $exchange->provider_confirmed_at) {
                return self::processConfirmations($exchangeId, $exchange);
            }

            return true;
        });
    }

    /**
     * Cancel an exchange.
     */
    public static function cancelExchange(int $exchangeId, int $userId, string $reason = ''): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange) {
            return false;
        }

        $terminalStatuses = [self::STATUS_COMPLETED, self::STATUS_CANCELLED, self::STATUS_EXPIRED];
        if (in_array($exchange->status, $terminalStatuses, true)) {
            return false;
        }

        $isRequester = (int) $exchange->requester_id === $userId;
        $isProvider  = (int) $exchange->provider_id  === $userId;

        if (!$isRequester && !$isProvider) {
            $caller = \App\Models\User::find($userId);
            // 🔴 This used to test `$caller->is_broker`, which does not exist —
            // there is no `is_broker` column on `users` and no accessor for one, so
            // the expression was always falsy. Combined with `is_admin` being a
            // deprecated flag that brokers are not granted, a genuine broker
            // (role = 'broker') reaching this branch was REJECTED. Use the
            // canonical predicate instead: admin tier via AdminTier::allows(), or
            // an operational role. See docs/ROLES-AND-PERMISSIONS.md — checking
            // only flags, or only the role string, under-authorises real staff.
            if (!$caller || !self::callerHasStaffAuthority($caller)) {
                throw new \RuntimeException('UNAUTHORIZED: caller is not a party to this exchange and does not have broker/admin privileges');
            }
            $role = 'broker';
        } else {
            $role = $isRequester ? 'requester' : 'provider';
        }

        $canIncludeMemberReason = self::contactPolicyAllowsBoth(
            (int) $exchange->requester_id,
            (int) $exchange->provider_id,
            TenantContext::getId(),
            'exchange_cancel',
        );
        $safeReason = $canIncludeMemberReason ? $reason : '';

        $result = self::updateStatus($exchangeId, self::STATUS_CANCELLED, $userId, $role, $safeReason ?: 'Cancelled');

        if ($result) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'listing_title' => $exchange->listing->title ?? '',
                    'reason' => $safeReason,
                ];
                // Notify the other party (not the one who cancelled)
                $otherPartyId = $isRequester
                    ? (int) $exchange->provider_id
                    : (int) $exchange->requester_id;
                NotificationDispatcher::send($otherPartyId, 'exchange_cancelled', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after cancelExchange", [
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return $result;
    }

    /**
     * Get exchange by ID.
     *
     * @param int $exchangeId Exchange ID
     * @return array|null Exchange data
     */
    public static function getExchange(int $exchangeId): ?array
    {
        $tenantId = TenantContext::getId();

        $row = DB::table('exchange_requests as e')
            ->join('listings as l', 'e.listing_id', '=', 'l.id')
            ->join('users as req', 'e.requester_id', '=', 'req.id')
            ->join('users as prov', 'e.provider_id', '=', 'prov.id')
            ->leftJoin('users as broker', 'e.broker_id', '=', 'broker.id')
            ->leftJoin('listing_risk_tags as rt', function ($join) {
                $join->on('e.listing_id', '=', 'rt.listing_id')
                    ->whereColumn('rt.tenant_id', '=', 'e.tenant_id');
            })
            ->where('e.id', $exchangeId)
            ->where('e.tenant_id', $tenantId)
            ->select([
                'e.*',
                'l.title as listing_title', 'l.type as listing_type',
                'req.name as requester_name', 'req.email as requester_email', 'req.avatar_url as requester_avatar',
                'prov.name as provider_name', 'prov.email as provider_email', 'prov.avatar_url as provider_avatar',
                'broker.name as broker_name',
                'rt.risk_level',
            ])
            ->first();

        if (!$row) {
            return null;
        }

        return (array) $row;
    }

    /**
     * Get active exchange for a user on a specific listing.
     */
    public static function getActiveExchangeForListing(int $userId, int $listingId): ?array
    {
        $terminalStatuses = [self::STATUS_COMPLETED, self::STATUS_CANCELLED, self::STATUS_EXPIRED];

        $row = ExchangeRequest::where('listing_id', $listingId)
            ->where(function ($q) use ($userId) {
                $q->where('requester_id', $userId)->orWhere('provider_id', $userId);
            })
            ->whereNotIn('status', $terminalStatuses)
            ->orderByDesc('created_at')
            ->first(['id', 'status', 'proposed_hours', 'created_at', 'requester_id', 'provider_id']);

        return $row ? $row->toArray() : null;
    }

    /**
     * Get exchange history.
     *
     * @param int $exchangeId Exchange ID
     * @return array History entries
     */
    public static function getExchangeHistory(int $exchangeId): array
    {
        return ExchangeHistory::with('actor:id,name')
            ->where('exchange_id', $exchangeId)
            ->orderBy('created_at')
            ->get()
            ->toArray();
    }

    /**
     * Get exchanges for a user with optional filters.
     *
     * @param int $userId User ID
     * @param array $filters Optional filters (status, limit, offset)
     * @return array Paginated result with 'items' and 'total'
     */
    public static function getExchangesForUser(int $userId, array $filters = []): array
    {
        $tenantId = TenantContext::getId();

        $query = DB::table('exchange_requests as e')
            ->join('listings as l', 'e.listing_id', '=', 'l.id')
            ->join('users as req', 'e.requester_id', '=', 'req.id')
            ->join('users as prov', 'e.provider_id', '=', 'prov.id')
            ->where('e.tenant_id', $tenantId)
            ->where(function ($q) use ($userId) {
                $q->where('e.requester_id', $userId)->orWhere('e.provider_id', $userId);
            });

        if (!empty($filters['status'])) {
            $query->where('e.status', $filters['status']);
        }

        $total = $query->count();

        $limit = (int) ($filters['limit'] ?? 20);
        $offset = (int) ($filters['offset'] ?? 0);

        $rows = $query->orderByDesc('e.created_at')
            ->offset($offset)
            ->limit($limit)
            ->select([
                'e.*',
                'l.title as listing_title', 'l.type as listing_type',
                'req.name as requester_name',
                'prov.name as provider_name',
            ])
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();

        return [
            'items' => $rows,
            'total' => $total,
        ];
    }

    /**
     * Get exchanges pending broker approval.
     *
     * @return array Paginated result with 'items'
     */
    public static function getPendingBrokerApprovals(): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('exchange_requests as e')
            ->join('listings as l', 'e.listing_id', '=', 'l.id')
            ->join('users as req', 'e.requester_id', '=', 'req.id')
            ->join('users as prov', 'e.provider_id', '=', 'prov.id')
            ->where('e.tenant_id', $tenantId)
            ->where('e.status', self::STATUS_PENDING_BROKER)
            ->orderByDesc('e.created_at')
            ->select([
                'e.*',
                'l.title as listing_title', 'l.type as listing_type',
                'req.name as requester_name',
                'prov.name as provider_name',
            ])
            ->get()
            ->map(fn ($row) => (array) $row)
            ->toArray();

        return [
            'items' => $rows,
        ];
    }

    /**
     * Get exchange statistics for a time period.
     *
     * @param int $days Number of days to look back
     * @return array Statistics
     */
    public static function getStatistics(int $days = 30): array
    {
        $tenantId = TenantContext::getId();
        $since = now()->subDays($days)->toDateTimeString();

        try {
            $total = DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('created_at', '>=', $since)
                ->count();

            $completed = DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', self::STATUS_COMPLETED)
                ->where('created_at', '>=', $since)
                ->count();

            $pendingBroker = DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', self::STATUS_PENDING_BROKER)
                ->where('created_at', '>=', $since)
                ->count();

            $cancelled = DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', self::STATUS_CANCELLED)
                ->where('created_at', '>=', $since)
                ->count();

            $disputed = DB::table('exchange_requests')
                ->where('tenant_id', $tenantId)
                ->where('status', self::STATUS_DISPUTED)
                ->where('created_at', '>=', $since)
                ->count();

            return [
                'total' => $total,
                'completed' => $completed,
                'pending_broker' => $pendingBroker,
                'cancelled' => $cancelled,
                'disputed' => $disputed,
                'days' => $days,
            ];
        } catch (\Exception $e) {
            return [
                'total' => 0,
                'completed' => 0,
                'pending_broker' => 0,
                'cancelled' => 0,
                'disputed' => 0,
                'days' => $days,
            ];
        }
    }

    /**
     * Check compliance requirements for an exchange.
     *
     * @param int $listingId Listing ID
     * @param int $providerId Provider user ID
     * @return array Array of violation strings (empty = compliant)
     */
    public static function checkComplianceRequirements(int $listingId, int $providerId): array
    {
        $violations = [];
        $tenantId = TenantContext::getId();

        try {
            $listingProviderId = (int) DB::table('listings')
                ->where('id', $listingId)
                ->where('tenant_id', $tenantId)
                ->value('user_id');
            if ($listingProviderId > 0) {
                $providerId = $listingProviderId;
            }

            $riskTag = DB::table('listing_risk_tags')
                ->where('listing_id', $listingId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$riskTag) {
                return [];
            }

            if (!empty($riskTag->dbs_required)) {
                $policy = app(SafeguardingJurisdictionService::class)->getPolicy($tenantId);
                if (! $policy['configured']
                    || ! $policy['contact_policy_available']
                    || $policy['scheme_code'] === null
                    || $policy['attestation_code'] === null
                    || $policy['policy_version'] === null) {
                    $violations[] = __('safeguarding.errors.compliance_policy_unavailable');
                } else {
                    $hasVetting = app(MemberVettingAttestationService::class)->hasConfirmedAttestation(
                        tenantId: $tenantId,
                        memberId: $providerId,
                        schemeCode: $policy['scheme_code'],
                        attestationCode: $policy['attestation_code'],
                        purposeCode: self::PURPOSE_LISTING_ROLE,
                        scopeType: self::SCOPE_LISTING,
                        scopeIdentifier: (string) $listingId,
                        policyVersion: $policy['policy_version'],
                    );

                    if (! $hasVetting) {
                        $violations[] = __('safeguarding.errors.listing_role_confirmation_required');
                    }
                }
            }

            if (!empty($riskTag->insurance_required)) {
                $hasInsurance = DB::table('insurance_certificates')
                    ->where('user_id', $providerId)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'verified')
                    ->where(function ($q) {
                        $q->whereNull('expiry_date')->orWhere('expiry_date', '>', now());
                    })
                    ->exists();

                if (!$hasInsurance) {
                    $violations[] = 'Provider requires valid insurance certificate for this listing.';
                }
            }
        } catch (\Throwable $e) {
            Log::error('[ExchangeWorkflow] compliance policy unavailable', [
                'tenant_id' => $tenantId,
                'listing_id' => $listingId,
                'provider_id' => $providerId,
                'error' => $e->getMessage(),
            ]);
            $violations[] = __('safeguarding.errors.compliance_policy_unavailable');
        }

        return array_values(array_unique($violations));
    }

    // =========================================================================
    // PRIVATE HELPERS
    // =========================================================================

    private static function contactPolicyAllowsBoth(
        int $firstUserId,
        int $secondUserId,
        int $tenantId,
        string $channel,
    ): bool {
        $policy = app(SafeguardingInteractionPolicy::class);
        foreach ([[$firstUserId, $secondUserId], [$secondUserId, $firstUserId]] as [$senderId, $recipientId]) {
            $decision = $policy->evaluateLocalContact($senderId, $recipientId, $tenantId, $channel);
            if (! $decision->isAllowed()) {
                Log::info('[ExchangeWorkflow] Blocked by safeguarding contact policy', [
                    'tenant_id' => $tenantId,
                    'sender_id' => $senderId,
                    'recipient_id' => $recipientId,
                    'reason_code' => $decision->code,
                    'channel' => $channel,
                ]);

                return false;
            }
        }

        return true;
    }

    private static function processConfirmations(int $exchangeId, ExchangeRequest $exchange): bool
    {
        $requesterHours = (float) $exchange->requester_confirmed_hours;
        $providerHours = (float) $exchange->provider_confirmed_hours;

        if (abs($requesterHours - $providerHours) < 0.01) {
            return self::completeExchange($exchangeId, $requesterHours);
        }

        $varianceTolerance = 0.25;
        if (abs($requesterHours - $providerHours) <= $varianceTolerance) {
            $finalHours = ($requesterHours + $providerHours) / 2;
            return self::completeExchange($exchangeId, $finalHours);
        }

        // Dispute
        self::updateStatus($exchangeId, self::STATUS_DISPUTED, null, 'system',
            "Hours mismatch: requester=$requesterHours, provider=$providerHours");

        // Notify both parties of the dispute
        try {
            $exchange = DB::table('exchange_requests as er')
                ->join('users as req', function ($j) { $j->on('req.id', '=', 'er.requester_id'); })
                ->join('users as prov', function ($j) { $j->on('prov.id', '=', 'er.provider_id'); })
                ->where('er.id', $exchangeId)
                ->select([
                    'er.tenant_id', 'er.id',
                    'req.id as req_id', 'req.email as req_email', 'req.first_name as req_fname', 'req.name as req_name', 'req.preferred_language as req_lang',
                    'prov.id as prov_id', 'prov.email as prov_email', 'prov.first_name as prov_fname', 'prov.name as prov_name', 'prov.preferred_language as prov_lang',
                    'er.listing_id',
                ])
                ->first();

            if ($exchange) {
                $previousTenantId = TenantContext::currentId();
                try {
                    TenantContext::setById((int) $exchange->tenant_id);
                    $link        = '/exchanges/' . $exchangeId;
                    $frontendUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();

                    foreach ([
                        ['email' => $exchange->req_email, 'name' => $exchange->req_fname ?? $exchange->req_name, 'lang' => $exchange->req_lang ?? null],
                        ['email' => $exchange->prov_email, 'name' => $exchange->prov_fname ?? $exchange->prov_name, 'lang' => $exchange->prov_lang ?? null],
                    ] as $party) {
                        if (empty($party['email'])) {
                            continue;
                        }

                        LocaleContext::withLocale($party['lang'], function () use ($party, $frontendUrl, $link, $exchange) {
                            $html = EmailTemplateBuilder::make()
                                ->theme('warning')
                                ->title(__('emails.exchange_dispute.title'))
                                ->previewText(__('emails.exchange_dispute.preview'))
                                ->greeting($party['name'] ?? __('emails.common.fallback_name'))
                                ->paragraph(__('emails.exchange_dispute.body'))
                                ->paragraph(__('emails.exchange_dispute.next_steps'))
                                ->button(__('emails.exchange_dispute.cta'), $frontendUrl . $link)
                                ->render();

                            if (!\App\Services\EmailDispatchService::sendRaw(
                                $party['email'],
                                __('emails.exchange_dispute.subject'),
                                $html,
                                null,
                                null,
                                null,
                                'exchange_dispute',
                                ['tenant_id' => (int) $exchange->tenant_id]
                            )) {
                                Log::warning('[ExchangeWorkflowService] dispute notification email returned false', [
                                    'email' => $party['email'],
                                ]);
                            }
                        });
                    }
                } finally {
                    if ($previousTenantId !== null) {
                        TenantContext::setById($previousTenantId);
                    } else {
                        TenantContext::reset();
                    }
                }
            }
        } catch (\Throwable $e) {
            Log::warning('[ExchangeWorkflowService] dispute notification failed: ' . $e->getMessage());
        }

        return true;
    }

    private static function completeExchange(int $exchangeId, float $finalHours): bool
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange) {
            return false;
        }

        // Guard: only pending_confirmation or disputed exchanges can be completed
        $allowedStatuses = [self::STATUS_PENDING_CONFIRMATION, self::STATUS_DISPUTED];
        if (!in_array($exchange->status, $allowedStatuses, true)) {
            Log::warning("Exchange #$exchangeId: cannot complete from status '{$exchange->status}'");
            return false;
        }

        // Capture whether this was a disputed exchange before the transaction changes the status
        $wasDisputed = $exchange->status === self::STATUS_DISPUTED;

        // Run the financial transaction first — notifications must NEVER be inside this block.
        // If notifications threw inside the transaction, the credit transfer would roll back.
        $transactionSucceeded = DB::transaction(function () use ($exchangeId, $exchange, $finalHours) {
            // Re-read with lock to prevent double-completion race condition
            $lockedExchange = DB::table('exchange_requests')
                ->where('id', $exchangeId)
                ->lockForUpdate()
                ->first();

            if (!$lockedExchange || $lockedExchange->status === self::STATUS_COMPLETED) {
                Log::warning("Exchange #$exchangeId: already completed (race condition prevented)");
                return false;
            }

            $exchange->update(['final_hours' => $finalHours]);

            // Create transaction via DB (includes balance check + row locking)
            $transactionId = self::createTransaction($exchangeId, $finalHours);
            if ($transactionId) {
                $exchange->update(['transaction_id' => $transactionId]);
            } else {
                // Transaction creation failed (e.g., insufficient balance) — abort
                throw new \RuntimeException("Exchange #$exchangeId: failed to create financial transaction");
            }

            self::updateStatus($exchangeId, self::STATUS_COMPLETED, null, 'system', "Completed with $finalHours hours");

            return true;
        });

        // Send notifications AFTER the transaction has committed — notification failures
        // must never affect the financial transaction or roll back credit transfers.
        if ($transactionSucceeded) {
            try {
                $notificationData = [
                    'exchange_id' => $exchangeId,
                    'hours' => $finalHours,
                    'listing_title' => $exchange->listing->title ?? '',
                ];
                $requesterId = (int) $exchange->requester_id;
                $providerId = (int) $exchange->provider_id;

                NotificationDispatcher::send($requesterId, 'exchange_completed', $notificationData);
                NotificationDispatcher::send($providerId, 'exchange_completed', $notificationData);
            } catch (\Throwable $e) {
                Log::warning("Exchange #{$exchangeId}: notification failed after completion", [
                    'error' => $e->getMessage(),
                ]);
            }

            // If this was a disputed exchange, also send a dispute-resolved email
            if ($wasDisputed) {
                try {
                    self::sendDisputeResolvedEmails($exchange, $finalHours);
                } catch (\Throwable $e) {
                    Log::warning("Exchange #{$exchangeId}: dispute resolved email failed", [
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        return $transactionSucceeded;
    }

    /**
     * Send dispute-resolved emails to both parties of a completed disputed exchange.
     */
    private static function sendDisputeResolvedEmails(ExchangeRequest $exchange, float $finalHours): void
    {
        $previousTenantId = TenantContext::currentId();
        if (!empty($exchange->tenant_id)) {
            TenantContext::setById((int) $exchange->tenant_id);
        }

        try {
            $frontendUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
            $link = '/exchanges/' . $exchange->id;

            $parties = [];

            $requester = User::find($exchange->requester_id);
            if ($requester && !empty($requester->email)) {
                $parties[] = [
                    'email' => $requester->email,
                    'name' => $requester->first_name ?? $requester->name ?? null,
                    'lang' => $requester->preferred_language ?? null,
                ];
            }

            $provider = User::find($exchange->provider_id);
            if ($provider && !empty($provider->email)) {
                $parties[] = [
                    'email' => $provider->email,
                    'name' => $provider->first_name ?? $provider->name ?? null,
                    'lang' => $provider->preferred_language ?? null,
                ];
            }

            foreach ($parties as $party) {
                LocaleContext::withLocale($party['lang'], function () use ($party, $finalHours, $frontendUrl, $link, $exchange) {
                    $html = EmailTemplateBuilder::make()
                        ->theme('success')
                        ->title(__('emails.dispute_resolved_title'))
                        ->previewText(__('emails.dispute_resolved_preview'))
                        ->greeting($party['name'] ?? __('emails.common.fallback_name'))
                        ->paragraph(__('emails.dispute_resolved_body', ['hours' => $finalHours]))
                        ->infoCard([
                            __('emails.dispute_resolved_hours_label') => number_format($finalHours, 2),
                        ], null)
                        ->button(__('emails.dispute_resolved_cta'), $frontendUrl . $link)
                        ->render();

                    if (!\App\Services\EmailDispatchService::sendRaw(
                        $party['email'],
                        __('emails.dispute_resolved_subject'),
                        $html,
                        null,
                        null,
                        null,
                        'exchange_dispute',
                        ['tenant_id' => (int) $exchange->tenant_id]
                    )) {
                        Log::warning('[ExchangeWorkflowService] dispute resolved email returned false', [
                            'email' => $party['email'],
                        ]);
                    }
                });
            }
        } finally {
            if ($previousTenantId !== null) {
                TenantContext::setById($previousTenantId);
            } else {
                TenantContext::reset();
            }
        }
    }

    private static function createTransaction(int $exchangeId, float $hours): ?int
    {
        $exchangeData = self::getExchange($exchangeId);
        if (!$exchangeData) {
            return null;
        }

        $tenantId = TenantContext::getId();

        try {
            $requesterId = (int) $exchangeData['requester_id'];
            $providerId = (int) $exchangeData['provider_id'];

            // Credit direction depends on the listing type: the party that
            // RECEIVES the service pays; the party that PROVIDES it earns.
            //   - offer   listing: the listing owner (provider_id) does the
            //       work → the requester (recipient) pays the provider.
            //   - request listing: the listing owner asked for help and the
            //       responder (requester_id) does the work → the provider
            //       (the help-seeker) pays the requester.
            // Previously this always transferred requester → provider, so on a
            // request-type listing the helper was charged and the help-seeker
            // was credited — the credit moved backwards.
            $listingType = (string) ($exchangeData['listing_type'] ?? 'offer');
            if ($listingType === 'request') {
                $payerId = $providerId;
                $payeeId = $requesterId;
            } else {
                $payerId = $requesterId;
                $payeeId = $providerId;
            }

            // Lock payer row and check balance to prevent negative balances
            $payer = DB::table('users')
                ->where('id', $payerId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            if (!$payer || (float) $payer->balance < $hours) {
                Log::warning("Exchange #{$exchangeId}: payer #{$payerId} has insufficient balance (" . ($payer->balance ?? 0) . " < {$hours})");
                // Typed signal so the confirm endpoint returns a clear 4xx instead
                // of a generic 500. The surrounding DB::transaction rolls back, so
                // no credits move and the counterparty's confirmation is preserved.
                throw new \RuntimeException('INSUFFICIENT_BALANCE');
            }

            // Lock payee row too for consistency
            DB::table('users')
                ->where('id', $payeeId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->first();

            DB::table('users')->where('id', $payerId)->where('tenant_id', $tenantId)
                ->decrement('balance', $hours);
            DB::table('users')->where('id', $payeeId)->where('tenant_id', $tenantId)
                ->increment('balance', $hours);

            $transactionId = DB::table('transactions')->insertGetId([
                'tenant_id' => $tenantId,
                'sender_id' => $payerId,
                'receiver_id' => $payeeId,
                'amount' => $hours,
                'description' => "Exchange #$exchangeId for listing: " . ($exchangeData['listing_title'] ?? ''),
                'transaction_type' => 'exchange',
                'status' => 'completed',
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return $transactionId;
        } catch (\Exception $e) {
            // Let the typed insufficient-balance signal propagate (so the confirm
            // endpoint can return a 4xx); only generic/unexpected failures degrade
            // to a null return.
            if ($e instanceof \RuntimeException && $e->getMessage() === 'INSUFFICIENT_BALANCE') {
                throw $e;
            }
            Log::error("Failed to create transaction for exchange $exchangeId: " . $e->getMessage());
            return null;
        }
    }

    private static function updateStatus(int $exchangeId, string $newStatus, ?int $actorId, string $actorRole, ?string $notes = null): bool
    {
        return DB::transaction(function () use ($exchangeId, $newStatus, $actorId, $actorRole, $notes) {
            // Lock the row to prevent concurrent status transitions
            $exchange = DB::table('exchange_requests')
                ->where('id', $exchangeId)
                ->lockForUpdate()
                ->first();

            if (!$exchange) {
                return false;
            }

            $oldStatus = $exchange->status;

            $allowedTransitions = self::TRANSITIONS[$oldStatus] ?? [];
            if (!in_array($newStatus, $allowedTransitions, true)) {
                return false;
            }

            DB::table('exchange_requests')
                ->where('id', $exchangeId)
                ->update(['status' => $newStatus]);

            self::logHistory($exchangeId, 'status_changed', $actorId, $actorRole, $oldStatus, $newStatus, $notes);

            return true;
        });
    }

    /**
     * Whether a non-party caller may act on an exchange as staff.
     *
     * Admin tier (AdminTier::allows) OR an operational role (broker /
     * coordinator). Deliberately not a flags-only or role-string-only check:
     * `super_admin`, `god`, `tenant_admin` and `coordinator` are never written to
     * `users.role` by the admin API, while `broker` is, so either test alone
     * misses real staff.
     *
     * @param object|array<string,mixed>|null $caller
     */
    private static function callerHasStaffAuthority(object|array|null $caller): bool
    {
        if ($caller === null) {
            return false;
        }

        if (AdminTier::allows($caller)) {
            return true;
        }

        $role = (string) data_get($caller, 'role', '');

        return in_array($role, AdminTier::OPERATIONAL_ROLES, true);
    }

    /**
     * Resolve a DISPUTED exchange by setting the final hours figure (broker/admin).
     *
     * 🔴 Why this exists. A disputed exchange used to be a permanent dead end, and
     * it is the one state where credits are stuck BEFORE they move:
     *
     *  - `disputed` is only ever entered automatically, by processConfirmations()
     *    when the two parties' confirmed hours differ by more than 0.25h.
     *  - TRANSITIONS has always permitted disputed → completed, and
     *    completeExchange() explicitly accepts `disputed` and even sends a
     *    dedicated "dispute resolved" email — but it is private and its only
     *    caller sits behind confirmCompletion(), whose own guard excludes
     *    `disputed`. So that whole path was unreachable.
     *  - cancelExchange()'s staff branch was unreachable from every HTTP route
     *    (the member routes 404 non-parties first) and, until the fix above,
     *    would have rejected brokers anyway.
     *
     * Meanwhile AdminBrokerController::dashboard() counts disputed exchanges as
     * "needs attention" and SloCheck alarms on them ageing — the product was
     * advertising a queue with no action attached to it.
     *
     * The final figure is clamped to the SAME proposed_hours ± variance window
     * that individual confirmations use, so an arbitrator cannot post a number the
     * workflow would have refused from a participant. A note is mandatory and is
     * recorded in exchange_history, which is already surfaced to both members.
     *
     * @return array{ok: bool, error?: string, final_hours?: float}
     */
    public static function resolveDispute(int $exchangeId, int $actorId, float $finalHours, string $notes): array
    {
        $exchange = ExchangeRequest::find($exchangeId);
        if (!$exchange) {
            return ['ok' => false, 'error' => 'NOT_FOUND'];
        }

        if ($exchange->status !== self::STATUS_DISPUTED) {
            return ['ok' => false, 'error' => 'NOT_DISPUTED'];
        }

        $notes = trim($notes);
        if ($notes === '') {
            return ['ok' => false, 'error' => 'REASON_REQUIRED'];
        }

        $caller = \App\Models\User::find($actorId);
        if (!self::callerHasStaffAuthority($caller)) {
            return ['ok' => false, 'error' => 'UNAUTHORIZED'];
        }

        if (!is_finite($finalHours) || $finalHours <= 0) {
            return ['ok' => false, 'error' => 'INVALID_HOURS'];
        }

        $config = BrokerControlConfigService::getConfig('exchange_workflow');
        $variancePercent = (int) ($config['max_hour_variance_percent'] ?? 25);
        $varianceFactor = $variancePercent / 100;
        $proposed = (float) $exchange->proposed_hours;
        $minHours = $proposed * (1 - $varianceFactor);
        $maxHours = $proposed * (1 + $varianceFactor);
        $clamped = max($minHours, min($maxHours, $finalHours));

        self::logHistory(
            $exchangeId,
            'dispute_resolved',
            $actorId,
            'broker',
            self::STATUS_DISPUTED,
            self::STATUS_COMPLETED,
            sprintf(
                'Dispute resolved at %.2f hours (requester claimed %s, provider claimed %s). %s',
                $clamped,
                $exchange->requester_confirmed_hours ?? '—',
                $exchange->provider_confirmed_hours ?? '—',
                $notes
            )
        );

        // completeExchange() moves the credits, flips the status and — because it
        // sees the pre-existing `disputed` status — sends the dispute-resolved
        // notifications rather than the ordinary completion ones.
        if (!self::completeExchange($exchangeId, $clamped)) {
            return ['ok' => false, 'error' => 'COMPLETE_FAILED'];
        }

        return ['ok' => true, 'final_hours' => $clamped];
    }

    /**
     * Reverse a COMPLETED exchange, putting both members' credits back.
     *
     * 🔴 Why this exists. A completed exchange was uncorrectable. `TRANSITIONS`
     * makes `completed` terminal, no endpoint amended or reversed one, and the only
     * tool an administrator had was the single-member balance adjustment — applied
     * twice by hand, with no link to the exchange and, until 2026-08-04, no audit
     * row at all. A mis-recorded exchange moved real credits and nothing could put
     * them back traceably.
     *
     * Deliberately modelled on MarketplaceTimeCreditSettlementService::refund(),
     * which is the only existing in-house pattern that reverses a two-sided
     * time-credit movement correctly. Copied from it, point by point:
     *
     *  - A COMPENSATING transaction, never a mutation or deletion of the original.
     *    The original entry stays exactly as it was; the correction is its own
     *    ledger row, mirroring sender and receiver.
     *  - The amount is re-read from the ORIGINAL transaction under lock, never
     *    taken from caller input, so a reversal cannot move a different sum from
     *    the one that was moved.
     *  - Direction is taken from the original row's sender/receiver rather than
     *    re-derived from the listing type. createTransaction() picks payer and payee
     *    based on whether the listing is an offer or a request, and re-deriving that
     *    here would risk reversing backwards if that logic ever changes.
     *  - Both user rows are locked in deterministic min/max id order, so two
     *    concurrent reversals involving overlapping members cannot deadlock.
     *  - Double reversal is blocked TWICE: an early guard on
     *    `reversal_transaction_id`, and a UNIQUE index on that column so a race
     *    cannot slip past the guard.
     *  - Balances may go negative. If the payee has already spent the credits, the
     *    correction still has to complete; the resulting negative balance is an
     *    explicit debt recorded in the ledger, exactly as the marketplace refund
     *    treats it.
     *
     * Recorded in `exchange_history` (which both members can already see) AND in
     * `org_audit_log` (durable, exportable, survives the exchange row).
     *
     * Scope note: this reverses. It does not re-post at a corrected figure — an
     * "amend" would be a second money path and is deliberately not built here. To
     * correct a figure: reverse, then create the exchange again at the right hours.
     *
     * @return array{ok: bool, error?: string, reversal_transaction_id?: int, amount?: float}
     */
    public static function reverseCompletedExchange(int $exchangeId, int $actorId, string $reason): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            return ['ok' => false, 'error' => 'REASON_REQUIRED'];
        }

        $caller = User::find($actorId);
        if (!self::callerHasStaffAuthority($caller)) {
            return ['ok' => false, 'error' => 'UNAUTHORIZED'];
        }

        $tenantId = TenantContext::getId();

        try {
            $result = DB::transaction(function () use ($exchangeId, $actorId, $reason, $tenantId): array {
                $locked = DB::table('exchange_requests')
                    ->where('id', $exchangeId)
                    ->where('tenant_id', $tenantId)
                    ->lockForUpdate()
                    ->first();

                if (!$locked) {
                    return ['ok' => false, 'error' => 'NOT_FOUND'];
                }

                // Idempotency: already reversed is a no-op, not an error, so a
                // retried request cannot produce a second compensating entry.
                if ($locked->reversal_transaction_id !== null) {
                    return [
                        'ok' => true,
                        'reversal_transaction_id' => (int) $locked->reversal_transaction_id,
                        'already_reversed' => true,
                    ];
                }

                if ((string) $locked->status !== self::STATUS_COMPLETED) {
                    return ['ok' => false, 'error' => 'NOT_COMPLETED'];
                }

                if ($locked->transaction_id === null) {
                    // Completed with no ledger row: nothing moved, so there is
                    // nothing to reverse and inventing an entry would be wrong.
                    return ['ok' => false, 'error' => 'NO_TRANSACTION'];
                }

                $original = DB::table('transactions')
                    ->where('id', $locked->transaction_id)
                    ->where('tenant_id', $tenantId)
                    ->where('status', 'completed')
                    ->lockForUpdate()
                    ->first();

                if (!$original) {
                    return ['ok' => false, 'error' => 'ORIGINAL_NOT_FOUND'];
                }

                $amount = round((float) $original->amount, 2);
                if ($amount <= 0) {
                    return ['ok' => false, 'error' => 'INVALID_AMOUNT'];
                }

                // The original moved payer → payee. The reversal moves it back.
                $originalPayerId = (int) $original->sender_id;
                $originalPayeeId = (int) $original->receiver_id;
                if ($originalPayerId <= 0 || $originalPayeeId <= 0) {
                    return ['ok' => false, 'error' => 'ORIGINAL_NOT_TWO_SIDED'];
                }

                // Deterministic lock order prevents deadlock against a concurrent
                // reversal or transfer touching the same two members.
                foreach ([min($originalPayerId, $originalPayeeId), max($originalPayerId, $originalPayeeId)] as $lockId) {
                    DB::table('users')
                        ->where('id', $lockId)
                        ->where('tenant_id', $tenantId)
                        ->lockForUpdate()
                        ->first();
                }

                $reversalId = (int) DB::table('transactions')->insertGetId([
                    'tenant_id' => $tenantId,
                    // Mirrored: the payee gives the credits back to the payer.
                    'sender_id' => $originalPayeeId,
                    'receiver_id' => $originalPayerId,
                    'acting_user_id' => $actorId,
                    'amount' => $amount,
                    'description' => '[Exchange Reversal] #' . $exchangeId . ': ' . $reason,
                    'transaction_type' => 'exchange_reversal',
                    'status' => 'completed',
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);

                // Deliberately allowed to go negative — see the docblock. A
                // correction that cannot complete because the payee already spent
                // the credits would leave the ledger permanently wrong.
                DB::table('users')->where('id', $originalPayeeId)->where('tenant_id', $tenantId)
                    ->decrement('balance', $amount);
                DB::table('users')->where('id', $originalPayerId)->where('tenant_id', $tenantId)
                    ->increment('balance', $amount);

                // The UNIQUE index on reversal_transaction_id is what makes this
                // safe against a racing second reversal.
                DB::table('exchange_requests')
                    ->where('id', $exchangeId)
                    ->where('tenant_id', $tenantId)
                    ->update([
                        'reversal_transaction_id' => $reversalId,
                        'reversed_at' => now(),
                        'reversed_by' => $actorId,
                        'reversal_reason' => mb_substr($reason, 0, 500),
                        'updated_at' => now(),
                    ]);

                self::logHistory(
                    $exchangeId,
                    'reversed',
                    $actorId,
                    'broker',
                    self::STATUS_COMPLETED,
                    self::STATUS_COMPLETED,
                    sprintf('Reversed %.2f hours (transaction #%d). %s', $amount, $reversalId, $reason)
                );

                // Durable, exportable, and survives deletion of the exchange row —
                // exchange_history cascades with its parent.
                app(AuditLogService::class)->logAction(
                    $tenantId,
                    'exchange_reversed',
                    $actorId,
                    [
                        'exchange_id' => $exchangeId,
                        'original_transaction_id' => (int) $original->id,
                        'reversal_transaction_id' => $reversalId,
                        'amount' => $amount,
                        'payer_restored' => $originalPayerId,
                        'payee_debited' => $originalPayeeId,
                        'reason' => $reason,
                    ],
                    null,
                    $originalPayerId,
                );

                return [
                    'ok' => true,
                    'reversal_transaction_id' => $reversalId,
                    'amount' => $amount,
                ];
            });
        } catch (\Throwable $e) {
            Log::error('Exchange reversal failed', ['exchange_id' => $exchangeId, 'error' => $e->getMessage()]);
            return ['ok' => false, 'error' => 'REVERSAL_FAILED'];
        }

        return $result;
    }

    private static function logHistory(
        int $exchangeId,
        string $action,
        ?int $actorId,
        string $actorRole,
        ?string $oldStatus = null,
        ?string $newStatus = null,
        ?string $notes = null
    ): void {
        ExchangeHistory::create([
            'exchange_id' => $exchangeId,
            'tenant_id'   => TenantContext::getId(),
            'action'      => $action,
            'actor_id'    => $actorId,
            'actor_role'  => $actorRole,
            'old_status'  => $oldStatus,
            'new_status'  => $newStatus,
            'notes'       => $notes,
            'created_at'  => now(),
        ]);
    }

    /**
     * Check if an exchange needs broker approval (static).
     *
     * Checks TWO layers:
     * 1. User-level safeguarding: either party's active preference requires
     *    broker approval, evaluated separately from message monitoring
     * 2. Listing-level risk: listing risk tags, hours threshold, or global broker approval config
     */
    private static function needsBrokerApproval(int $listingId, float $proposedHours, ?int $requesterId = null, ?int $providerId = null): bool
    {
        $tenantId = TenantContext::getId();

        // LAYER 1: User-level safeguarding flags (always checked, even if exchange workflow is "off")
        // A vulnerable person's exchanges MUST go through broker regardless of tenant config
        try {
            $userIds = array_values(array_unique(array_filter([$requesterId, $providerId])));
            foreach ($userIds as $userId) {
                if (SafeguardingTriggerService::requiresBrokerApproval((int) $userId, $tenantId)) {
                    return true;
                }
            }
        } catch (\Throwable $e) {
            return true;
            // A safety-preference lookup failure requires broker review.
        }

        // LAYER 2: Listing-level and tenant-level config checks
        try {
            $configService = app(BrokerControlConfigService::class);
            if (!$configService->isExchangeWorkflowEnabled()) {
                return false;
            }

            $config = $configService->getConfig('exchange_workflow');

            if (empty($config['require_broker_approval'])) {
                return false;
            }

            if (!empty($config['auto_approve_low_risk'])) {
                $isHighRisk = DB::table('listing_risk_tags')
                    ->where('listing_id', $listingId)
                    ->where('tenant_id', $tenantId)
                    ->whereIn('risk_level', ['high', 'critical'])
                    ->exists();

                if ($isHighRisk) {
                    return true;
                }

                $requiresApproval = DB::table('listing_risk_tags')
                    ->where('listing_id', $listingId)
                    ->where('tenant_id', $tenantId)
                    ->where('requires_approval', true)
                    ->exists();

                if ($requiresApproval) {
                    return true;
                }

                $maxHours = (float) ($config['max_hours_without_approval'] ?? 4);
                if ($proposedHours > $maxHours) {
                    return true;
                }

                return false;
            }

            return true;
        } catch (\Exception $e) {
            // If config service not available, default to no broker approval
            return false;
        }
    }
}
