<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Core\EmailTemplateBuilder;
use App\Core\TenantContext;
use App\Exceptions\FundraisingNotFoundException;
use App\I18n\LocaleContext;
use App\Services\FundraisingHistoryService as History;
use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Money a community passes on to the organisation a campaign raised it for.
 * Card gifts land in the community's Stripe account (owner decision 5 Oct 2026),
 * so this is where the audit trail continues: a community admin records the
 * transfer, the organisation confirms it arrived. Rows are never edited or
 * deleted (database-enforced); a mistake is cancelled with a reason.
 */
final class FundraisingHandoverService
{
    public const METHODS = ['bank_transfer', 'cheque', 'cash', 'other'];

    public static function record(int $tenantId, int $givingDayId, int $adminUserId, array $data): array
    {
        $amount = round((float) ($data['amount'] ?? 0), 2);
        $method = (string) ($data['method'] ?? '');
        $reference = trim((string) ($data['reference'] ?? ''));
        $note = trim((string) ($data['note'] ?? ''));
        $date = trim((string) ($data['handed_over_on'] ?? ''));

        if ($amount <= 0) {
            throw new \InvalidArgumentException(__('fundraising.handover_amount_positive'));
        }
        if (! in_array($method, self::METHODS, true)) {
            throw new \InvalidArgumentException(__('fundraising.handover_method_invalid'));
        }
        if ($reference === '') {
            throw new \InvalidArgumentException(__('fundraising.handover_reference_required'));
        }
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date);
        if ($parsed === false || $parsed->format('Y-m-d') !== $date || $parsed > new \DateTimeImmutable('today')) {
            throw new \InvalidArgumentException(__('fundraising.handover_date_invalid'));
        }

        $id = DB::transaction(function () use ($tenantId, $givingDayId, $adminUserId, $amount, $method, $reference, $note, $date) {
            $campaign = DB::table('vol_giving_days')
                ->where('id', $givingDayId)->where('tenant_id', $tenantId)
                ->lockForUpdate()->first(['id', 'organization_id', 'raised_amount']);
            if (! $campaign) {
                throw new FundraisingNotFoundException(__('fundraising.campaign_not_found'));
            }
            if ($campaign->organization_id === null) {
                throw new \InvalidArgumentException(__('fundraising.handover_campaign_has_no_organisation'));
            }

            $currency = strtoupper((string) TenantContext::getCurrency());
            $held = round((float) $campaign->raised_amount - self::handedOver($tenantId, $givingDayId), 2);
            if ($amount > $held) {
                throw new \InvalidArgumentException(__('fundraising.handover_exceeds_held', [
                    'held' => number_format(max($held, 0), 2) . ' ' . $currency,
                ]));
            }

            $handoverId = (int) DB::table('vol_fundraising_handovers')->insertGetId([
                'tenant_id' => $tenantId,
                'giving_day_id' => $givingDayId,
                'organization_id' => (int) $campaign->organization_id,
                'amount' => $amount,
                'currency' => $currency,
                'handed_over_on' => $date,
                'method' => $method,
                'reference' => mb_substr($reference, 0, 255),
                'note' => $note !== '' ? $note : null,
                'recorded_by' => $adminUserId,
                'created_at' => now(),
            ]);
            History::record($tenantId, 'handover_recorded', History::ACTOR_COMMUNITY_ADMIN, $adminUserId, [
                'giving_day_id' => $givingDayId, 'handover_id' => $handoverId,
                'organization_id' => (int) $campaign->organization_id,
            ], $amount, $currency, ['handed_over_on' => $date, 'method' => $method, 'reference' => $reference]);

            return $handoverId;
        });

        $handover = self::find($tenantId, $id);
        self::notifyOrganisation($tenantId, $handover);

