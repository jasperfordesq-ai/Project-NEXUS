<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Models\Notification;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Support\UserDisplayName;

/**
 * FederatedConnectionService — Manages cross-tenant connection requests between federated members.
 *
 * Uses the federation_connections table to track connection requests
 * across different tenant boundaries.
 */
class FederatedConnectionService
{
    public function __construct()
    {
    }

    /**
     * Send a cross-tenant connection request.
     */
    public function sendRequest(int $requesterId, int $receiverId, int $receiverTenantId, ?string $message = null): array
    {
        $requesterTenantId = TenantContext::getId();

        // Store plain text; React/Blade output layers escape it for their contexts.
        $message = $message ? mb_substr(trim($message), 0, 1000) : null;

        if ($requesterId === $receiverId && $requesterTenantId === $receiverTenantId) {
            return ['success' => false, 'error' => __('api.cannot_connect_with_yourself')];
        }

        $requester = DB::selectOne(
            "SELECT id FROM users WHERE id = ? AND tenant_id = ? AND status = 'active'",
            [$requesterId, $requesterTenantId]
        );
        if (!$requester) {
            return ['success' => false, 'error' => __('api.cannot_send_request_to_user')];
        }

        $receiver = DB::selectOne(
            "SELECT u.id, fus.federation_optin, fus.messaging_enabled_federated
             FROM users u
             JOIN federation_user_settings fus ON fus.user_id = u.id
             WHERE u.id = ? AND u.tenant_id = ? AND u.status = 'active'",
            [$receiverId, $receiverTenantId]
        );
        if (!$receiver || empty($receiver->federation_optin) || empty($receiver->messaging_enabled_federated)) {
            return ['success' => false, 'error' => __('api.cannot_send_request_to_user')];
        }

        $partnership = FederationPartnershipService::getPartnership($requesterTenantId, $receiverTenantId);
        if (!$partnership || $partnership['status'] !== 'active' || empty($partnership['profiles_enabled'])) {
            return ['success' => false, 'error' => __('api.cannot_send_request_to_user')];
        }

        $decision = app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
            $requesterId,
            $requesterTenantId,
            $receiverId,
            $receiverTenantId,
            'federated_connection_request',
        );
        if (! $decision->isAllowed()) {
            $error = MessageService::buildSafeguardingError([
                'status' => $decision->status,
                'code' => $decision->code,
                'required_vetting_types' => $decision->requiredAttestationCodes,
                'required_vetting_labels' => $decision->requiredAttestationLabels,
                'can_request_coordinator' => $decision->canRequestCoordinator,
            ]);
            return [
                'success' => false,
                'error_code' => $decision->code,
                'retryable' => $decision->isUnavailable(),
                'error' => (string) $error['message'],
            ];
        }

        // Check if connection already exists (in either direction)
        $existing = DB::selectOne(
            "SELECT id, status FROM federation_connections
             WHERE (requester_user_id = ? AND requester_tenant_id = ? AND receiver_user_id = ? AND receiver_tenant_id = ?)
                OR (requester_user_id = ? AND requester_tenant_id = ? AND receiver_user_id = ? AND receiver_tenant_id = ?)",
            [
                $requesterId, $requesterTenantId, $receiverId, $receiverTenantId,
                $receiverId, $receiverTenantId, $requesterId, $requesterTenantId,
            ]
        );

        if ($existing) {
            if ($existing->status === 'accepted') {
                return ['success' => false, 'error' => __('api.connection_already_exists')];
            }
            if ($existing->status === 'pending') {
                return ['success' => false, 'error' => __('api.connection_request_pending')];
            }
        }

