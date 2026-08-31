<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * RealtimeService — Laravel DI-based service for realtime/WebSocket operations.
 *
 * Provides Pusher broadcasting configuration and channel management.
 * Self-contained — no legacy delegation.
 */
class RealtimeService
{
    /**
     * Get the realtime/Pusher configuration (safe for frontend).
     */
    public function getConfig(): array
    {
        return [
            'driver'    => config('broadcasting.default', 'pusher'),
            'key'       => config('broadcasting.connections.pusher.key', ''),
            'cluster'   => config('broadcasting.connections.pusher.options.cluster', 'eu'),
            'encrypted' => true,
        ];
    }

    /**
     * Get Pusher configuration for frontend initialization.
     */
    public function getFrontendConfig(): array
    {
        return [
            'key'          => config('broadcasting.connections.pusher.key', ''),
            'cluster'      => config('broadcasting.connections.pusher.options.cluster', 'eu'),
            'authEndpoint' => '/api/pusher/auth',
            'enabled'      => ! empty(config('broadcasting.connections.pusher.key')),
        ];
    }

    /**
     * Broadcast an event to a channel.
     */
    public function broadcast(string $channel, string $event, array $data = []): bool
    {
        try {
            $pusher = new \Pusher\Pusher(
                config('broadcasting.connections.pusher.key'),
                config('broadcasting.connections.pusher.secret'),
                config('broadcasting.connections.pusher.app_id'),
                config('broadcasting.connections.pusher.options', [])
            );

            $pusher->trigger($channel, $event, $data);
            return true;
        } catch (\Throwable $e) {
            Log::error('RealtimeService::broadcast failed', [
                'channel' => $channel,
                'event'   => $event,
                'error'   => $e->getMessage(),
            ]);
            return false;
        }
    }

    /**
     * Build a private channel name scoped to a tenant.
     */
    public function tenantChannel(int $tenantId, string $suffix): string
    {
        return "private-tenant.{$tenantId}.{$suffix}";
    }

    /**
     * Broadcast a notification to a user's private channel.
     *
     * Uses tenant-scoped channel naming to match the React frontend
     * PusherContext subscription format: private-tenant.{tenantId}.user.{userId}
     */
    public static function broadcastNotification(int $userId, array $data): bool
    {
        try {
            $service = new self();
            $tenantId = \App\Core\TenantContext::getId();
            return $service->broadcast("private-tenant.{$tenantId}.user.{$userId}", 'notification', $data);
        } catch (\Throwable $e) {
            Log::error('RealtimeService::broadcastNotification failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Broadcast a notification via Pusher AND send FCM push to mobile devices.
     *
     * Combines both delivery channels in a single call. Native delivery goes
     * through the canonical dispatcher so privacy, route validation, recipient
     * locale and duplicate suppression cannot be bypassed. The $data array
     * should include 'message' and 'type'; `url` is the optional tap target.
     */
    public static function broadcastAndPush(int $userId, string $title, array $data): bool
    {
        // Pusher real-time broadcast
        $pusherResult = self::broadcastNotification($userId, $data);

        // Canonical web/native fan-out. If a legacy caller also invokes
        // fanOutPush() directly, its per-(user,type,link) claim suppresses the
        // duplicate rather than showing two device alerts.
        try {
            NotificationDispatcher::fanOutPush(
                $userId,
                is_string($data['type'] ?? null) ? $data['type'] : 'notification',
                is_string($data['message'] ?? null) ? $data['message'] : $title,
                is_string($data['url'] ?? null) ? $data['url'] : null,
            );
        } catch (\Throwable $e) {
            Log::warning('RealtimeService::broadcastAndPush fan-out failed', ['error' => $e->getMessage()]);
        }

        return $pusherResult;
    }

    /**
     * Broadcast a live in-app refresh when the caller already used fanOutPush().
     *
     * Job workflows need both channels, but sending FCM from both helpers creates
     * two lock-screen alerts for one event. Keep the title argument so paired
     * callsites remain explicit and cannot accidentally swap the data payload.
     */
    public static function broadcastOnly(int $userId, string $title, array $data): bool
    {
        unset($title);

        return self::broadcastNotification($userId, $data);
    }

    /**
     * Broadcast a message event to a channel.
     */
    public static function broadcastMessage(string $channel, array $data): bool
    {
        try {
            $service = new self();
            return $service->broadcast($channel, 'message', $data);
        } catch (\Throwable $e) {
            Log::error('RealtimeService::broadcastMessage failed', ['error' => $e->getMessage()]);
            return false;
        }
    }
}
