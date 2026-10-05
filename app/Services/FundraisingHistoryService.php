<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use App\Support\UserDisplayName;
use Illuminate\Support\Facades\DB;

/**
 * The fundraising audit trail. The ONLY code that writes vol_fundraising_events
 * (append-only — the database refuses UPDATE and DELETE). Callers record inside
 * the same transaction as the change they describe and only on a real state
 * transition, so a replayed webhook never adds a second row. A failed write
 * throws and so undoes the change: an unrecorded money movement is worse than
 * a refused one. Stores record numbers only, never names or emails.
 */
final class FundraisingHistoryService
{
    public const ACTOR_COMMUNITY_ADMIN = 'community_admin';
    public const ACTOR_ORG_ADMIN = 'org_admin';
    public const ACTOR_MEMBER = 'member';
    public const ACTOR_STRIPE = 'stripe';
    public const ACTOR_SYSTEM = 'system';

    private const ACTOR_KINDS = [
        self::ACTOR_COMMUNITY_ADMIN, self::ACTOR_ORG_ADMIN, self::ACTOR_MEMBER,
        self::ACTOR_STRIPE, self::ACTOR_SYSTEM,
    ];

    public const EVENTS = [
        'campaign_created', 'campaign_updated', 'campaign_paused', 'campaign_resumed',
        'campaign_ended', 'campaign_organisation_set',
        'donation_started', 'donation_paid', 'donation_failed', 'donation_payment_not_started',
        'donation_refund_requested', 'donation_refunded', 'donation_partially_refunded',
        'handover_recorded', 'handover_confirmed', 'handover_cancelled',
    ];

    private const STAFF_KINDS = [self::ACTOR_COMMUNITY_ADMIN, self::ACTOR_ORG_ADMIN];

    /** @param array{giving_day_id?:?int,donation_id?:?int,handover_id?:?int,organization_id?:?int} $refs */
    public static function record(
        int $tenantId,
        string $event,
        string $actorKind,
        ?int $actorUserId,
        array $refs = [],
        ?float $amount = null,
        ?string $currency = null,
        ?array $details = null,
        ?string $stripeObjectId = null,
    ): int {
        if (! in_array($event, self::EVENTS, true)) {
            throw new \InvalidArgumentException("Unknown fundraising event: {$event}");
        }
        if (! in_array($actorKind, self::ACTOR_KINDS, true)) {
            throw new \InvalidArgumentException("Unknown fundraising actor kind: {$actorKind}");
        }

        $ref = static fn (string $key): ?int => isset($refs[$key]) && (int) $refs[$key] > 0 ? (int) $refs[$key] : null;

        return (int) DB::table('vol_fundraising_events')->insertGetId([
            'tenant_id' => $tenantId,
            'giving_day_id' => $ref('giving_day_id'),
            'donation_id' => $ref('donation_id'),
            'handover_id' => $ref('handover_id'),
            'organization_id' => $ref('organization_id'),
            'actor_user_id' => $actorUserId !== null && $actorUserId > 0 ? $actorUserId : null,
            'actor_kind' => $actorKind,
            'event' => $event,
            'amount' => $amount !== null ? round($amount, 2) : null,
            'currency' => $currency !== null ? strtoupper(substr($currency, 0, 3)) : null,
            'details' => $details !== null ? json_encode($details, JSON_THROW_ON_ERROR) : null,
            'stripe_object_id' => $stripeObjectId !== null ? substr($stripeObjectId, 0, 255) : null,
            'created_at' => now(),
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    public static function forCampaign(int $tenantId, int $givingDayId, bool $organisationView): array
    {
        $rows = DB::table('vol_fundraising_events')
            ->where('tenant_id', $tenantId)
            ->where('giving_day_id', $givingDayId)
            ->orderByDesc('id')
            ->limit(500)
            ->get();

        $actorIds = $rows->pluck('actor_user_id')->filter()->unique()->values()->all();
        $actors = $actorIds === [] ? collect() : DB::table('users')
            ->where('tenant_id', $tenantId)
            ->whereIn('id', $actorIds)
            ->get(['id', 'first_name', 'last_name', 'name', 'profile_type', 'organization_name'])
            ->keyBy('id');

        return $rows->map(function ($row) use ($actors, $organisationView) {
            $showActor = ! $organisationView || in_array($row->actor_kind, self::STAFF_KINDS, true);
            $actor = $row->actor_user_id ? $actors->get($row->actor_user_id) : null;

            return [
                'id' => (int) $row->id,
                'event' => (string) $row->event,
                'actor_kind' => (string) $row->actor_kind,
                'actor_name' => $showActor && $actor ? UserDisplayName::resolve($actor) : null,
                'amount' => $row->amount !== null ? (float) $row->amount : null,
                'currency' => $row->currency,
                'donation_id' => $row->donation_id !== null ? (int) $row->donation_id : null,
                'handover_id' => $row->handover_id !== null ? (int) $row->handover_id : null,
                'details' => $row->details !== null ? json_decode((string) $row->details, true) : null,
                'stripe_object_id' => $organisationView ? null : $row->stripe_object_id,
                'created_at' => (string) $row->created_at,
            ];
        })->all();
    }
}
