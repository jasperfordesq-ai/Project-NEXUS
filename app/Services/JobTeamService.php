<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\Exceptions\SafeguardingPolicyException;
use App\I18n\LocaleContext;
use App\Models\JobVacancy;
use App\Models\JobVacancyTeam;
use App\Models\Notification;
use App\Models\User;
use Illuminate\Support\Facades\Log;

class JobTeamService
{
    /**
     * Add a team member to a vacancy.
     * Only the job poster (owner) can add members.
     */
    public static function addMember(int $vacancyId, int $ownerUserId, int $targetUserId, string $role = 'reviewer'): array|false
    {
        $tenantId = TenantContext::getId();

        try {
            $vacancy = JobVacancy::find($vacancyId);
            if (!$vacancy || (int) $vacancy->tenant_id !== $tenantId) return false;
            if ((int) $vacancy->user_id !== $ownerUserId) return false;

            // Don't add the owner themselves
            if ($targetUserId === $ownerUserId) return false;

            // Verify target user exists in the same tenant
            if (!User::where('id', $targetUserId)->where('tenant_id', $tenantId)->exists()) {
                return false;
            }

            $policy = app(SafeguardingInteractionPolicy::class);
            $policy->assertLocalContactAllowed(
                $ownerUserId,
                $targetUserId,
                $tenantId,
                'job_hiring_team_add',
            );
            $policy->assertLocalContactAllowed(
                $targetUserId,
                $ownerUserId,
                $tenantId,
                'job_hiring_team_add',
            );

            $member = JobVacancyTeam::updateOrCreate(
                ['vacancy_id' => $vacancyId, 'user_id' => $targetUserId],
                [
                    'tenant_id'  => $tenantId,
                    'role'       => in_array($role, ['reviewer', 'manager']) ? $role : 'reviewer',
                    'added_by'   => $ownerUserId,
                    'created_at' => now(),
                ]
            );

            // Notify the added member in their preferred_language — the
            // caller is the job poster and wouldn't share the recipient's
            // locale in a multi-lingual community.
            try {
                $target = User::find($targetUserId);
                LocaleContext::withLocale($target, function () use ($targetUserId, $role, $vacancy, $vacancyId) {
                    Notification::createNotification(
                        $targetUserId,
                        __('svc_notifications.job_team.added_as_role', ['role' => $role, 'title' => $vacancy->title]),
                        "/jobs/{$vacancyId}",
                        'job_application'
                    );
                    \App\Services\NotificationDispatcher::fanOutPush((int) ($targetUserId), 'job_application', __('svc_notifications.job_team.added_as_role', ['role' => $role, 'title' => $vacancy->title]), "/jobs/{$vacancyId}");
                });
            } catch (\Throwable $e) {
                Log::warning('JobTeamService::addMember notification failed: ' . $e->getMessage());
            }

            return $member->toArray();
        } catch (SafeguardingPolicyException $e) {
            throw $e;
        } catch (\Throwable $e) {
            Log::error('JobTeamService::addMember failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * Remove a team member from a vacancy.
     */
    public static function removeMember(int $vacancyId, int $ownerUserId, int $targetUserId): bool
    {
        $tenantId = TenantContext::getId();

        try {
            $vacancy = JobVacancy::find($vacancyId);
            if (!$vacancy || (int) $vacancy->tenant_id !== $tenantId) return false;
            if ((int) $vacancy->user_id !== $ownerUserId) return false;

            JobVacancyTeam::where('tenant_id', $tenantId)
                ->where('vacancy_id', $vacancyId)
                ->where('user_id', $targetUserId)
                ->delete();

            return true;
        } catch (\Throwable $e) {
            Log::error('JobTeamService::removeMember failed', ['error' => $e->getMessage()]);
            return false;
        }
    }

    /**
     * List all team members for a vacancy.
     */
    public static function getMembers(int $vacancyId): array
    {
        $tenantId = TenantContext::getId();

        try {
            return JobVacancyTeam::with(['user:id,first_name,last_name,profile_type,organization_name,avatar_url,email'])
                ->where('tenant_id', $tenantId)
                ->where('vacancy_id', $vacancyId)
                ->get()
                ->toArray();
        } catch (\Throwable $e) {
            Log::error('JobTeamService::getMembers failed', ['error' => $e->getMessage()]);
            return [];
        }
    }
}
