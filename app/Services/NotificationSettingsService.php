<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Persists the member notification-settings form as one database transaction.
 *
 * The settings page spans three storage locations: the users JSON preference
 * column, match_preferences, and notification_settings. Locking the tenant-
 * scoped users row serializes form saves for one member and gives every caller
 * an all-or-nothing result across those stores.
 */
class NotificationSettingsService
{
    /** @var array<string, bool> */
    public const GENERAL_DEFAULTS = [
        'email_messages' => true,
        'email_listings' => true,
        'email_digest' => false,
        'email_connections' => true,
        'email_transactions' => true,
        'email_reviews' => true,
        'email_events' => true,
        'email_gamification_digest' => true,
        'email_gamification_milestones' => true,
        'email_org_payments' => true,
        'email_org_transfers' => true,
        'email_org_membership' => true,
        'email_org_admin' => true,
        'caring_smart_nudges' => true,
        'push_enabled' => true,
        'push_campaigns_opted_in' => false,
        'push_show_message_preview' => false,
    ];

    public const FEDERATION_KEY = 'federation_notifications_enabled';

    /**
     * @param array<string, bool> $notifications
     * @param array{notification_frequency: string, notify_hot_matches: bool, notify_mutual_matches: bool} $matchPreferences
     * @return array{
     *     notifications: array<string, bool>,
     *     match_preferences: array{notification_frequency: string, notify_hot_matches: bool, notify_mutual_matches: bool},
     *     digest_frequency: string
     * }
     */
    public function updateAtomically(
        int $userId,
        int $tenantId,
        array $notifications,
        array $matchPreferences,
        string $digestFrequency,
    ): array {
        return DB::transaction(function () use (
            $userId,
            $tenantId,
            $notifications,
            $matchPreferences,
            $digestFrequency,
        ): array {
            $user = DB::table('users')
                ->where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->lockForUpdate()
                ->select(['notification_preferences', 'federation_notifications_enabled'])
                ->first();

            if (! $user) {
                throw new \RuntimeException('Authenticated user was not found in the request tenant.');
            }

            [$storedPreferences, $federationEnabled] = $this->persistGeneralPreferences(
                $userId,
                $tenantId,
                $user,
                $notifications,
            );

            $this->persistMatchPreferences($userId, $tenantId, $matchPreferences);
            $this->persistDigestFrequency($userId, $digestFrequency);

            $canonicalNotifications = [];
            foreach (self::GENERAL_DEFAULTS as $key => $default) {
                $canonicalNotifications[$key] = (bool) ($storedPreferences[$key] ?? $default);
            }
            $canonicalNotifications[self::FEDERATION_KEY] = $federationEnabled;

            return [
                'notifications' => $canonicalNotifications,
                'match_preferences' => $matchPreferences,
                'digest_frequency' => $digestFrequency,
            ];
        });
    }

    /**
     * @param object{notification_preferences: mixed, federation_notifications_enabled: mixed} $user
     * @param array<string, bool> $notifications
     * @return array{0: array<string, mixed>, 1: bool}
     */
    protected function persistGeneralPreferences(
        int $userId,
        int $tenantId,
        object $user,
        array $notifications,
    ): array {
        $storedPreferences = json_decode((string) ($user->notification_preferences ?? ''), true);
        if (! is_array($storedPreferences)) {
            $storedPreferences = [];
        }

        foreach (self::GENERAL_DEFAULTS as $key => $default) {
            if (array_key_exists($key, $notifications)) {
                $storedPreferences[$key] = $notifications[$key] ? 1 : 0;
            }
        }

        $federationEnabled = array_key_exists(self::FEDERATION_KEY, $notifications)
            ? $notifications[self::FEDERATION_KEY]
            : (bool) ($user->federation_notifications_enabled ?? true);

        DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->update([
                'notification_preferences' => json_encode($storedPreferences, JSON_THROW_ON_ERROR),
                'federation_notifications_enabled' => $federationEnabled ? 1 : 0,
                'updated_at' => now(),
            ]);

        return [$storedPreferences, $federationEnabled];
    }

    /**
     * @param array{notification_frequency: string, notify_hot_matches: bool, notify_mutual_matches: bool} $preferences
     */
    protected function persistMatchPreferences(int $userId, int $tenantId, array $preferences): void
    {
        DB::table('match_preferences')->updateOrInsert(
            [
                'user_id' => $userId,
                'tenant_id' => $tenantId,
            ],
            [
                'notification_frequency' => $preferences['notification_frequency'],
                'notify_hot_matches' => $preferences['notify_hot_matches'] ? 1 : 0,
                'notify_mutual_matches' => $preferences['notify_mutual_matches'] ? 1 : 0,
                'updated_at' => now(),
            ],
        );
    }

    protected function persistDigestFrequency(int $userId, string $digestFrequency): void
    {
        // notification_settings intentionally has no tenant_id column. The
        // tenant-scoped users-row lock above proves this globally unique user ID
        // belongs to the authenticated request tenant before this write occurs.
        DB::table('notification_settings')->updateOrInsert(
            [
                'user_id' => $userId,
                'context_type' => 'global',
                'context_id' => 0,
            ],
            ['frequency' => $digestFrequency],
        );
    }
}
