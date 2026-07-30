<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * GroupModerationService — content flagging and moderation for groups.
 */
class GroupModerationService
{
    // Action constants
    public const ACTION_FLAG    = 'flag';
    public const ACTION_HIDE    = 'hide';
    public const ACTION_DELETE  = 'delete';
    public const ACTION_APPROVE = 'approve';

    // Content type constants
    public const CONTENT_GROUP      = 'group';
    public const CONTENT_DISCUSSION = 'discussion';
    public const CONTENT_POST       = 'post';

    // Reason constants
    public const REASON_SPAM          = 'spam';
    public const REASON_HARASSMENT    = 'harassment';
    public const REASON_INAPPROPRIATE = 'inappropriate';
    public const REASON_HATE_SPEECH   = 'hate_speech';
    public const REASON_OTHER         = 'other';

    public function __construct()
    {
    }

    /**
     * Flag content for moderation review.
     *
     * @return int|null Flag record ID, or null on failure
     */
    public static function flagContent($contentType, $contentId, $reportedBy, $reason = self::REASON_OTHER, $description = '')
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $id = DB::table('group_content_flags')->insertGetId([
                'tenant_id'    => $tenantId,
                'content_type' => $contentType,
                'content_id'   => $contentId,
                'reported_by'  => $reportedBy,
                'reason'       => $reason,
                'description'  => $description,
                'status'       => 'pending',
                'created_at'   => now(),
            ]);

            return $id;
        } catch (\Throwable $e) {
            Log::warning('Failed to flag content', ['error' => $e->getMessage()]);
            return null;
        }
    }

    /**
     * Moderate flagged content (approve, hide, delete).
     */
    public static function moderateContent($flagId, $action, $moderatorId, $moderatorNotes = '')
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $flag = DB::table('group_content_flags')
                ->where('id', $flagId)
                ->where('tenant_id', $tenantId)
                ->first();

            if (!$flag) {
                return false;
            }

            DB::table('group_content_flags')
                ->where('id', $flagId)
                ->where('tenant_id', $tenantId)
                ->update([
                    'status'            => $action === self::ACTION_APPROVE ? 'approved' : 'resolved',
                    'moderated_by'      => $moderatorId,
                    'moderator_notes'   => $moderatorNotes,
                    'resolved_at'       => now(),
                    'moderation_action' => $action,
                ]);

            return true;
        } catch (\Throwable $e) {
            Log::warning('Failed to moderate content', ['flag_id' => $flagId, 'error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Get pending content flags.
     */
    public static function getPendingFlags($filters = [], $limit = 50, $offset = 0)
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $query = DB::table('group_content_flags')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->orderByDesc('created_at');

            if (!empty($filters['content_type'])) {
                $query->where('content_type', $filters['content_type']);
            }

            return array_map(
                fn ($row) => (array) $row,
                $query->limit($limit)->offset($offset)->get()->all()
            );
        } catch (\Throwable $e) {
            Log::warning('[GroupModeration] Failed to fetch pending flags: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get moderation history (resolved flags).
     */
    public static function getModerationHistory($filters = [], $limit = 50, $offset = 0)
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $query = DB::table('group_content_flags')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['approved', 'resolved'])
                ->orderByDesc('resolved_at');

            if (!empty($filters['content_type'])) {
                $query->where('content_type', $filters['content_type']);
            }

            return array_map(
                fn ($row) => (array) $row,
                $query->limit($limit)->offset($offset)->get()->all()
            );
        } catch (\Throwable $e) {
            Log::warning('[GroupModeration] Failed to fetch moderation history: ' . $e->getMessage());
            return [];
        }
    }

    /**
     * Get moderation statistics.
     */
    public static function getStatistics(): array
    {
        try {
            $tenantId = \App\Core\TenantContext::getId();

            $pending = (int) DB::table('group_content_flags')
                ->where('tenant_id', $tenantId)
                ->where('status', 'pending')
                ->count();

            $resolved = (int) DB::table('group_content_flags')
                ->where('tenant_id', $tenantId)
                ->whereIn('status', ['approved', 'resolved'])
                ->count();

            $total = (int) DB::table('group_content_flags')
                ->where('tenant_id', $tenantId)
                ->count();

            return [
                'pending'  => $pending,
                'resolved' => $resolved,
                'total'    => $total,
            ];
        } catch (\Throwable $e) {
            return ['pending' => 0, 'resolved' => 0, 'total' => 0];
        }
    }
}
