<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\VolunteerOrganisationRegistered;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use App\Support\UserDisplayName;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Tells the admins who can actually approve it that an organisation is waiting.
 *
 * Registering a volunteering organisation notified nobody until 2026-08-28. The
 * plumbing was never missing — the safeguarding fanout emailed three admins four
 * minutes before one of these registrations went unannounced — there simply was
 * no event and no listener.
 *
 * 🔴 The audience is ADMINS ONLY, deliberately narrower than the equivalent
 * opportunity listener (which also mails brokers and coordinators). Approving an
 * organisation goes through `requireAdmin()`, and AdminTier deliberately refuses
 * broker and coordinator — so mailing them would be asking people to action
 * something the API will refuse them. The SQL below mirrors AdminTier::allows()
 * exactly, including the rule that broker/coordinator fail closed even when a
 * stale admin flag is still set on the row.
 */
class NotifyAdminOfNewVolunteerOrganisation implements ShouldQueue
{
    /**
     * One event, one fanout. Redis re-delivers at retry_after=90s, and a
     * re-delivery here would re-email every admin, so the job must fail rather
     * than be retried mid-flight; $timeout stays below retry_after and the Cache
     * guard below closes the concurrent-delivery window.
     */
    public int $tries = 1;
    public int $timeout = 60;

    public function handle(VolunteerOrganisationRegistered $event): void
    {
        $orgId    = $event->organisationId;
        $tenantId = $event->tenantId;

        if ($orgId <= 0 || $tenantId <= 0) {
            return;
        }

        $handledKey = 'notify_admin_new_vol_org:done:' . $tenantId . ':' . $orgId;
        $claimKey   = 'notify_admin_new_vol_org:claim:' . $tenantId . ':' . $orgId;

        if (Cache::has($handledKey)) {
            Log::info('NotifyAdminOfNewVolunteerOrganisation: duplicate fanout suppressed', [
                'organisation_id' => $orgId,
                'tenant_id'       => $tenantId,
            ]);

            return;
        }

        $claimAcquired = Cache::add($claimKey, 1, now()->addMinutes(5));
        if (! $claimAcquired) {
            Log::info('NotifyAdminOfNewVolunteerOrganisation: concurrent fanout suppressed', [
                'organisation_id' => $orgId,
                'tenant_id'       => $tenantId,
            ]);

            return;
        }

        try {
            TenantContext::runForTenant($tenantId, function () use ($event, $orgId, $tenantId, $handledKey): void {
                $organisation = DB::table('vol_organizations')
                    ->where('id', $orgId)
                    ->where('tenant_id', $tenantId)
                    ->first(['id', 'name', 'status', 'contact_email', 'user_id', 'description']);

                if (! $organisation) {
                    return;
                }

                // Only a genuinely WAITING organisation is worth an admin's
                // attention. The admin create endpoint calls the same service
                // sink and then approves immediately, so by the time this queued
                // job runs the row is already 'active' — do not email an admin
                // about a thing that admin just did.
                if ((string) $organisation->status !== 'pending') {
                    Log::info('NotifyAdminOfNewVolunteerOrganisation: no longer pending, skipping', [
                        'organisation_id' => $orgId,
                        'status'          => $organisation->status,
                    ]);

                    return;
                }

                $tenantName = TenantContext::get()['name'] ?? __('emails.common.platform_name');
                $adminPath  = '/admin/volunteering/organizations';
                $adminUrl   = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $adminPath;
                $orgName    = (string) ($organisation->name ?? '');

                $registrant = DB::table('users')
                    ->where('id', $event->registeredByUserId)
                    ->where('tenant_id', $tenantId)
                    ->first(['first_name', 'last_name', 'name', 'profile_type', 'organization_name', 'email']);

                $registrantName = $registrant
                    ? UserDisplayName::resolve($registrant, __('emails.common.fallback_member_name'))
                    : __('emails.common.fallback_member_name');

                $admins = self::adminRecipients($tenantId);

                if ($admins->isEmpty()) {
                    Log::warning('NotifyAdminOfNewVolunteerOrganisation: no admin recipients', [
                        'tenant_id' => $tenantId,
                    ]);

                    return;
                }

                foreach ($admins as $admin) {
                    $adminEmail = $admin->email ?? null;
                    if (! $adminEmail) {
                        continue;
                    }

                    LocaleContext::withLocale($admin, function () use (
                        $admin,
                        $adminEmail,
                        $adminPath,
                        $adminUrl,
                        $orgName,
                        $registrantName,
                        $tenantName,
                        $tenantId
                    ): void {
                        $adminName = $admin->first_name ?? $admin->name ?? __('emails.common.fallback_name');

                        $bell = __('emails_misc.admin_notify.new_vol_org_bell', ['name' => $orgName]);
                        Notification::createNotification((int) $admin->id, $bell, $adminPath, 'new_vol_org_registered');
                        \App\Services\NotificationDispatcher::fanOutPush(
                            (int) $admin->id,
                            'new_vol_org_registered',
                            $bell,
                            $adminPath
                        );

                        $subject = __('emails_misc.admin_notify.new_vol_org_subject', ['community' => $tenantName]);

                        $html = EmailTemplateBuilder::make()
                            // 'brand', not 'info': EmailTemplateBuilder has no 'info'
                            // theme and silently falls back to brand, which is what the
                            // older opportunity listener is unknowingly getting.
                            ->theme('brand')
                            ->title(__('emails_misc.admin_notify.new_vol_org_title'))
                            ->previewText(__('emails_misc.admin_notify.new_vol_org_preview', ['community' => $tenantName]))
                            ->greeting($adminName)
                            ->paragraph(__('emails_misc.admin_notify.new_vol_org_body', [
                                'community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8'),
                            ]))
                            ->highlight(htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8'))
                            ->bulletList([
                                __('emails_misc.admin_notify.new_vol_org_by_label') . ': '
                                    . htmlspecialchars($registrantName, ENT_QUOTES, 'UTF-8'),
                            ])
                            ->paragraph(__('emails_misc.admin_notify.new_vol_org_waiting'))
                            ->button(__('emails_misc.admin_notify.new_vol_org_cta'), $adminUrl)
                            ->render();

                        if (! EmailDispatchService::sendRaw(
                            $adminEmail,
                            $subject,
                            $html,
                            null,
                            null,
                            null,
                            'admin_new_volunteer_organisation',
                            ['tenant_id' => $tenantId]
                        )) {
                            Log::warning('NotifyAdminOfNewVolunteerOrganisation: email send failed', [
                                'admin_id' => $admin->id,
                            ]);
                        }
                    });
                }

                // Only after the whole fanout, so a re-delivery cannot re-email.
                Cache::put($handledKey, 1, now()->addHours(24));
            });
        } catch (\Throwable $e) {
            Log::error('NotifyAdminOfNewVolunteerOrganisation listener failed', [
                'organisation_id' => $orgId,
                'tenant_id'       => $tenantId,
                'error'           => $e->getMessage(),
                'trace'           => $e->getTraceAsString(),
            ]);
        } finally {
            Cache::forget($claimKey);
        }
    }

