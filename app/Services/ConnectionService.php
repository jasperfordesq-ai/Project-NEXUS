<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Events\ConnectionAccepted;
use App\Events\ConnectionRequested;
use App\Core\TenantContext;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * ConnectionService — Laravel DI-based service for user connections.
 *
 * All queries are tenant-scoped automatically via the HasTenantScope trait.
 */
class ConnectionService
{
    public function __construct(
        private readonly Connection $connection,
    ) {}

    /**
     * Get connections for a user with cursor-based pagination.
     *
     * @param array{status?: string, cursor?: string|null, limit?: int} $filters
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getAll(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $status = $filters['status'] ?? 'accepted';
        $cursor = $filters['cursor'] ?? null;

        $query = Connection::query()
            ->with([
                'requester:id,name,first_name,last_name,avatar_url,organization_name,profile_type,last_active_at,location,bio',
                'receiver:id,name,first_name,last_name,avatar_url,organization_name,profile_type,last_active_at,location,bio',
            ])
            ->where('status', $status);

        if ($status === 'pending') {
            // Show requests sent TO this user
            $query->where('receiver_id', $userId);
        } else {
            $query->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId));
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('id');

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        // Map to include the partner user info
        $result = $items->map(function (Connection $conn) use ($userId) {
            $data = $conn->toArray();
            $partner = $conn->requester_id === $userId
                ? $conn->receiver?->toArray()
                : $conn->requester?->toArray();
            $data['partner'] = $partner;
            $data['user'] = $partner;               // Alias: frontend expects 'user'
            $data['connection_id'] = $conn->id;      // Alias: frontend expects 'connection_id'
            return $data;
        })->filter(fn ($d) => $d['user'] !== null)->values()->all(); // drop deleted-account partners (frontend contract: user is non-null)

        return [
            'items'    => array_values($result),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Send a connection request.
     *
     * @throws \RuntimeException
     */
    public static function request(int $requesterId, int $receiverId): Connection
    {
        if ($requesterId === $receiverId) {
            throw new \RuntimeException(__('api.cannot_connect_with_yourself'));
        }

        // Check if either user has blocked the other
        $blocked = DB::table('user_blocks')
            ->where('tenant_id', TenantContext::getId())
            ->where(function ($q) use ($requesterId, $receiverId) {
                $q->where(function ($inner) use ($requesterId, $receiverId) {
                    $inner->where('user_id', $requesterId)->where('blocked_user_id', $receiverId);
                })->orWhere(function ($inner) use ($requesterId, $receiverId) {
                    $inner->where('user_id', $receiverId)->where('blocked_user_id', $requesterId);
                });
            })
            ->exists();
        if ($blocked) {
            throw new \RuntimeException(__('api.cannot_send_request_to_user'));
        }

        // Verify receiver exists in the same tenant
        $receiverTenantId = DB::table('users')->where('id', $receiverId)->value('tenant_id');
        $requesterTenantId = DB::table('users')->where('id', $requesterId)->value('tenant_id');
        if (!$receiverTenantId || !$requesterTenantId || $receiverTenantId !== $requesterTenantId) {
            throw new \RuntimeException('User not found');
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $requesterId,
            $receiverId,
            (int) $requesterTenantId,
            'connection_request',
        );

        $connection = DB::transaction(function () use ($requesterId, $receiverId) {
            // Lock both user rows (in consistent order to prevent deadlocks) to serialize
            // concurrent connection requests between the same pair of users
            $minId = min($requesterId, $receiverId);
            $maxId = max($requesterId, $receiverId);
            DB::table('users')->where('id', $minId)->lockForUpdate()->first();
            DB::table('users')->where('id', $maxId)->lockForUpdate()->first();

            // Check for existing connection in either direction
            $existing = Connection::query()
                ->where(function (Builder $q) use ($requesterId, $receiverId) {
                    $q->where(function (Builder $q2) use ($requesterId, $receiverId) {
                        $q2->where('requester_id', $requesterId)->where('receiver_id', $receiverId);
                    })->orWhere(function (Builder $q2) use ($requesterId, $receiverId) {
                        $q2->where('requester_id', $receiverId)->where('receiver_id', $requesterId);
                    });
                })
                ->first();

            if ($existing) {
                throw new \RuntimeException(__('api.connection_already_exists'));
            }

            $connection = new Connection([
                'requester_id' => $requesterId,
                'receiver_id'  => $receiverId,
                'status'       => 'pending',
            ]);

            $connection->save();

            return $connection->fresh(['requester', 'receiver']);
        });

        // Dispatch ConnectionRequested event AFTER the transaction has committed.
        // Wrapped in try/catch so a notification/broadcast failure never breaks
        // the connection creation itself.
        try {
            if ($connection->requester && $connection->receiver) {
                event(new ConnectionRequested(
                    connectionModel: $connection,
                    requester: $connection->requester,
                    target: $connection->receiver,
                    tenantId: (int) $connection->requester->tenant_id,
                ));
            }
        } catch (\Throwable $e) {
            Log::error('Failed to dispatch ConnectionRequested event', [
                'connection_id' => $connection->id,
                'requester_id'  => $requesterId,
                'receiver_id'   => $receiverId,
                'error'         => $e->getMessage(),
            ]);
        }

        return $connection;
    }

