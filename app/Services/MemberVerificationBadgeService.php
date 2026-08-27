<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * MemberVerificationBadgeService — Verification badge system.
 *
 * Public badge types intentionally exclude criminal-record/vetting status.
 * Private safeguarding attestations are never exposed as profile badges.
 * Provides grant/revoke badges, get badges for users, batch get badges, and admin badge list.
 */
class MemberVerificationBadgeService
{
    public const BADGE_TYPES = [
        'email_verified',
        'phone_verified',
        'id_verified',
        'address_verified',
        'admin_verified',
        'organization_vouched',
        'peer_endorsed',
    ];

    public const BADGE_LABELS = [
        'email_verified' => 'Email Verified',
        'phone_verified' => 'Phone Verified',
        'id_verified' => 'ID Verified',
        'address_verified' => 'Address Verified',
        'admin_verified' => 'Admin Verified',
        'organization_vouched' => 'Organization Vouched',
        'peer_endorsed' => 'Peer Endorsed',
    ];

    public const BADGE_ICONS = [
        'email_verified' => 'mail-check',
        'phone_verified' => 'phone-check',
        'id_verified' => 'shield-check',
        'address_verified' => 'badge-check',
        'admin_verified' => 'user-check',
        'organization_vouched' => 'building-2',
        'peer_endorsed' => 'users-round',
    ];

    private array $errors = [];

    /**
     * Get validation errors from the last operation.
     */
    public function getErrors(): array
    {
        return $this->errors;
    }

    /**
     * Grant a verification badge to a user (admin action).
     */
    public function grantBadge(int $userId, string $badgeType, int $adminId, ?string $note = null, ?string $expiresAt = null): ?int
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        if (!in_array($badgeType, self::BADGE_TYPES, true)) {
            $this->errors[] = ['code' => 'INVALID_TYPE', 'message' => __('api_controllers_2.verification_badge.invalid_badge_type', ['type' => $badgeType]), 'field' => 'badge_type'];
            return null;
        }

        // Check user exists in tenant
        $user = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->select('id', 'first_name', 'last_name', 'profile_type', 'organization_name', 'preferred_language')
            ->first();

        if (!$user) {
            $this->errors[] = ['code' => 'NOT_FOUND', 'message' => __('api_controllers_2.verification_badge.user_not_found')];
            return null;
        }

        // Upsert: if badge exists and was revoked, re-grant it
        $existing = DB::table('member_verification_badges')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('badge_type', $badgeType)
            ->select('id', 'revoked_at')
            ->first();

        if ($existing) {
            if ($existing->revoked_at === null) {
                $this->errors[] = ['code' => 'ALREADY_GRANTED', 'message' => __('api_controllers_2.verification_badge.badge_already_active')];
                return (int) $existing->id;
            }

            // Re-grant
            DB::table('member_verification_badges')
                ->where('id', $existing->id)
                ->where('tenant_id', $tenantId)
                ->update([
                    'verified_by' => $adminId,
                    'verification_note' => $note,
                    'granted_at' => now(),
                    'expires_at' => $expiresAt,
                    'revoked_at' => null,
                ]);

            $badgeId = (int) $existing->id;
        } else {
            $badgeId = DB::table('member_verification_badges')->insertGetId([
                'user_id' => $userId,
                'tenant_id' => $tenantId,
                'badge_type' => $badgeType,
                'verified_by' => $adminId,
                'verification_note' => $note,
                'expires_at' => $expiresAt,
                'granted_at' => now(),
            ]);
        }

        // Send notification under the badge recipient's preferred_language
        // so the bell is readable to them rather than rendered in the admin
        // caller's locale.
        try {
            $label = self::BADGE_LABELS[$badgeType] ?? $badgeType;
            LocaleContext::withLocale($user, function () use ($userId, $tenantId, $label) {
                DB::table('notifications')->insert([
                    'user_id' => $userId,
                    'tenant_id' => $tenantId,
                    'message' => __('svc_notifications.verification_badge.granted', ['label' => $label]),
                    'link' => '/settings',
                    'type' => 'verification',
                    'created_at' => now(),
                ]);
            });
        } catch (\Exception $e) {
            // Non-critical
        }

