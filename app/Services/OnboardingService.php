<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Events\OnboardingCompleted;
use App\Models\Category;
use App\Models\User;
use App\Models\UserInterest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * OnboardingService — Laravel DI-based service for post-registration onboarding wizard.
 *
 * Handles onboarding completion tracking and saving the skills chosen in the wizard.
 * All queries are tenant-scoped via HasTenantScope trait on models.
 */
class OnboardingService
{
    public function __construct() {}

    /**
     * Get onboarding progress for a user.
     */
    public static function getProgress(int $tenantId, int $userId): array
    {
        $user = User::find($userId);
        if (!$user) {
            return [];
        }

        $interests = UserInterest::where('user_id', $userId)->count();
        $hasAvatar = !empty($user->avatar_url);
        $hasBio = !empty($user->bio);

        $steps = [
            'profile' => $hasAvatar || $hasBio,
            'interests' => $interests > 0,
            'skills' => UserInterest::where('user_id', $userId)
                ->whereIn('interest_type', ['skill_offer', 'skill_need'])
                ->exists(),
            'complete' => (bool) $user->onboarding_completed,
        ];

        $completedCount = count(array_filter($steps));
        $totalSteps = count($steps);

        return [
            'steps' => $steps,
            'completed' => $completedCount,
            'total' => $totalSteps,
            'percentage' => $totalSteps > 0 ? (int) round(($completedCount / $totalSteps) * 100) : 0,
            'is_complete' => (bool) $user->onboarding_completed,
        ];
    }

    /**
     * Complete a specific onboarding step.
     */
    public static function completeStep(int $tenantId, int $userId, string $step): bool
    {
        // Steps are tracked implicitly via data presence (profile, interests, skills)
        // For explicit step tracking, we use the onboarding_completed flag
        if ($step === 'complete') {
            return User::where('id', $userId)
                ->where('tenant_id', $tenantId)
                ->update(['onboarding_completed' => true]) > 0;
        }

        return true;
    }

    /**
     * Get onboarding checklist (available steps).
     */
    public static function getChecklist(int $tenantId): array
    {
        return [
            ['key' => 'profile', 'label' => 'Complete your profile', 'description' => 'Add a photo and bio'],
            ['key' => 'interests', 'label' => 'Select your interests', 'description' => 'Choose categories you care about'],
            ['key' => 'skills', 'label' => 'Share your skills', 'description' => 'Tell us what you can offer and what you need'],
            ['key' => 'complete', 'label' => 'All done!', 'description' => 'Start exploring your community'],
        ];
    }

    /**
     * Reset onboarding progress for a user.
     */
    public static function resetProgress(int $tenantId, int $userId): bool
    {
        User::where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->update(['onboarding_completed' => false]);

        UserInterest::where('user_id', $userId)
            ->where('tenant_id', $tenantId)
            ->delete();

        return true;
    }

    /**
     * Check if onboarding is complete.
     */
    public static function isOnboardingComplete(int $userId): bool
    {
        $user = User::find($userId, ['id', 'onboarding_completed']);
        return $user && (bool) $user->onboarding_completed;
    }

    /**
     * Get user's selected interests.
     */
    public static function getUserInterests(int $userId): array
    {
        return UserInterest::where('user_id', $userId)
            ->join('categories', 'categories.id', '=', 'user_interests.category_id')
            ->select('user_interests.*', 'categories.name as category_name')
            ->orderBy('user_interests.interest_type')
            ->orderBy('categories.name')
            ->get()
            ->map(fn ($row) => $row->toArray())
            ->all();
    }

    /** Longest skill name user_skills.skill_name can hold. */
    public const SKILL_NAME_MAX = 100;

    /** Most skills one onboarding submission may record per direction. */
    public const SKILLS_PER_DIRECTION_MAX = 25;