        return self::format($handover);
    }

    public static function cancel(int $tenantId, int $handoverId, int $adminUserId, string $reason): array
    {
        $reason = trim($reason);
        if ($reason === '') {
            throw new \InvalidArgumentException(__('fundraising.cancel_reason_required'));
        }
        DB::transaction(function () use ($tenantId, $handoverId, $adminUserId, $reason) {
            $row = self::lockOpen($tenantId, $handoverId);
            DB::table('vol_fundraising_handovers')
                ->where('id', $handoverId)->where('tenant_id', $tenantId)
                ->whereNull('cancelled_at')->whereNull('confirmed_at')
                ->update(['cancelled_by' => $adminUserId, 'cancelled_at' => now(), 'cancel_reason' => mb_substr($reason, 0, 500)]);
            History::record($tenantId, 'handover_cancelled', History::ACTOR_COMMUNITY_ADMIN, $adminUserId, [
                'giving_day_id' => (int) $row->giving_day_id, 'handover_id' => $handoverId,
                'organization_id' => (int) $row->organization_id,
            ], (float) $row->amount, $row->currency, ['reason' => $reason]);
        });

        return self::format(self::find($tenantId, $handoverId));
    }

    public static function confirm(int $tenantId, int $organizationId, int $handoverId, int $userId): array
    {
        if (! VolunteerExpenseService::isOrganisationAdmin($tenantId, $userId, $organizationId)) {
            throw new FundraisingNotFoundException(__('fundraising.handover_not_found'));
        }
        DB::transaction(function () use ($tenantId, $organizationId, $handoverId, $userId) {
            $row = self::lockOpen($tenantId, $handoverId);
            if ((int) $row->organization_id !== $organizationId) {
                throw new FundraisingNotFoundException(__('fundraising.handover_not_found'));
            }
            DB::table('vol_fundraising_handovers')
                ->where('id', $handoverId)->where('tenant_id', $tenantId)
                ->whereNull('cancelled_at')->whereNull('confirmed_at')
                ->update(['confirmed_by' => $userId, 'confirmed_at' => now()]);
            History::record($tenantId, 'handover_confirmed', History::ACTOR_ORG_ADMIN, $userId, [
                'giving_day_id' => (int) $row->giving_day_id, 'handover_id' => $handoverId,
                'organization_id' => $organizationId,
            ], (float) $row->amount, $row->currency);
        });

        return self::format(self::find($tenantId, $handoverId));
    }

    /** @return array{items: array<int, array<string, mixed>>, summary: array{raised: float, handed_over: float, still_held: float, currency: string}} */
    public static function listForCampaign(int $tenantId, int $givingDayId): array
    {
        $raised = DB::table('vol_giving_days')->where('id', $givingDayId)->where('tenant_id', $tenantId)->value('raised_amount');
        if ($raised === null) {
            throw new FundraisingNotFoundException(__('fundraising.campaign_not_found'));
        }
        $rows = DB::table('vol_fundraising_handovers')
            ->where('tenant_id', $tenantId)->where('giving_day_id', $givingDayId)
            ->orderByDesc('id')->get();
        $handedOver = self::handedOver($tenantId, $givingDayId);
        $names = self::names($tenantId, $rows->flatMap(fn ($r) => [$r->recorded_by, $r->confirmed_by, $r->cancelled_by])->filter()->unique()->all());

        return [
            'items' => $rows->map(fn ($r) => self::format($r, $names))->all(),
            'summary' => [
                'raised' => round((float) $raised, 2),
                'handed_over' => $handedOver,
                'still_held' => round((float) $raised - $handedOver, 2),
                'currency' => strtoupper((string) TenantContext::getCurrency()),
            ],
        ];
    }

    private static function handedOver(int $tenantId, int $givingDayId): float
    {
        return round((float) DB::table('vol_fundraising_handovers')
            ->where('tenant_id', $tenantId)->where('giving_day_id', $givingDayId)
            ->whereNull('cancelled_at')->sum('amount'), 2);
    }

    private static function lockOpen(int $tenantId, int $handoverId): object
    {
        $row = DB::table('vol_fundraising_handovers')
            ->where('id', $handoverId)->where('tenant_id', $tenantId)->lockForUpdate()->first();
        if (! $row) {
            throw new FundraisingNotFoundException(__('fundraising.handover_not_found'));
        }
        if ($row->cancelled_at !== null || $row->confirmed_at !== null) {
            throw new \InvalidArgumentException(__('fundraising.handover_already_closed'));
        }
        return $row;
    }

    private static function find(int $tenantId, int $handoverId): object
    {
        $row = DB::table('vol_fundraising_handovers')->where('id', $handoverId)->where('tenant_id', $tenantId)->first();
        if (! $row) {
            throw new FundraisingNotFoundException(__('fundraising.handover_not_found'));
        }
        return $row;
    }

    /** @param array<int, string> $ids @return array<int, string> */
    private static function names(int $tenantId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        return DB::table('users')->where('tenant_id', $tenantId)->whereIn('id', $ids)
            ->get(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name'])
            ->mapWithKeys(fn ($u) => [(int) $u->id => UserDisplayName::resolve($u)])->all();
    }

    /** @param array<int, string>|null $names */
    private static function format(object $r, ?array $names = null): array
    {
        $names ??= self::names((int) $r->tenant_id, array_values(array_filter([$r->recorded_by, $r->confirmed_by, $r->cancelled_by])));
        $name = static fn ($id) => $id ? ($names[(int) $id] ?? null) : null;

        return [
            'id' => (int) $r->id,
            'giving_day_id' => (int) $r->giving_day_id,
            'organization_id' => (int) $r->organization_id,
            'amount' => (float) $r->amount,
            'currency' => (string) $r->currency,
            'handed_over_on' => (string) $r->handed_over_on,
            'method' => (string) $r->method,
            'reference' => (string) $r->reference,
            'note' => $r->note,
            'status' => $r->cancelled_at !== null ? 'cancelled' : ($r->confirmed_at !== null ? 'confirmed' : 'recorded'),
            'recorded_by_name' => $name($r->recorded_by),
            'created_at' => (string) $r->created_at,
            'confirmed_by_name' => $name($r->confirmed_by),
            'confirmed_at' => $r->confirmed_at,
            'cancelled_by_name' => $name($r->cancelled_by),
            'cancelled_at' => $r->cancelled_at,
            'cancel_reason' => $r->cancel_reason,
        ];
    }

    /** Bell + email to the organisation's owner/admins, each in their own language. */
    private static function notifyOrganisation(int $tenantId, object $handover): void
    {
        // Mirrors VolunteerExpenseService::notifyOrganisationOfNewClaim. The hand-over
        // is already committed; a failed notification is logged, never undone.
        try {
            $org = DB::table('vol_organizations')->where('id', $handover->organization_id)->where('tenant_id', $tenantId)->first(['user_id', 'name']);
            $campaign = (string) DB::table('vol_giving_days')->where('id', $handover->giving_day_id)->where('tenant_id', $tenantId)->value('title');
            $community = (string) DB::table('tenants')->where('id', $tenantId)->value('name');
            $ids = DB::table('org_members')->where('tenant_id', $tenantId)->where('organization_id', $handover->organization_id)
                ->where('org_type', 'volunteer')->where('status', 'active')->whereIn('role', ['owner', 'admin'])
                ->pluck('user_id')->map(fn ($id) => (int) $id)->push((int) ($org->user_id ?? 0))
                ->filter()->unique()->values()->all();
            if ($ids === []) {
                return;
            }
            $recipients = DB::table('users')->where('tenant_id', $tenantId)->whereIn('id', $ids)
                ->get(['id', 'email', 'first_name', 'name', 'preferred_language']);
            $link = '/volunteering/org/' . (int) $handover->organization_id . '/dashboard?tab=fundraising';
            $fullUrl = TenantContext::getFrontendUrl() . TenantContext::getSlugPrefix() . $link;
            $params = [
                'community' => $community,
                'amount' => number_format((float) $handover->amount, 2) . ' ' . $handover->currency,
                'campaign' => $campaign,
                'organisation' => (string) ($org->name ?? ''),
                'date' => (string) $handover->handed_over_on,
                'reference' => (string) $handover->reference,
            ];

            foreach ($recipients as $recipient) {
                LocaleContext::withLocale($recipient, function () use ($recipient, $params, $link, $fullUrl, $tenantId) {
                    $bell = __('fundraising.email.handover_bell', $params);
                    \App\Models\Notification::createNotification((int) $recipient->id, $bell, $link, 'vol_fundraising_handover');
                    \App\Services\NotificationDispatcher::fanOutPush((int) $recipient->id, 'vol_fundraising_handover', $bell, $link);
                    if (empty($recipient->email)) {
                        return;
                    }
                    $escaped = array_map(fn ($v) => htmlspecialchars((string) $v, ENT_QUOTES, 'UTF-8'), $params);
                    $html = EmailTemplateBuilder::make()
                        ->title(__('fundraising.email.handover_title', $escaped))
                        ->greeting($recipient->first_name ?? $recipient->name ?? __('emails.common.fallback_name'))
                        ->paragraph(__('fundraising.email.handover_body', $escaped))
                        ->button(__('fundraising.email.handover_cta'), $fullUrl)
                        ->render();
                    if (! EmailDispatchService::sendRaw($recipient->email, __('fundraising.email.handover_subject', $params), $html, null, null, null, 'volunteer_fundraising', ['tenant_id' => $tenantId])) {
                        Log::warning('[FundraisingHandoverService] hand-over email failed', ['user_id' => $recipient->id]);
                    }
                });
            }
        } catch (\Throwable $e) {
            Log::warning('[FundraisingHandoverService] hand-over notification error: ' . $e->getMessage());
        }
    }
}
