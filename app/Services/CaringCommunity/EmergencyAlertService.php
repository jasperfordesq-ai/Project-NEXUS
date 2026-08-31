<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

use App\Services\FCMPushService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * EmergencyAlertService — AG70 Emergency/Safety Alert Tier
 *
 * Manages tenant-scoped emergency alerts that:
 *  - Bypass member quiet-hour preferences
 *  - Use FCM high-priority delivery for immediate push to all active members
 *  - Display a persistent dismissible banner across the React frontend
 *  - Support optional geographic radius targeting and expiry timestamps
 *
 * Roles authorised to send: admin, municipality_announcer
 */
class EmergencyAlertService
{
    private const TABLE = 'caring_emergency_alerts';

    /**
     * Check whether the emergency alerts table exists.
     * Always gate DB calls behind this check.
     */
    public static function isAvailable(): bool
    {
        return Schema::hasTable(self::TABLE);
    }

    /**
     * Return all currently active alerts for a tenant.
     * Active = is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())
     * If a member ID is provided, targeted alerts are returned only when that
     * member is explicitly included. Untargeted alerts remain tenant-wide.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function getActiveAlerts(int $tenantId, ?int $userId = null): array
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->where('is_active', 1)
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', Carbon::now());
            })
            ->orderBy('created_at', 'desc')
            ->get()
            ->filter(fn ($row): bool => self::alertTargetsUser($row->target_user_ids ?? null, $userId))
            ->map(fn ($row) => (array) $row)
            ->values()
            ->all();
    }

    /**
     * Fetch a single alert by ID scoped to the given tenant.
     *
     * @return array<string, mixed>|null
     */
    public static function getAlertById(int $id, int $tenantId): ?array
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        $row = DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->first();

        return $row ? (array) $row : null;
    }

    /**
     * Insert a new emergency alert and immediately broadcast it via FCM.
     *
     * Steps:
     *  1. Insert row
     *  2. Determine target user IDs (explicit list or all active users in tenant)
     *  3. Call FCMPushService::sendToUsers() with priority=high
     *  4. Update push_sent / push_result / sent_at
     *  5. Return the full alert row
     *
     * @param array<string, mixed> $data  Validated fields: title, body, severity, expires_at?,
     *                                     geographic_scope?, target_user_ids?
     * @return array<string, mixed>
     */
    public static function createAndBroadcast(int $tenantId, array $data, int $createdBy): array
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        $now = Carbon::now();

        $hasExplicitTargetInput = is_array($data['target_user_ids'] ?? null);
        $targetUserIds = self::resolveTargetUserIds($tenantId, $data['target_user_ids'] ?? null);

        $alertId = DB::table(self::TABLE)->insertGetId([
            'tenant_id'        => $tenantId,
            'title'            => $data['title'],
            'body'             => $data['body'],
            'severity'         => $data['severity'] ?? 'warning',
            'geographic_scope' => isset($data['geographic_scope'])
                ? json_encode($data['geographic_scope'])
                : null,
            'target_user_ids'  => $hasExplicitTargetInput ? json_encode($targetUserIds) : null,
            'expires_at'       => isset($data['expires_at'])
                ? Carbon::parse($data['expires_at'])->toDateTimeString()
                : null,
            'is_active'        => 1,
            'created_by'       => $createdBy,
            'dismissed_count'  => 0,
            'push_sent'        => 0,
            'created_at'       => $now,
            'updated_at'       => $now,
        ]);

        // Determine push recipients.
        $userIds = $hasExplicitTargetInput
            ? $targetUserIds
            : DB::table('users')
                ->where('tenant_id', $tenantId)
                ->where('status', 'active')
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

        // Broadcast via FCM with high priority (bypasses quiet hours at OS level)
        $pushResult = FCMPushService::sendToUsers(
            $userIds,
            $data['title'],
            $data['body'],
            [
                'priority'   => 'high',
                'sound'      => 'default',
                'type'       => 'caring_emergency',
                'link'       => '/caring-community/emergency-alerts?alert_id=' . $alertId,
                'alert_type' => 'emergency',
                'alert_id'   => (string) $alertId,
            ]
        );

        DB::table(self::TABLE)
            ->where('id', $alertId)
            ->update([
                'push_sent'   => 1,
                'push_result' => json_encode($pushResult),
                'sent_at'     => Carbon::now(),
                'updated_at'  => Carbon::now(),
            ]);

        return self::getAlertById($alertId, $tenantId) ?? [];
    }

    /**
     * Deactivate (soft-delete) an alert so it no longer shows on the banner.
     */
    public static function deactivate(int $id, int $tenantId): void
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update([
                'is_active'  => 0,
                'updated_at' => Carbon::now(),
            ]);
    }

    /**
     * Update mutable fields on an existing alert (title, body, severity, expires_at).
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    public static function update(int $id, int $tenantId, array $data): array
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        $fields = ['updated_at' => Carbon::now()];

        if (isset($data['title'])) {
            $fields['title'] = $data['title'];
        }
        if (isset($data['body'])) {
            $fields['body'] = $data['body'];
        }
        if (array_key_exists('severity', $data)) {
            $fields['severity'] = $data['severity'];
        }
        if (array_key_exists('expires_at', $data)) {
            $fields['expires_at'] = $data['expires_at']
                ? Carbon::parse($data['expires_at'])->toDateTimeString()
                : null;
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->update($fields);

        $row = self::getAlertById($id, $tenantId);

        if ($row === null) {
            throw new \RuntimeException(__('api.caring_emergency_alert_not_found_after_update'));
        }

        return $row;
    }

    /**
     * Increment the dismissed_count counter for analytics.
     */
    public static function recordDismissal(int $id, int $tenantId): void
    {
        if (!self::isAvailable()) {
            return; // Non-fatal — just skip analytics
        }

        DB::table(self::TABLE)
            ->where('id', $id)
            ->where('tenant_id', $tenantId)
            ->increment('dismissed_count', 1, ['updated_at' => Carbon::now()]);
    }

    /**
     * Return ALL alerts for a tenant (any status) for admin listing.
     *
     * @return array<int, array<string, mixed>>
     */
    public static function getAllAlerts(int $tenantId): array
    {
        if (!self::isAvailable()) {
            throw new \RuntimeException(__('api.caring_emergency_alerts_unavailable'));
        }

        return DB::table(self::TABLE)
            ->where('tenant_id', $tenantId)
            ->orderBy('created_at', 'desc')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }

    private static function alertTargetsUser(mixed $targetUserIds, ?int $userId): bool
    {
        if ($targetUserIds === null || $targetUserIds === '') {
            return true;
        }

        if ($userId === null || $userId <= 0) {
            return false;
        }

        $decoded = is_array($targetUserIds)
            ? $targetUserIds
            : json_decode((string) $targetUserIds, true);

        if (!is_array($decoded)) {
            return true;
        }

        if ($decoded === []) {
            return false;
        }

        $ids = array_map('intval', $decoded);

        return in_array($userId, $ids, true);
    }

    /**
     * @return array<int, int>
     */
    private static function resolveTargetUserIds(int $tenantId, mixed $targetUserIds): array
    {
        if (!is_array($targetUserIds) || $targetUserIds === []) {
            return [];
        }

        $requestedIds = array_values(array_unique(array_filter(
            array_map('intval', $targetUserIds),
            fn (int $id): bool => $id > 0,
        )));

        if ($requestedIds === []) {
            return [];
        }

        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereIn('id', $requestedIds)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
    }
}