        return $badgeId;
    }

    /**
     * Revoke a verification badge (admin action).
     */
    public function revokeBadge(int $userId, string $badgeType, int $adminId): bool
    {
        $this->errors = [];
        $tenantId = TenantContext::getId();

        DB::table('member_verification_badges')
            ->where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->where('badge_type', $badgeType)
            ->whereNull('revoked_at')
            ->update(['revoked_at' => now()]);

        return true;
    }

    /**
     * Get all active verification badges for a user.
     */
    public function getUserBadges(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('member_verification_badges as mvb')
            ->leftJoin('users as u', 'mvb.verified_by', '=', 'u.id')
            ->where('mvb.user_id', $userId)
            ->where('mvb.tenant_id', $tenantId)
            ->whereIn('mvb.badge_type', self::BADGE_TYPES)
            ->whereNull('mvb.revoked_at')
            ->where(function ($q) {
                $q->whereNull('mvb.expires_at')
                  ->orWhere('mvb.expires_at', '>', now());
            })
            ->select(
                'mvb.badge_type', 'mvb.granted_at', 'mvb.expires_at',
                DB::raw(UserDisplayName::sql('u', 'verified_by_name'))
            )
            ->get();

        return $rows->map(function ($row) {
            $row = (array) $row;
            $row['label'] = self::BADGE_LABELS[$row['badge_type']] ?? $row['badge_type'];
            $row['icon'] = self::BADGE_ICONS[$row['badge_type']] ?? 'badge';
            return $row;
        })->all();
    }

    /**
     * Batch get badges for multiple users (for profile cards).
     *
     * @return array Keyed by user_id => [badge_types]
     */
    public function getBatchUserBadges(array $userIds): array
    {
        if (empty($userIds)) {
            return [];
        }

        $tenantId = TenantContext::getId();

        $rows = DB::table('member_verification_badges')
            ->whereIn('user_id', $userIds)
            ->where('tenant_id', $tenantId)
            ->whereIn('badge_type', self::BADGE_TYPES)
            ->whereNull('revoked_at')
            ->where(function ($q) {
                $q->whereNull('expires_at')
                  ->orWhere('expires_at', '>', now());
            })
            ->select('user_id', 'badge_type')
            ->get();

        $result = [];
        foreach ($rows as $row) {
            $uid = (int) $row->user_id;
            if (!isset($result[$uid])) {
                $result[$uid] = [];
            }
            $result[$uid][] = [
                'type' => $row->badge_type,
                'label' => self::BADGE_LABELS[$row->badge_type] ?? $row->badge_type,
                'icon' => self::BADGE_ICONS[$row->badge_type] ?? 'badge',
            ];
        }

        return $result;
    }

    /**
     * Get all badges for admin management (includes revoked).
     */
    public function getAdminBadgeList(int $userId): array
    {
        $tenantId = TenantContext::getId();

        $rows = DB::table('member_verification_badges as mvb')
            ->leftJoin('users as u', 'mvb.verified_by', '=', 'u.id')
            ->where('mvb.user_id', $userId)
            ->where('mvb.tenant_id', $tenantId)
            ->select('mvb.*', DB::raw(UserDisplayName::sql('u', 'verified_by_name')))
            ->orderByDesc('mvb.granted_at')
            ->get();

        return $rows->map(function ($row) {
            $row = (array) $row;
            $row['label'] = self::BADGE_LABELS[$row['badge_type']] ?? $row['badge_type'];
            $row['icon'] = self::BADGE_ICONS[$row['badge_type']] ?? 'badge';
            $row['is_active'] = $row['revoked_at'] === null
                && ($row['expires_at'] === null || strtotime($row['expires_at']) > time());
            return $row;
        })->all();
    }
}
