<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Listeners;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Events\VolunteerOrganisationStatusChanged;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Services\EmailDispatchService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Tells the person who registered an organisation what an admin decided.
 *
 * Before 2026-08-28 an approval was completely silent: the status flipped, the
 * page cache refreshed, and the member who had registered days or weeks earlier
 * was told nothing. They could only discover it by going back and looking.
 *
 * Which transitions speak, and why:
 *
 *   pending   -> active/approved   APPROVED      the thing they were waiting for
 *   pending   -> declined          DECLINED      they must be told, or they wait forever
 *   active    -> suspended         SUSPENDED     their listings vanish; silence is worse
 *   suspended -> active/approved   REINSTATED    closes the loop on a suspension
 *
 * Anything else (a no-op re-save, pending -> pending) stays silent on purpose:
 * a notification that carries no news trains people to ignore the channel.
 */
class NotifyOwnerOfVolunteerOrganisationDecision implements ShouldQueue
{
    /** @see NotifyAdminOfNewVolunteerOrganisation for why retries are off. */
    public int $tries = 1;
    public int $timeout = 60;

    /** Statuses that mean "the community can see this organisation". */
    private const PUBLIC_STATUSES = ['approved', 'active'];

    public function handle(VolunteerOrganisationStatusChanged $event): void
    {
        $orgId    = $event->organisationId;
        $tenantId = $event->tenantId;

        if ($orgId <= 0 || $tenantId <= 0) {
            return;
        }

        $outcome = self::classify($event->previousStatus, $event->newStatus);
        if ($outcome === null) {
            return;
        }

        // Keyed on the transition, not just the organisation: an organisation
        // can legitimately be suspended and reinstated more than once, and each
        // of those is real news the owner should receive.
        $handledKey = sprintf(
            'notify_vol_org_decision:done:%d:%d:%s:%s',
            $tenantId,
            $orgId,
            $event->previousStatus,
            $event->newStatus
        );

        if (Cache::has($handledKey)) {
            return;
        }

        try {
            TenantContext::runForTenant($tenantId, function () use ($event, $orgId, $tenantId, $outcome, $handledKey): void {
                $organisation = DB::table('vol_organizations')
                    ->where('id', $orgId)
                    ->where('tenant_id', $tenantId)
                    ->first(['id', 'name', 'slug', 'user_id', 'status']);

                if (! $organisation || empty($organisation->user_id)) {
                    return;
                }

                $owner = DB::table('users')
                    ->where('id', $organisation->user_id)
                    ->where('tenant_id', $tenantId)
                    ->first(['id', 'email', 'first_name', 'name', 'preferred_language', 'status']);

                if (! $owner || empty($owner->email) || ($owner->status ?? '') === 'banned') {
                    return;
                }

                $tenantName = TenantContext::get()['name'] ?? __('emails.common.platform_name');
                $base       = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix();
                $orgName    = (string) ($organisation->name ?? '');

                // Approved organisations get a link to their live page; the
                // others go to the volunteering home, because the organisation
                // page is not publicly reachable in those states.
                $path = in_array($outcome, ['approved', 'reinstated'], true) && ! empty($organisation->slug)
                    ? '/volunteering/organisations/' . $organisation->slug
                    : '/volunteering';
                $url = $base . $path;

                LocaleContext::withLocale($owner, function () use (
                    $owner,
                    $outcome,
                    $orgName,
                    $path,
                    $url,
                    $tenantName,
                    $tenantId,
                    $event
                ): void {
                    $ownerName = $owner->first_name ?? $owner->name ?? __('emails.common.fallback_name');
                    $key       = 'emails_misc.vol_org_decision.' . $outcome;

                    $bell = __($key . '_bell', ['name' => $orgName]);
                    Notification::createNotification((int) $owner->id, $bell, $path, 'vol_org_' . $outcome);
                    \App\Services\NotificationDispatcher::fanOutPush(
                        (int) $owner->id,
                        'vol_org_' . $outcome,
                        $bell,
                        $path
                    );

                    $builder = EmailTemplateBuilder::make()
                        ->theme($outcome === 'approved' || $outcome === 'reinstated' ? 'success' : 'warning')
                        ->title(__($key . '_title'))
                        ->previewText(__($key . '_preview', ['name' => $orgName]))
                        ->greeting($ownerName)
                        ->paragraph(__($key . '_body', [
                            'name'      => htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8'),
                            'community' => htmlspecialchars($tenantName, ENT_QUOTES, 'UTF-8'),
                        ]))
                        ->highlight(htmlspecialchars($orgName, ENT_QUOTES, 'UTF-8'));

                    // A decline or a suspension without a reason is the thing
                    // people actually complain about, so pass one through
                    // whenever the admin gave one.
                    $reason = trim((string) ($event->reason ?? ''));
                    if ($reason !== '' && in_array($outcome, ['declined', 'suspended'], true)) {
                        $builder->paragraph(
                            __('emails_misc.vol_org_decision.reason_label') . ': '
                            . htmlspecialchars($reason, ENT_QUOTES, 'UTF-8')
                        );
                    }

                    $html = $builder
                        ->button(__($key . '_cta'), $url)
                        ->render();

                    if (! EmailDispatchService::sendRaw(
                        (string) $owner->email,
                        __($key . '_subject', ['name' => $orgName]),
                        $html,
                        null,
                        null,
                        null,
                        'volunteer_organisation_' . $outcome,
                        ['tenant_id' => $tenantId]
                    )) {
                        Log::warning('NotifyOwnerOfVolunteerOrganisationDecision: email send failed', [
                            'owner_id' => $owner->id,
                            'outcome'  => $outcome,
                        ]);
                    }
                });

                Cache::put($handledKey, 1, now()->addHours(24));
            });
        } catch (\Throwable $e) {
            Log::error('NotifyOwnerOfVolunteerOrganisationDecision listener failed', [
                'organisation_id' => $orgId,
                'tenant_id'       => $tenantId,
                'error'           => $e->getMessage(),
                'trace'           => $e->getTraceAsString(),
            ]);
        }
    }

    /**
     * Map a status transition to the message it deserves, or null for silence.
     */
    private static function classify(string $previous, string $new): ?string
    {
        if ($previous === $new) {
            return null;
        }

        $wasPublic = in_array($previous, self::PUBLIC_STATUSES, true);
        $isPublic  = in_array($new, self::PUBLIC_STATUSES, true);

        if ($previous === 'pending' && $isPublic) {
            return 'approved';
        }

        if ($previous === 'pending' && $new === 'declined') {
            return 'declined';
        }

        if ($wasPublic && $new === 'suspended') {
            return 'suspended';
        }

        if ($previous === 'suspended' && $isPublic) {
            return 'reinstated';
        }

        return null;
    }
}
