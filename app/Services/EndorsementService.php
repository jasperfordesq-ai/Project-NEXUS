<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Models\SkillEndorsement;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use App\Support\UserDisplayName;

/**
 * EndorsementService — Laravel DI-based service for skill endorsements.
 *
 * Manages LinkedIn-style skill endorsements between members.
 * All queries are tenant-scoped via HasTenantScope trait.
 */
class EndorsementService
{
    /** @var array Collected errors from the last operation */
    private static array $errors = [];

    public function __construct(
        private readonly SkillEndorsement $endorsement,
    ) {}

    /**
     * Endorse a member's skill.
     *
     * @return int|null Endorsement ID or null on failure.
     */
    public static function endorse(int $endorserId, int $endorsedId, string $skillName, ?int $skillId = null, ?string $comment = null): ?int
    {
        self::$errors = [];

        // Cannot endorse yourself
        if ($endorserId === $endorsedId) {
            self::$errors[] = ['code' => 'SELF_ENDORSEMENT', 'message' => __('api_controllers_2.endorsement.cannot_endorse_self')];
            return null;
        }

        // Validate skill name
        $skillName = trim($skillName);
        if (empty($skillName) || mb_strlen($skillName) > 100) {
            self::$errors[] = ['code' => 'VALIDATION_ERROR', 'message' => 'Skill name is required (max 100 chars)', 'field' => 'skill_name'];
            return null;
        }

        // Check endorsed user exists in the same tenant
        $endorsed = User::where('id', $endorsedId)
            ->where('tenant_id', TenantContext::getId())
            ->first(['id', 'first_name', 'last_name', 'profile_type', 'organization_name']);
        if (!$endorsed) {
            self::$errors[] = ['code' => 'NOT_FOUND', 'message' => __('api_controllers_2.endorsement.member_not_found')];
            return null;
        }

        app(SafeguardingInteractionPolicy::class)->assertLocalContactAllowed(
            $endorserId,
            $endorsedId,
            (int) TenantContext::getId(),
            'skill_endorsement',
        );

        // Check for existing endorsement
        $existing = SkillEndorsement::query()
            ->where('endorser_id', $endorserId)
            ->where('endorsed_id', $endorsedId)
            ->where('skill_name', $skillName)
            ->exists();

        if ($existing) {
            self::$errors[] = ['code' => 'ALREADY_ENDORSED', 'message' => __('api_controllers_2.endorsement.already_endorsed')];
            return null;
        }

        // Validate comment length
        if ($comment !== null) {
            $comment = trim($comment);
            if (mb_strlen($comment) > 500) {
                $comment = mb_substr($comment, 0, 500);
            }
        }

        $endorsementRecord = SkillEndorsement::query()->create([
            'endorser_id' => $endorserId,
            'endorsed_id' => $endorsedId,
            'skill_id' => $skillId,
            'skill_name' => $skillName,
            'comment' => $comment,
        ]);

        return $endorsementRecord->id;
    }

    /**
     * Remove an endorsement.
     */
    public static function removeEndorsement(int $endorserId, int $endorsedId, string $skillName): bool
    {
        return SkillEndorsement::query()
            ->where('endorser_id', $endorserId)
            ->where('endorsed_id', $endorsedId)
            ->where('skill_name', $skillName)
            ->delete() > 0;
    }

