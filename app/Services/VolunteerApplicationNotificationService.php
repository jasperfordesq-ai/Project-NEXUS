<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\TenantContext;
use App\I18n\LocaleContext;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Who is told about a new volunteer application (owner, 8 Oct 2026):
 *
 *  - everyone who manages the organisation — its own user, its active
 *    owners/admins in org_members, and whoever posted the opportunity — gets a
 *    bell, a push and an email, once each;
 *  - the applicant gets a confirmation ("we've received your application"), or
 *    the acceptance email straight away when the community auto-approves.
 *
 * Both notice types are in NotificationDispatcher's instant list, so a member's
 * digest setting (default 'off') never silences them. Runs after the application
 * is committed; a failure is logged at error level and never undoes the
 * application.
 */
class VolunteerApplicationNotificationService
{
    public static function applicationSubmitted(int $tenantId, int $applicationId): void
    {
        try {
            TenantContext::runForTenant($tenantId, function () use ($tenantId, $applicationId) {
                $application = DB::table('vol_applications as a')
                    ->join('vol_opportunities as o', function ($join) {
                        $join->on('o.id', '=', 'a.opportunity_id')->on('o.tenant_id', '=', 'a.tenant_id');
                    })
                    ->where('a.id', $applicationId)->where('a.tenant_id', $tenantId)
                    ->first(['a.id', 'a.user_id', 'a.status', 'o.id as opportunity_id', 'o.title', 'o.organization_id', 'o.created_by']);
                if ($application === null) {
                    return;
                }

                self::notifyManagers($tenantId, $application);
                self::notifyApplicant($tenantId, $application);
            });
        } catch (\Throwable $e) {
            Log::error('[VolunteerApplicationNotificationService] application notices failed', [
                'tenant_id' => $tenantId,
                'application_id' => $applicationId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function notifyManagers(int $tenantId, object $application): void
    {
        $applicantId = (int) $application->user_id;
        $orgId = (int) $application->organization_id;

        $managers = FundraisingNotificationService::organisationAdmins($tenantId, $orgId, [$applicantId]);
        $posterId = (int) ($application->created_by ?? 0);
        if ($posterId > 0 && $posterId !== $applicantId && ! $managers->contains(fn ($m) => (int) $m->id === $posterId)) {
            $poster = DB::table('users')->where('tenant_id', $tenantId)->where('id', $posterId)->where('status', 'active')
                ->first(['id', 'email', 'first_name', 'name', 'preferred_language']);
            if ($poster !== null) {
                $managers->push($poster);
            }
        }

        $applicant = DB::table('users')->where('tenant_id', $tenantId)->where('id', $applicantId)
            ->first(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name']);
        $link = "/volunteering/org/{$orgId}/dashboard?tab=applications";

        foreach ($managers as $manager) {
            self::guarded((int) $manager->id, 'vol_application_received', function () use ($manager, $applicant, $application, $orgId, $link, $applicantId) {
                LocaleContext::withLocale($manager, function () use ($manager, $applicant, $application, $orgId, $link, $applicantId) {
                    $name = $applicant ? trim(UserDisplayName::resolve($applicant)) : '';
                    $name = $name !== '' ? $name : __('emails.common.fallback_someone');

                    return NotificationDispatcher::dispatch(
                        (int) $manager->id,
                        'global',
                        0,
                        'vol_application_received',
                        __('notifications.vol_application_received_body', ['name' => $name, 'title' => $application->title]),
                        $link,
                        NotificationDispatcher::buildVolApplicationReceivedEmail($name, (string) $application->title, $orgId),
                        false,
                        $applicantId,
                        null,
                        'vol-application-received:' . (int) $application->id,
                    );
                });
            });
        }
    }

    private static function notifyApplicant(int $tenantId, object $application): void
    {
        $applicant = DB::table('users')->where('tenant_id', $tenantId)->where('id', (int) $application->user_id)
            ->first(['id', 'preferred_language']);
        if ($applicant === null) {
            return;
        }
        $accepted = $application->status === 'approved';
        $type = $accepted ? 'vol_application_approved' : 'vol_application_submitted';

        self::guarded((int) $applicant->id, $type, function () use ($applicant, $application, $accepted, $type) {
            LocaleContext::withLocale($applicant, function () use ($applicant, $application, $accepted, $type) {
                $title = (string) $application->title;
                $oppId = (int) $application->opportunity_id;

                return NotificationDispatcher::dispatch(
                    (int) $applicant->id,
                    'global',
                    0,
                    $type,
                    __('notifications.' . $type . '_body', ['title' => $title]),
                    $accepted ? "/volunteering/opportunities/{$oppId}" : '/volunteering?tab=applications',
                    $accepted
                        ? NotificationDispatcher::buildVolApplicationApprovedEmail($title, $oppId)
                        : NotificationDispatcher::buildVolApplicationSubmittedEmail($title),
                    false,
                    null,
                    null,
                    $type . ':' . (int) $application->id,
                );
            });
        });
    }

    private static function guarded(int $userId, string $type, callable $send): void
    {
        try {
            if ($send() === false) {
                Log::error('[VolunteerApplicationNotificationService] notice not delivered', ['user_id' => $userId, 'type' => $type]);
            }
        } catch (\Throwable $e) {
            Log::error('[VolunteerApplicationNotificationService] notice failed', [
                'user_id' => $userId,
                'type' => $type,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