    /**
     * Accept a pending connection request.
     *
     * @throws \RuntimeException
     */
    public static function accept(int $connectionId, int $userId): Connection
    {
        $connection = DB::transaction(function () use ($connectionId, $userId) {
            /** @var Connection $connection */
            $connection = Connection::query()->lockForUpdate()->findOrFail($connectionId);

            if ($connection->receiver_id !== $userId) {
                throw new \RuntimeException(__('api.only_receiver_can_accept'));
            }

            if ($connection->status !== 'pending') {
                throw new \RuntimeException(__('api.connection_not_pending'));
            }

            app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
                (int) $connection->requester_id,
                (int) $connection->receiver_id,
                (int) TenantContext::getId(),
                'connection_accept',
            );

            $connection->status = 'accepted';
            $connection->save();

            return $connection->fresh(['requester', 'receiver']);
        });

        // Dispatch ConnectionAccepted AFTER commit so failed broadcasts
        // can't roll back the status transition.
        try {
            $tenantId = (int) ($connection->requester?->tenant_id
                ?? $connection->receiver?->tenant_id
                ?? 0);
            if ($tenantId > 0 && $connection->requester && $connection->receiver) {
                ConnectionAccepted::dispatch($connection, $connection->requester, $connection->receiver, $tenantId);
            }
        } catch (\Throwable $e) {
            Log::error('Failed to dispatch ConnectionAccepted event', [
                'connection_id' => $connection->id,
                'error'         => $e->getMessage(),
            ]);
        }