        try {
            // If a previous rejected request exists, delete it so a new one can be sent
            if ($existing && $existing->status === 'rejected') {
                DB::delete(
                    "DELETE FROM federation_connections
                     WHERE id = ? AND requester_user_id = ? AND requester_tenant_id = ?
                       AND receiver_user_id = ? AND receiver_tenant_id = ?",
                    [$existing->id, $requesterId, $requesterTenantId, $receiverId, $receiverTenantId]
                );
            }

            DB::insert(
                "INSERT INTO federation_connections (requester_user_id, requester_tenant_id, receiver_user_id, receiver_tenant_id, status, message, created_at)
                 VALUES (?, ?, ?, ?, 'pending', ?, NOW())",
                [$requesterId, $requesterTenantId, $receiverId, $receiverTenantId, $message]
            );

            $connectionId = (int) DB::getPdo()->lastInsertId();

            Log::info('[FederatedConnection] Request sent', [
                'connection_id' => $connectionId,
                'requester' => $requesterId,
                'receiver' => $receiverId,
                'receiver_tenant' => $receiverTenantId,
            ]);

            // Notify the recipient (cross-tenant bell notification)
            try {
                $sender = DB::selectOne(
                    "SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?",
                    [$requesterId, $requesterTenantId]
                );
                $community = DB::selectOne(
                    "SELECT name FROM tenants WHERE id = ?",
                    [$requesterTenantId]
                );
                $senderName = $sender ? UserDisplayName::resolve($sender) : __('emails.common.fallback_someone');
                $communityName = $community->name ?? __('emails.common.fallback_partner_community');

                // Render the bell message in the RECEIVER's preferred locale
                // (cross-tenant: look up their preferred_language by id+tenant).
                $receiver = DB::selectOne(
                    "SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                    [$receiverId, $receiverTenantId]
                );

                LocaleContext::withLocale($receiver, function () use ($receiverId, $senderName, $communityName, $receiverTenantId) {
                    Notification::createNotification(
                        $receiverId,
                        __('svc_notifications.federation.connection_request', ['sender' => $senderName, 'community' => $communityName]),
                        '/connections',
                        'federation_connection',
                        true,
                        $receiverTenantId
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($receiverId), 'federation_connection', __('svc_notifications.federation.connection_request', ['sender' => $senderName, 'community' => $communityName]), '/connections');
                });
            } catch (\Exception $notifEx) {
                Log::warning('[FederatedConnection] sendRequest notification failed', [
                    'error' => $notifEx->getMessage(),
                ]);
            }

            try {
                FederationEmailService::sendConnectionRequestNotification(
                    $receiverId,
                    $requesterId,
                    $requesterTenantId,
                    $receiverTenantId
                );
            } catch (\Exception $emailEx) {
                Log::warning('[FederatedConnection] sendRequest email notification failed', [
                    'connection_id' => $connectionId,
                    'requester_tenant_id' => $requesterTenantId,
                    'receiver_tenant_id' => $receiverTenantId,
                    'error' => $emailEx->getMessage(),
                ]);
            }

            return ['success' => true, 'connection_id' => $connectionId];
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] sendRequest failed', ['error' => $e->getMessage()]);
            return ['success' => false, 'error' => __('api.connection_send_failed')];
        }
    }

    /**
     * Accept a pending connection request.
     */
    public function acceptRequest(int $connectionId, int $userId): array
    {
        $tenantId = TenantContext::getId();
        $connection = DB::selectOne(
            "SELECT * FROM federation_connections WHERE id = ? AND receiver_user_id = ? AND receiver_tenant_id = ? AND status = 'pending'",
            [$connectionId, $userId, $tenantId]
        );

        if (!$connection) {
            return ['success' => false, 'error' => __('api.connection_request_not_found_or_processed')];
        }

        $decision = app(SafeguardingInteractionPolicy::class)->evaluateCrossTenantContact(
            (int) $connection->requester_user_id,
            (int) $connection->requester_tenant_id,
            $userId,
            (int) $tenantId,
            'federated_connection_accept',
        );
        if (! $decision->isAllowed()) {
            $error = MessageService::buildSafeguardingError([
                'status' => $decision->status,
                'code' => $decision->code,
                'required_vetting_types' => $decision->requiredAttestationCodes,
                'required_vetting_labels' => $decision->requiredAttestationLabels,
                'can_request_coordinator' => $decision->canRequestCoordinator,
            ]);

            return [
                'success' => false,
                'error_code' => $decision->code,
                'retryable' => $decision->isUnavailable(),
                'error' => (string) $error['message'],
            ];
        }

        try {
            DB::update(
                "UPDATE federation_connections
                 SET status = 'accepted', updated_at = NOW()
                 WHERE id = ? AND receiver_user_id = ? AND receiver_tenant_id = ? AND status = 'pending'",
                [$connectionId, $userId, $tenantId]
            );

            Log::info('[FederatedConnection] Request accepted', [
                'connection_id' => $connectionId,
                'accepted_by' => $userId,
            ]);

            // Notify the original requester (cross-tenant bell notification)
            try {
                $accepter = DB::selectOne(
                    "SELECT first_name, last_name FROM users WHERE id = ? AND tenant_id = ?",
                    [$userId, $tenantId]
                );
                $accepterName = $accepter ? UserDisplayName::resolve($accepter) : __('emails.common.fallback_someone');

                // Render the bell message in the ORIGINAL REQUESTER's preferred locale
                // (cross-tenant: they live on connection->requester_tenant_id).
                $requester = DB::selectOne(
                    "SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                    [(int) $connection->requester_user_id, (int) $connection->requester_tenant_id]
                );

                LocaleContext::withLocale($requester, function () use ($connection, $accepterName) {
                    Notification::createNotification(
                        (int) $connection->requester_user_id,
                        __('svc_notifications.federation.connection_accepted', ['name' => $accepterName]),
                        '/connections',
                        'federation_connection',
                        false,
                        (int) $connection->requester_tenant_id
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $connection->requester_user_id), 'federation_connection', __('svc_notifications.federation.connection_accepted', ['name' => $accepterName]), '/connections');
                });
            } catch (\Exception $notifEx) {
                Log::warning('[FederatedConnection] acceptRequest notification failed', [
                    'error' => $notifEx->getMessage(),
                ]);
            }

            try {
                FederationEmailService::sendConnectionAcceptedNotification(
                    (int) $connection->requester_user_id,
                    $userId,
                    $tenantId,
                    (int) $connection->requester_tenant_id
                );
            } catch (\Exception $emailEx) {
                Log::warning('[FederatedConnection] acceptRequest email notification failed', [
                    'connection_id' => $connectionId,
                    'requester_tenant_id' => (int) $connection->requester_tenant_id,
                    'receiver_tenant_id' => $tenantId,
                    'error' => $emailEx->getMessage(),
                ]);
            }

            return ['success' => true, 'connection_id' => $connectionId];
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] acceptRequest failed', ['error' => $e->getMessage()]);
            return ['success' => false, 'error' => __('api.connection_accept_failed')];
        }
    }

    /**
     * Reject a pending connection request.
     */
    public function rejectRequest(int $connectionId, int $userId): array
    {
        $tenantId = TenantContext::getId();
        $connection = DB::selectOne(
            "SELECT * FROM federation_connections WHERE id = ? AND receiver_user_id = ? AND receiver_tenant_id = ? AND status = 'pending'",
            [$connectionId, $userId, $tenantId]
        );

        if (!$connection) {
            return ['success' => false, 'error' => __('api.connection_request_not_found_or_processed')];
        }

        try {
            DB::update(
                "UPDATE federation_connections
                 SET status = 'rejected', updated_at = NOW()
                 WHERE id = ? AND receiver_user_id = ? AND receiver_tenant_id = ? AND status = 'pending'",
                [$connectionId, $userId, $tenantId]
            );

            Log::info('[FederatedConnection] Request rejected', [
                'connection_id' => $connectionId,
                'rejected_by' => $userId,
            ]);

            // Notify the original requester (cross-tenant bell notification)
            try {
                // Render the bell message in the ORIGINAL REQUESTER's preferred locale
                // (cross-tenant: they live on connection->requester_tenant_id).
                $requester = DB::selectOne(
                    "SELECT preferred_language FROM users WHERE id = ? AND tenant_id = ?",
                    [(int) $connection->requester_user_id, (int) $connection->requester_tenant_id]
                );

                LocaleContext::withLocale($requester, function () use ($connection) {
                    Notification::createNotification(
                        (int) $connection->requester_user_id,
                        __('svc_notifications.federation.connection_declined'),
                        '/connections',
                        'federation_connection',
                        false,
                        (int) $connection->requester_tenant_id
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ((int) $connection->requester_user_id), 'federation_connection', __('svc_notifications.federation.connection_declined'), '/connections');
                });
            } catch (\Exception $notifEx) {
                Log::warning('[FederatedConnection] rejectRequest notification failed', [
                    'error' => $notifEx->getMessage(),
                ]);
            }

            return ['success' => true, 'connection_id' => $connectionId];
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] rejectRequest failed', ['error' => $e->getMessage()]);
            return ['success' => false, 'error' => __('api.connection_reject_failed')];
        }
    }

    /**
     * Remove an existing connection.
     */
    public function removeConnection(int $connectionId, int $userId): array
    {
        $tenantId = TenantContext::getId();
        $connection = DB::selectOne(
            "SELECT * FROM federation_connections WHERE id = ? AND ((requester_user_id = ? AND requester_tenant_id = ?) OR (receiver_user_id = ? AND receiver_tenant_id = ?))",
            [$connectionId, $userId, $tenantId, $userId, $tenantId]
        );

        if (!$connection) {
            return ['success' => false, 'error' => __('api.connection_not_found')];
        }

        try {
            DB::delete(
                "DELETE FROM federation_connections
                 WHERE id = ? AND ((requester_user_id = ? AND requester_tenant_id = ?)
                    OR (receiver_user_id = ? AND receiver_tenant_id = ?))",
                [$connectionId, $userId, $tenantId, $userId, $tenantId]
            );

            Log::info('[FederatedConnection] Connection removed', [
                'connection_id' => $connectionId,
                'removed_by' => $userId,
            ]);

            return ['success' => true];
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] removeConnection failed', ['error' => $e->getMessage()]);
            return ['success' => false, 'error' => __('api.connection_remove_failed')];
        }
    }

    /**
     * Get connection status between two users across tenants.
     */
    public function getStatus(int $userId, int $otherUserId, int $otherTenantId): array
    {
        $tenantId = TenantContext::getId();

        $connection = DB::selectOne(
            "SELECT id, status, requester_user_id, requester_tenant_id, receiver_user_id, receiver_tenant_id, created_at
             FROM federation_connections
             WHERE (requester_user_id = ? AND requester_tenant_id = ? AND receiver_user_id = ? AND receiver_tenant_id = ?)
                OR (requester_user_id = ? AND requester_tenant_id = ? AND receiver_user_id = ? AND receiver_tenant_id = ?)",
            [
                $userId, $tenantId, $otherUserId, $otherTenantId,
                $otherUserId, $otherTenantId, $userId, $tenantId,
            ]
        );

        if (!$connection) {
            return ['status' => 'none', 'connection_id' => null];
        }

        $direction = ((int) $connection->requester_user_id === $userId && (int) $connection->requester_tenant_id === $tenantId)
            ? 'outgoing'
            : 'incoming';

        return [
            'status' => $connection->status,
            'connection_id' => (int) $connection->id,
            'direction' => $direction,
            'created_at' => $connection->created_at,
        ];
    }

    /**
     * Get connections for a user, filtered by status.
     */
    public function getConnections(int $userId, string $statusFilter = 'accepted', int $limit = 50, int $offset = 0): array
    {
        $tenantId = TenantContext::getId();

        // Support directional pending filters from frontend tabs
        $directionFilter = null;
        if ($statusFilter === 'pending_received') {
            $statusFilter = 'pending';
            $directionFilter = 'incoming';
        } elseif ($statusFilter === 'pending_sent') {
            $statusFilter = 'pending';
            $directionFilter = 'outgoing';
        }

        $validStatuses = ['pending', 'accepted', 'rejected'];
        if (!in_array($statusFilter, $validStatuses, true)) {
            $statusFilter = 'accepted';
        }

        $limit = min(max($limit, 1), 100);
        $offset = max($offset, 0);

        try {
            $sql = "SELECT fc.id, fc.status, fc.message, fc.created_at, fc.updated_at,
                        fc.requester_user_id, fc.requester_tenant_id,
                        fc.receiver_user_id, fc.receiver_tenant_id,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.first_name ELSE qu.first_name END as other_first_name,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.last_name ELSE qu.last_name END as other_last_name,
                        -- These MUST mirror the CASE above: the 'other' party is the
                        -- requester on an outgoing connection, so taking the
                        -- receiver's columns unconditionally would label an
                        -- outgoing connection with the wrong account's type.
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.profile_type ELSE qu.profile_type END as other_profile_type,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.organization_name ELSE qu.organization_name END as other_organization_name,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.avatar_url ELSE qu.avatar_url END as other_avatar,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN ru.id ELSE qu.id END as other_user_id,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN fc.receiver_tenant_id ELSE fc.requester_tenant_id END as other_tenant_id,
                        CASE WHEN fc.requester_user_id = ? AND fc.requester_tenant_id = ? THEN rt.name ELSE qt.name END as other_tenant_name
                 FROM federation_connections fc
                 LEFT JOIN users qu ON fc.requester_user_id = qu.id AND fc.requester_tenant_id = qu.tenant_id
                 LEFT JOIN users ru ON fc.receiver_user_id = ru.id AND fc.receiver_tenant_id = ru.tenant_id
                 LEFT JOIN tenants qt ON fc.requester_tenant_id = qt.id
                 LEFT JOIN tenants rt ON fc.receiver_tenant_id = rt.id
                 WHERE ";

            // One pair per CASE above, in SQL order. Every pair is identical, so
            // only the COUNT matters -- but it must match, or every placeholder
            // after the mismatch binds the wrong value.
            $params = [
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
                $userId, $tenantId,
            ];

            // Apply directional filter for pending tabs
            if ($directionFilter === 'incoming') {
                $sql .= "fc.receiver_user_id = ? AND fc.receiver_tenant_id = ? AND fc.status = ?";
                $params[] = $userId;
                $params[] = $tenantId;
            } elseif ($directionFilter === 'outgoing') {
                $sql .= "fc.requester_user_id = ? AND fc.requester_tenant_id = ? AND fc.status = ?";
                $params[] = $userId;
                $params[] = $tenantId;
            } else {
                $sql .= "((fc.requester_user_id = ? AND fc.requester_tenant_id = ?)
                          OR (fc.receiver_user_id = ? AND fc.receiver_tenant_id = ?)) AND fc.status = ?";
                $params[] = $userId;
                $params[] = $tenantId;
                $params[] = $userId;
                $params[] = $tenantId;
            }
            $params[] = $statusFilter;

            $sql .= " ORDER BY fc.created_at DESC LIMIT ? OFFSET ?";
            $params[] = $limit;
            $params[] = $offset;

            $rows = DB::select($sql, $params);

            // Map field names to match frontend FederationConnection interface
            return array_map(function ($row) use ($userId, $tenantId) {
                $direction = ($row->requester_user_id == $userId && $row->requester_tenant_id == $tenantId) ? 'outgoing' : 'incoming';
                return [
                    'id' => (int) $row->id,
                    'user_id' => (int) $row->other_user_id,
                    'name' => UserDisplayName::resolvePrefixed($row, 'other_'),
                    'avatar_url' => $row->other_avatar,
                    'tenant_id' => (int) $row->other_tenant_id,
                    'tenant_name' => $row->other_tenant_name,
                    'status' => $row->status,
                    'direction' => $direction,
                    'message' => $row->message,
                    'created_at' => $row->created_at,
                    'updated_at' => $row->updated_at,
                ];
            }, $rows);
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] getConnections failed', ['error' => $e->getMessage()]);
            return [];
        }
    }

    /**
     * Get count of pending incoming connection requests for a user.
     */
    public function getPendingCount(int $userId): int
    {
        try {
            $tenantId = TenantContext::getId();
            $row = DB::selectOne(
                "SELECT COUNT(*) as cnt
                 FROM federation_connections
                 WHERE receiver_user_id = ? AND receiver_tenant_id = ? AND status = 'pending'",
                [$userId, $tenantId]
            );
            return (int) ($row->cnt ?? 0);
        } catch (\Exception $e) {
            Log::error('[FederatedConnection] getPendingCount failed', ['error' => $e->getMessage()]);
            return 0;
        }
    }
}
