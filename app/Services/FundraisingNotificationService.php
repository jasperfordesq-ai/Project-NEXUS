<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\I18n\FormattingLocale;
use App\I18n\LocaleContext;
use App\Models\Notification;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Who is told what about organisation fundraising campaigns (owner, 6 Oct 2026):
 *
 *  - an organisation starts a campaign  → the community's admins, with a link that
 *    opens the pause confirmation (campaigns go live with no approval step, D3);
 *  - the community pauses or ends one   → the organisation's owners/admins;
 *  - the organisation confirms a hand-over → the community's admins;
 *  - a gift to an organisation's campaign is received (card payment succeeded, or
 *    a pledge marked paid) → the organisation's owners/admins, donor shown by name
 *    or "anonymous" only — never an email address or Gift Aid detail (D4).
 *
 * Every recipient gets a bell, a push and an email, rendered in their own
 * language. All of it runs AFTER the change is committed, and a failure is logged,
 * never thrown: a notification must not undo a campaign change, nor fail a Stripe
 * webhook (Stripe would retry the event for days).
 */
class FundraisingNotificationService
{
    private const BELL_TYPE = 'vol_fundraising';
    private const EMAIL_CATEGORY = 'volunteer_fundraising';

    /** An organisation's owner/admins started a campaign: tell the community's admins. */
    public static function campaignCreatedByOrganisation(int $tenantId, int $campaignId, int $actorUserId): void
    {
        self::guarded('campaign_created', $tenantId, function () use ($tenantId, $campaignId, $actorUserId) {
            $campaign = self::campaign($tenantId, $campaignId);
            if ($campaign === null || $campaign->organization_id === null) {
                return;
            }
            $actor = DB::table('users')->where('id', $actorUserId)->where('tenant_id', $tenantId)
                ->first(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name']);
            $currency = strtoupper((string) TenantContext::getCurrency());
            $link = '/admin/volunteering/giving-days?pause=' . (int) $campaign->id;

            foreach (self::communityAdmins($tenantId, [$actorUserId]) as $recipient) {
                self::deliver($recipient, $tenantId, $link, 'campaign-created:' . $campaign->id, function () use ($campaign, $actor, $currency) {
                    $dates = self::date((string) $campaign->start_date) . ' – ' . self::date((string) $campaign->end_date);
                    $params = [
                        'organisation' => (string) $campaign->organization_name,
                        'campaign' => (string) $campaign->title,
                        'person' => $actor ? UserDisplayName::resolve($actor) : (string) $campaign->organization_name,
                        'goal' => self::money((float) $campaign->goal_amount, $currency),
                        'dates' => $dates,
                    ];

                    return [
                        'params' => $params,
                        'bell' => 'campaign_created_bell',
                        'subject' => 'campaign_created_subject',
                        'title' => 'campaign_created_title',
                        'body' => 'campaign_created_body',
                        'cta' => 'campaign_created_cta',
                        'theme' => 'warning',
                    ];
                });
            }
        });
    }

    /**
     * A community admin paused or ended an organisation's campaign: tell the
     * organisation's owner/admins.
     *
     * @param string $event 'campaign_paused' or 'campaign_ended'
     */
    public static function campaignStoppedByCommunity(int $tenantId, int $campaignId, string $event, ?int $actorUserId): void
    {
        if (! in_array($event, ['campaign_paused', 'campaign_ended'], true)) {
            return;
        }
        self::guarded($event, $tenantId, function () use ($tenantId, $campaignId, $event, $actorUserId) {
            $campaign = self::campaign($tenantId, $campaignId);
            if ($campaign === null || $campaign->organization_id === null) {
                return;
            }
            $community = self::communityName($tenantId);
            $link = self::organisationLink((int) $campaign->organization_id);
            $kind = $event === 'campaign_paused' ? 'paused' : 'ended';
            $exclude = $actorUserId !== null ? [$actorUserId] : [];

            foreach (self::organisationAdmins($tenantId, (int) $campaign->organization_id, $exclude) as $recipient) {
                self::deliver($recipient, $tenantId, $link, "campaign-{$kind}:{$campaign->id}:" . now()->format('YmdHi'),
                    fn () => [
                        'params' => ['community' => $community, 'campaign' => (string) $campaign->title],
                        'bell' => "campaign_{$kind}_bell",
                        'subject' => "campaign_{$kind}_subject",
                        'title' => "campaign_{$kind}_title",
                        'body' => "campaign_{$kind}_body",
                        'cta' => 'campaign_stopped_cta',
                        'theme' => 'warning',
                    ]);
            }
        });
    }

    /** The organisation confirmed money passed on to it: tell the community's admins. */
    public static function handoverConfirmed(int $tenantId, int $handoverId, int $confirmedBy): void
    {
        self::guarded('handover_confirmed', $tenantId, function () use ($tenantId, $handoverId, $confirmedBy) {
            $handover = DB::table('vol_fundraising_handovers as h')
                ->join('vol_giving_days as g', function ($join) {
                    $join->on('g.id', '=', 'h.giving_day_id')->on('g.tenant_id', '=', 'h.tenant_id');
                })
                ->leftJoin('vol_organizations as o', function ($join) {
                    $join->on('o.id', '=', 'h.organization_id')->on('o.tenant_id', '=', 'h.tenant_id');
                })
                ->where('h.id', $handoverId)->where('h.tenant_id', $tenantId)->whereNotNull('h.confirmed_at')
                ->first(['h.id', 'h.giving_day_id', 'h.amount', 'h.currency', 'h.reference', 'g.title', 'o.name as organization_name']);
            if ($handover === null) {
                return;
            }
            $link = '/admin/volunteering/giving-days';

            foreach (self::communityAdmins($tenantId, [$confirmedBy]) as $recipient) {
                self::deliver($recipient, $tenantId, $link, 'handover-confirmed:' . $handover->id, fn () => [
                    'params' => [
                        'organisation' => (string) $handover->organization_name,
                        'campaign' => (string) $handover->title,
                        'amount' => self::money((float) $handover->amount, (string) $handover->currency),
                        'reference' => (string) $handover->reference,
                    ],
                    'bell' => 'handover_confirmed_bell',
                    'subject' => 'handover_confirmed_subject',
                    'title' => 'handover_confirmed_title',
                    'body' => 'handover_confirmed_body',
                    'cta' => 'handover_confirmed_cta',
                    'theme' => 'success',
                ]);
            }
        });
    }

    /**
     * A gift to an organisation's campaign was received (card payment succeeded,
     * or a pledge was marked paid): tell the organisation's owner/admins. Gifts
     * with no organisation are ignored — the community's admins already hear
     * about card gifts through DonationAdminNotificationService.
     */
    public static function giftReceived(int $tenantId, int $donationId): void
    {
        self::guarded('gift_received', $tenantId, function () use ($tenantId, $donationId) {
            $gift = DB::table('vol_donations')->where('id', $donationId)->where('tenant_id', $tenantId)
                ->where('status', 'completed')
                ->first(['id', 'user_id', 'giving_day_id', 'organization_id', 'amount', 'currency', 'donor_name', 'is_anonymous']);
            if ($gift === null || $gift->organization_id === null || $gift->giving_day_id === null) {
                return;
            }
            $campaign = self::campaign($tenantId, (int) $gift->giving_day_id);
            if ($campaign === null) {
                return;
            }
            $community = self::communityName($tenantId);
            $link = self::organisationLink((int) $gift->organization_id);
            $donorName = self::donorName($tenantId, $gift);

            foreach (self::organisationAdmins($tenantId, (int) $gift->organization_id) as $recipient) {
                self::deliver($recipient, $tenantId, $link, 'gift-received:' . $gift->id, fn () => [
                    'params' => [
                        'donor' => $donorName ?? __('fundraising.email.gift_anonymous'),
                        'amount' => self::money((float) $gift->amount, (string) $gift->currency),
                        'campaign' => (string) $campaign->title,
                        'organisation' => (string) $campaign->organization_name,
                        'community' => $community,
                    ],
                    'bell' => 'gift_received_bell',
                    'subject' => 'gift_received_subject',
                    'title' => 'gift_received_title',
                    'body' => 'gift_received_body',
                    'cta' => 'gift_received_cta',
                    'theme' => 'success',
                ]);
            }
        });
    }

    /**
     * The organisation's owner/admins: active `org_members` owners/admins plus
     * the organisation's own user. The same people VolunteerExpenseService::
     * isOrganisationAdmin lets manage the organisation.
     *
     * @param array<int, int> $excludeUserIds
     * @return \Illuminate\Support\Collection<int, object>
     */
    public static function organisationAdmins(int $tenantId, int $organisationId, array $excludeUserIds = [])
    {
        $owner = (int) DB::table('vol_organizations')->where('id', $organisationId)->where('tenant_id', $tenantId)->value('user_id');
        $ids = DB::table('org_members')->where('tenant_id', $tenantId)->where('organization_id', $organisationId)
            ->where('org_type', 'volunteer')->where('status', 'active')->whereIn('role', ['owner', 'admin'])
            ->pluck('user_id')->map(fn ($id) => (int) $id)->push($owner)
            ->filter(fn ($id) => $id > 0 && ! in_array($id, $excludeUserIds, true))->unique()->values()->all();
        if ($ids === []) {
            return collect();
        }

        return DB::table('users')->where('tenant_id', $tenantId)->whereIn('id', $ids)->where('status', 'active')
            ->get(['id', 'email', 'first_name', 'name', 'preferred_language']);
    }

    /**
     * @param array<int, int> $excludeUserIds
     * @return \Illuminate\Support\Collection<int, object>
     */
    private static function communityAdmins(int $tenantId, array $excludeUserIds)
    {
        return DonationAdminNotificationService::adminRecipients($tenantId)
            ->reject(fn ($admin) => in_array((int) $admin->id, $excludeUserIds, true))
            ->values();
    }

    /**
     * Bell + push + email to one recipient, in their own language.
     *
     * @param callable(): array{params: array<string, string>, bell: string, subject: string, title: string, body: string, cta: string, theme: string} $content
     */
    private static function deliver(object $recipient, int $tenantId, string $link, string $idempotency, callable $content): void
    {
        try {
            LocaleContext::withLocale($recipient, function () use ($recipient, $tenantId, $link, $idempotency, $content) {
                $c = $content();
                $bell = __('fundraising.email.' . $c['bell'], $c['params']);
                Notification::createNotification((int) $recipient->id, $bell, $link, self::BELL_TYPE, false, $tenantId);
                NotificationDispatcher::fanOutPush((int) $recipient->id, self::BELL_TYPE, $bell, $link);

                if (empty($recipient->email)) {
                    return;
                }
                $escaped = array_map(fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'), $c['params']);
                $html = EmailTemplateBuilder::make()
                    ->theme($c['theme'])
                    ->title(__('fundraising.email.' . $c['title'], $escaped))
                    ->previewText(__('fundraising.email.' . $c['subject'], $c['params']))
                    ->greeting($recipient->first_name ?: ($recipient->name ?: __('emails.common.fallback_name')))
                    ->paragraph(__('fundraising.email.' . $c['body'], $escaped))
                    ->button(__('fundraising.email.' . $c['cta']), EmailTemplateBuilder::tenantUrl($link))
                    ->render();
                $sent = EmailDispatchService::sendRaw(
                    (string) $recipient->email,
                    __('fundraising.email.' . $c['subject'], $c['params']),
                    $html,
                    null,
                    null,
                    null,
                    self::EMAIL_CATEGORY,
                    [
                        'tenant_id' => $tenantId,
                        'source' => 'FundraisingNotificationService',
                        'idempotency_key' => 'fundraising:' . $idempotency . ':' . (int) $recipient->id,
                    ],
                );
                if (! $sent) {
                    Log::warning('[FundraisingNotificationService] email not sent', ['user_id' => $recipient->id, 'key' => $idempotency]);
                }
            });
        } catch (\Throwable $e) {
            Log::warning('[FundraisingNotificationService] notification failed', [
                'user_id' => $recipient->id ?? null,
                'key' => $idempotency,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /** Runs a notification inside the right community; logs and swallows any failure. */
    private static function guarded(string $what, int $tenantId, callable $callback): void
    {
        try {
            TenantContext::runForTenant($tenantId, $callback);
        } catch (\Throwable $e) {
            Log::warning('[FundraisingNotificationService] ' . $what . ' failed', [
                'tenant_id' => $tenantId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private static function campaign(int $tenantId, int $campaignId): ?object
    {
        return DB::table('vol_giving_days as g')
            ->leftJoin('vol_organizations as o', function ($join) {
                $join->on('o.id', '=', 'g.organization_id')->on('o.tenant_id', '=', 'g.tenant_id');
            })
            ->where('g.id', $campaignId)->where('g.tenant_id', $tenantId)
            ->first(['g.id', 'g.title', 'g.goal_amount', 'g.start_date', 'g.end_date', 'g.organization_id', 'o.name as organization_name']);
    }

    /** Donor shown to the organisation: a name, or null for "anonymous" (never an email). */
    private static function donorName(int $tenantId, object $gift): ?string
    {
        if (! empty($gift->is_anonymous)) {
            return null;
        }
        $name = trim((string) ($gift->donor_name ?? ''));
        if ($name === '' && ! empty($gift->user_id)) {
            $user = DB::table('users')->where('id', (int) $gift->user_id)->where('tenant_id', $tenantId)
                ->first(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name']);
            $name = $user ? trim(UserDisplayName::resolve($user)) : '';
        }

        return $name !== '' ? $name : null;
    }

    private static function organisationLink(int $organisationId): string
    {
        return '/volunteering/org/' . $organisationId . '/dashboard?tab=fundraising';
    }

    private static function communityName(int $tenantId): string
    {
        return (string) DB::table('tenants')->where('id', $tenantId)->value('name');
    }

    private static function money(float $amount, string $currency): string
    {
        return number_format($amount, 2) . ' ' . strtoupper($currency);
    }

    private static function date(string $value): string
    {
        try {
            return \Carbon\Carbon::parse($value)->locale(FormattingLocale::carbon())->isoFormat('LL');
        } catch (\Throwable) {
            return $value;
        }
    }
}