    /**
     * Get all endorsements for a user, grouped by skill.
     */
    public static function getEndorsements(int $userId): array
    {
        $rows = SkillEndorsement::query()
            ->with(['endorser:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('endorsed_id', $userId)
            ->orderBy('skill_name')
            ->orderByDesc('created_at')
            ->get();

        $grouped = [];
        foreach ($rows as $row) {
            $skill = $row->skill_name;
            if (!isset($grouped[$skill])) {
                $grouped[$skill] = ['skill_name' => $skill, 'count' => 0, 'endorsers' => []];
            }
            $grouped[$skill]['count']++;
            $grouped[$skill]['endorsers'][] = [
                'id' => $row->endorser_id,
                'name' => $row->endorser ? UserDisplayName::resolve($row->endorser) : null,
                'avatar_url' => $row->endorser->avatar_url ?? null,
                'comment' => $row->comment,
            ];
        }

        return array_values($grouped);
    }

    /**
     * Check if a user has endorsed another's specific skill.
     */
    public static function hasEndorsed(int $endorserId, int $endorsedId, string $skillName): bool
    {
        return SkillEndorsement::query()
            ->where('endorser_id', $endorserId)
            ->where('endorsed_id', $endorsedId)
            ->where('skill_name', $skillName)
            ->exists();
    }

    /**
     * Get collected errors from the last operation.
     */
    public static function getErrors(): array
    {
        return self::$errors;
    }

    /**
     * Get detailed endorsements for a specific skill.
     */
    public static function getSkillEndorsements(int $userId, string $skillName): array
    {
        return SkillEndorsement::query()
            ->with(['endorser:id,first_name,last_name,profile_type,organization_name,avatar_url'])
            ->where('endorsed_id', $userId)
            ->where('skill_name', $skillName)
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (SkillEndorsement $se) => [
                'id' => $se->id,
                'comment' => $se->comment,
                'created_at' => $se->created_at?->toDateTimeString(),
                'endorser_id' => $se->endorser_id,
                'endorser_name' => $se->endorser ? UserDisplayName::resolve($se->endorser) : null,
                'endorser_avatar' => $se->endorser->avatar_url ?? null,
            ])
            ->all();
    }

    /**
     * Get endorsements received by a user, grouped by skill (with endorser details).
     */
    public static function getEndorsementsForUser(int $userId): array
    {
        $tenantId = TenantContext::getId();

        // Verify the target user belongs to this tenant before exposing endorsement data
        if (!User::where('id', $userId)->where('tenant_id', $tenantId)->exists()) {
            return [];
        }

        $rows = DB::table('skill_endorsements as se')
            ->join('users as u', 'se.endorser_id', '=', 'u.id')
            ->where('se.endorsed_id', $userId)
            ->where('se.tenant_id', $tenantId)
            ->select(
                'se.skill_name',
                DB::raw('COUNT(*) as count'),
                DB::raw("GROUP_CONCAT(CONCAT(u.first_name, ' ', u.last_name) ORDER BY se.created_at DESC SEPARATOR ', ') as endorsed_by_names"),
                DB::raw('GROUP_CONCAT(u.id ORDER BY se.created_at DESC) as endorsed_by_ids'),
                DB::raw('GROUP_CONCAT(u.avatar_url ORDER BY se.created_at DESC) as endorsed_by_avatars'),
                DB::raw('MAX(se.created_at) as latest_endorsement')
            )
            ->groupBy('se.skill_name')
            ->orderByDesc('count')
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();

        return $rows;
    }

    /**
     * Get endorsement stats for a user (for badges).
     */
    public static function getStats(int $userId): array
    {
        $received = (int) SkillEndorsement::query()
            ->where('endorsed_id', $userId)
            ->count();

        $given = (int) SkillEndorsement::query()
            ->where('endorser_id', $userId)
            ->count();

        $uniqueSkills = (int) SkillEndorsement::query()
            ->where('endorsed_id', $userId)
            ->distinct('skill_name')
            ->count('skill_name');

        return [
            'endorsements_received' => $received,
            'endorsements_given' => $given,
            'skills_endorsed' => $uniqueSkills,
        ];
    }

    /**
     * Get top endorsed members across the tenant.
     */
    public static function getTopEndorsedMembers(int $limit = 10): array
    {
        $tenantId = TenantContext::getId();

        return DB::table('skill_endorsements as se')
            ->join('users as u', 'se.endorsed_id', '=', 'u.id')
            ->where('se.tenant_id', $tenantId)
            ->select(
                'se.endorsed_id as user_id',
                DB::raw(UserDisplayName::sql('u', 'name')),
                'u.avatar_url',
                DB::raw('COUNT(*) as total_endorsements'),
                DB::raw('COUNT(DISTINCT se.skill_name) as skills_endorsed')
            )
            ->groupBy('se.endorsed_id', 'u.first_name', 'u.last_name', 'u.avatar_url')
            ->orderByDesc('total_endorsements')
            ->limit($limit)
            ->get()
            ->map(fn ($row) => (array) $row)
            ->all();
    }
}