        return $connection;
    }

    /**
     * Remove/cancel a connection.
     */
    public static function destroy(int $connectionId, int $userId): bool
    {
        /** @var Connection|null $connection */
        $connection = Connection::query()
            ->where('id', $connectionId)
            ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
            ->first();

        if (! $connection) {
            return false;
        }

        $connection->delete();

        return true;
    }

    /**
     * Get a single connection by ID, verifying the user is a participant.
     */
    public static function getById(int $connectionId, int $userId): ?array
    {
        /** @var Connection|null $connection */
        $connection = Connection::query()
            ->with(['requester:id,first_name,last_name,profile_type,organization_name,avatar_url', 'receiver:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('id', $connectionId)
            ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
            ->first();

        if (! $connection) {
            return null;
        }

        return $connection->toArray();
    }

    /**
     * Get pending connection request counts for a user.
     *
     * @return array{received: int, sent: int, total_friends: int}
     */
    public static function getPendingCounts(int $userId): array
    {
        $received = Connection::query()
            ->where('receiver_id', $userId)
            ->where('status', 'pending')
            ->count();

        $sent = Connection::query()
            ->where('requester_id', $userId)
            ->where('status', 'pending')
            ->count();

        $totalFriends = Connection::query()
            ->where('status', 'accepted')
            ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId))
            ->count();

        return [
            'received'      => $received,
            'sent'          => $sent,
            'total_friends' => $totalFriends,
        ];
    }

    /**
     * Get connection status between two users.
     *
     * @return array{status: string, connection_id: int|null, direction: string|null}
     */
    public static function getStatus(int $userId, int $otherUserId): array
    {
        /** @var Connection|null $connection */
        $connection = Connection::query()
            ->where(function (Builder $q) use ($userId, $otherUserId) {
                $q->where(function (Builder $q2) use ($userId, $otherUserId) {
                    $q2->where('requester_id', $userId)->where('receiver_id', $otherUserId);
                })->orWhere(function (Builder $q2) use ($userId, $otherUserId) {
                    $q2->where('requester_id', $otherUserId)->where('receiver_id', $userId);
                });
            })
            ->first();

        if (! $connection) {
            return ['status' => 'none', 'connection_id' => null, 'direction' => null];
        }

        $direction = null;
        $status = $connection->status;

        if ($status === 'pending') {
            $direction = ($connection->requester_id === $userId) ? 'sent' : 'received';
            $status = "pending_{$direction}";
        } elseif ($status === 'accepted') {
            $status = 'connected';
        }

        return [
            'status'        => $status,
            'connection_id' => $connection->id,
            'direction'     => $direction,
        ];
    }

    /**
     * Send a connection request.
     *
     * Accepts either (int $requesterId, int $receiverId) returning bool,
     * or (int $requesterId, array $data) returning array (legacy).
     *
     * @param int       $requesterId Requesting user
     * @param int|array $receiverIdOrData Receiver user ID (int) or data array with 'user_id'
     * @return bool|array
     */
    public static function sendRequest(int $requesterId, int|array $receiverIdOrData): bool|array
    {
        // New signature: sendRequest(int, int) -> bool
        if (is_int($receiverIdOrData)) {
            if ($requesterId === $receiverIdOrData) {
                return false;
            }
            try {
                self::request($requesterId, $receiverIdOrData);
                return true;
            } catch (\RuntimeException $e) {
                Log::warning('[ConnectionService] sendRequest failed: ' . $e->getMessage());
                return false;
            }
        }

        // Legacy signature: sendRequest(int, array) -> array
        $data = $receiverIdOrData;
        $receiverId = (int) ($data['user_id'] ?? 0);

        if (! $receiverId) {
            throw new \RuntimeException(__('api.user_id_required'));
        }

        $connection = self::request($requesterId, $receiverId);

        $status = self::getStatus($requesterId, $receiverId);

        return [
            'status'        => $status['status'],
            'connection_id' => $status['connection_id'],
            'message'       => $status['status'] === 'connected'
                ? 'Connection accepted (they had already sent you a request)'
                : 'Connection request sent',
        ];
    }

    /**
     * Delete a connection (alias for destroy, used by controller).
     */
    public static function delete(int $connectionId, int $userId): bool
    {
        return self::destroy($connectionId, $userId);
    }

    /**
     * Get connections for a user with filtering.
     *
     * Supports status filters: 'accepted', 'pending_sent', 'pending_received'.
     *
     * @return array{items: array, cursor: string|null, has_more: bool}
     */
    public static function getConnections(int $userId, array $filters = []): array
    {
        $limit = min((int) ($filters['limit'] ?? 20), 100);
        $status = $filters['status'] ?? 'accepted';
        $cursor = $filters['cursor'] ?? null;

        $query = Connection::query()
            ->with([
                'requester:id,name,first_name,last_name,avatar_url,organization_name,profile_type,last_active_at,location,bio',
                'receiver:id,name,first_name,last_name,avatar_url,organization_name,profile_type,last_active_at,location,bio',
            ]);

        if ($status === 'pending_sent') {
            $query->where('status', 'pending')
                  ->where('requester_id', $userId);
        } elseif ($status === 'pending_received') {
            $query->where('status', 'pending')
                  ->where('receiver_id', $userId);
        } elseif ($status === 'pending') {
            $query->where('status', 'pending')
                  ->where('receiver_id', $userId);
        } else {
            $query->where('status', $status)
                  ->where(fn (Builder $q) => $q->where('requester_id', $userId)->orWhere('receiver_id', $userId));
        }

        if ($cursor !== null) {
            $cursorId = base64_decode($cursor, true);
            if ($cursorId !== false) {
                $query->where('id', '<', (int) $cursorId);
            }
        }

        $query->orderByDesc('id');

        $items = $query->limit($limit + 1)->get();
        $hasMore = $items->count() > $limit;
        if ($hasMore) {
            $items->pop();
        }

        $result = $items->map(function (Connection $conn) use ($userId) {
            $data = $conn->toArray();
            $partner = $conn->requester_id === $userId
                ? $conn->receiver?->toArray()
                : $conn->requester?->toArray();
            $data['partner'] = $partner;
            $data['user'] = $partner;
            $data['connection_id'] = $conn->id;
            return $data;
        })->filter(fn ($d) => $d['user'] !== null)->values()->all(); // drop deleted-account partners (frontend contract: user is non-null)

        return [
            'items'    => array_values($result),
            'cursor'   => $hasMore && $items->isNotEmpty() ? base64_encode((string) $items->last()->id) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Accept a pending connection request (returns bool).
     */
    public static function acceptRequest(int $connectionId, int $userId): bool
    {
        try {
            self::accept($connectionId, $userId);
            return true;
        } catch (\Throwable $e) {
            Log::warning('[ConnectionService] acceptRequest failed', ['connection_id' => $connectionId, 'error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Reject a pending connection request (deletes it).
     */
    public static function rejectRequest(int $connectionId, int $userId): bool
    {
        /** @var Connection|null $connection */
        $connection = Connection::query()
            ->where('id', $connectionId)
            ->where('receiver_id', $userId)
            ->where('status', 'pending')
            ->first();

        if (! $connection) {
            return false;
        }

        $connection->delete();
        return true;
    }

    /**
     * Remove an existing connection (alias for destroy).
     */
    public static function removeConnection(int $connectionId, int $userId): bool
    {
        return self::destroy($connectionId, $userId);
    }
}