    /**
     * Admins of this tenant who can actually approve an organisation.
     *
     * Mirrors App\Support\Authorization\AdminTier::allows() in SQL: an admin
     * ROLE or any admin FLAG qualifies, but broker and coordinator are excluded
     * first so they fail closed even with a stale flag set — the same order
     * AdminTier applies. Selecting by role string alone would miss an admin
     * whose authority is only a flag, which is how `is_tenant_super_admin`
     * accounts get silently skipped elsewhere in this codebase.
     *
     * @return \Illuminate\Support\Collection<int, \stdClass>
     */
    private static function adminRecipients(int $tenantId): \Illuminate\Support\Collection
    {
        return DB::table('users')
            ->where('tenant_id', $tenantId)
            ->where('status', 'active')
            ->whereNotIn('role', \App\Support\Authorization\AdminTier::OPERATIONAL_ROLES)
            ->where(function ($q): void {
                $q->whereIn('role', \App\Support\Authorization\AdminTier::ROLES)
                    ->orWhere('is_admin', 1)
                    ->orWhere('is_super_admin', 1)
                    ->orWhere('is_tenant_super_admin', 1)
                    ->orWhere('is_god', 1);
            })
            ->whereNotNull('email')
            ->where('email', '!=', '')
            ->select(['id', 'email', 'first_name', 'name', 'preferred_language'])
            ->get();
    }
}