    /**
     * Save the skills a member chose in the onboarding wizard into
     * user_skills — the table matching, Explore and the personalised feed read.
     *
     * Until 2026-10-02 the wizard wrote listing-category ids into
     * user_interests, which nothing outside the wizard ever read.
     *
     * $replace = true  — the lists are the member's complete offer/need state
     *                    (the current wizard prefills from user_skills): flags
     *                    not in the lists are cleared, and a row left with
     *                    neither flag is removed.
     * $replace = false — additive only (older app versions that send
     *                    listing-category ids): nothing is cleared.
     *
     * Names compare case-insensitively (the column's collation), so
     * "Gardening" chosen here updates an existing "gardening" row.
     *
     * @param string[] $offerNames
     * @param string[] $needNames
     */
    public static function saveOnboardingSkills(int $userId, array $offerNames, array $needNames, bool $replace): void
    {
        $tenantId = TenantContext::getId();
        $offerNames = self::normaliseSkillNames($offerNames);
        $needNames = self::normaliseSkillNames($needNames);

        $existing = DB::table('user_skills')
            ->where('tenant_id', $tenantId)
            ->where('user_id', $userId)
            ->get(['id', 'skill_name', 'is_offering', 'is_requesting']);

        $offerKeys = array_flip(array_map('mb_strtolower', $offerNames));
        $needKeys = array_flip(array_map('mb_strtolower', $needNames));
        $seen = [];

        foreach ($existing as $row) {
            $key = mb_strtolower((string) $row->skill_name);
            $seen[$key] = true;
            $offering = isset($offerKeys[$key]) || (!$replace && (bool) $row->is_offering);
            $requesting = isset($needKeys[$key]) || (!$replace && (bool) $row->is_requesting);

            if (!$offering && !$requesting) {
                DB::table('user_skills')
                    ->where('id', $row->id)
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->delete();
                continue;
            }

            if ($offering !== (bool) $row->is_offering || $requesting !== (bool) $row->is_requesting) {
                DB::table('user_skills')
                    ->where('id', $row->id)
                    ->where('tenant_id', $tenantId)
                    ->where('user_id', $userId)
                    ->update(['is_offering' => (int) $offering, 'is_requesting' => (int) $requesting]);
            }
        }

        $rows = [];
        foreach (array_unique(array_merge($offerNames, $needNames)) as $name) {
            $key = mb_strtolower($name);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            $rows[] = [
                'user_id'       => $userId,
                'tenant_id'     => $tenantId,
                'category_id'   => null,
                'skill_name'    => $name,
                'proficiency'   => 'intermediate',
                'is_offering'   => (int) isset($offerKeys[$key]),
                'is_requesting' => (int) isset($needKeys[$key]),
            ];
        }
        if (!empty($rows)) {
            DB::table('user_skills')->insert($rows);
        }
    }

    /**
     * Listing-category ids → their names, for older app versions whose skills
     * step still offers the community's listing categories.
     *
     * @param int[] $categoryIds
     * @return string[]
     */
    public static function categoryNamesForSkills(array $categoryIds): array
    {
        if (empty($categoryIds)) {
            return [];
        }

        return Category::where('tenant_id', TenantContext::getId())
            ->whereIn('id', $categoryIds)
            ->pluck('name')
            ->map(fn ($name) => (string) $name)
            ->all();
    }

    /**
     * Trim, strip markup, drop blanks and over-long names, de-duplicate
     * case-insensitively, and cap the count.
     *
     * @param array<mixed> $names
     * @return string[]
     */
    private static function normaliseSkillNames(array $names): array
    {
        $out = [];
        foreach ($names as $name) {
            if (!is_string($name)) {
                continue;
            }
            $clean = trim(preg_replace('/\s+/u', ' ', strip_tags($name)) ?? '');
            if ($clean === '' || mb_strlen($clean) > self::SKILL_NAME_MAX) {
                continue;
            }
            $out[mb_strtolower($clean)] ??= $clean;
            if (count($out) >= self::SKILLS_PER_DIRECTION_MAX) {
                break;
            }
        }

        return array_values($out);
    }

    /**
     * Mark onboarding as complete.
     */
    public static function completeOnboarding(int $userId): bool
    {
        $tenantId = TenantContext::getId();

        $updated = DB::table('users')
            ->where('id', $userId)
            ->where('tenant_id', $tenantId)
            ->where(function ($query) {
                $query->where('onboarding_completed', 0)
                    ->orWhereNull('onboarding_completed');
            })
            ->update(['onboarding_completed' => true]);

        if ($updated <= 0) {
            return false;
        }

        // Send confirmation email — queued, never delays the wizard response
        try {
            event(new OnboardingCompleted($userId, $tenantId));
        } catch (\Throwable $e) {
            Log::error('OnboardingService: failed to dispatch OnboardingCompleted event', [
                'user_id'   => $userId,
                'tenant_id' => $tenantId,
                'error'     => $e->getMessage(),
            ]);
        }

        return true;
    }

    /**
     * Skip an onboarding step — convenience method that marks a step complete.
     */
    public static function skipStep(int $tenantId, int $userId, string $step): bool
    {
        return self::completeStep($tenantId, $userId, $step);
    }

    /**
     * Get onboarding recommendations (categories, skills) for the user.
     */
    public static function getRecommendations(int $tenantId): array
    {
        $categories = Category::where('tenant_id', $tenantId)->orderBy('name')
            ->select(['id', 'name', 'slug', 'color'])
            ->get()
            ->map(fn ($c) => $c->toArray())
            ->all();

        $skills = DB::table('skills')
            ->where('tenant_id', $tenantId)
            ->orderBy('name')
            ->select(['id', 'name'])
            ->get()
            ->map(fn ($s) => (array) $s)
            ->all();

        return [
            'categories' => $categories,
            'skills' => $skills,
        ];
    }

    /**
     * Alias for completeOnboarding.
     */
    public static function markComplete(int $userId): void
    {
        self::completeOnboarding($userId);
    }
}
