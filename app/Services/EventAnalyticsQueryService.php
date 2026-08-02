<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Core\TenantContext;
use App\Enums\EventAnalyticsFactStatus;
use App\Enums\EventAnalyticsMetric;
use App\Exceptions\EventAnalyticsException;
use App\Models\Event;
use App\Models\User;
use App\Policies\EventPolicy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Read-only, ledger-derived Events analytics for authorised organisers.
 *
 * Operational totals always come from their canonical ledgers. Optional
 * funnel facts remain consent-bound and are suppressed below the configured
 * privacy threshold; this service never copies either class of fact into a
 * second analytics store.
 */
final class EventAnalyticsQueryService
{
    /** @var list<string> */
    private const REQUIRED_TABLES = [
        'events',
        'event_registrations',
        'event_registration_history',
        'event_waitlist_entries',
        'event_waitlist_entry_history',
        'event_attendance',
        'event_attendance_credit_claims',
        'event_domain_outbox',
        'event_notification_deliveries',
        'event_analytics_optional_facts',
        'event_analytics_access_audits',
    ];

    public function __construct(
        private readonly EventPolicy $policy,
        private readonly EventAnalyticsService $analytics,
    ) {}

    /**
     * @return array<string,mixed>
     */
    public function summary(
        int $eventId,
        User $actor,
        string $accessScope = 'organizer_summary',
    ): array {
        $this->assertSchemaAvailable();
        $tenantId = $this->tenantId();
        [$persistedActor, $event] = $this->managedSubjects($tenantId, $eventId, $actor);
        if (! in_array($accessScope, ['organizer_summary', 'csv_export'], true)) {
            throw new EventAnalyticsException('event_analytics_access_scope_invalid');
        }

        $threshold = max(5, (int) config('events.analytics.privacy_threshold', 5));
        $generatedAt = CarbonImmutable::now('UTC')->startOfSecond();

        $summary = DB::transaction(function () use (
            $tenantId,
            $eventId,
            $persistedActor,
            $event,
            $accessScope,
            $threshold,
            $generatedAt,
        ): array {
            $registrations = $this->groupedCounts(
                'event_registrations',
                'registration_state',
                $tenantId,
                $eventId,
            );
            $registrationTransitions = $this->groupedCounts(
                'event_registration_history',
                'action',
                $tenantId,
                $eventId,
            );
            $waitlist = $this->groupedCounts(
                'event_waitlist_entries',
                'queue_state',
                $tenantId,
                $eventId,
            );
            $waitlistTransitions = $this->groupedCounts(
                'event_waitlist_entry_history',
                'action',
                $tenantId,
                $eventId,
            );
            $attendance = $this->attendanceCounts($tenantId, $eventId);
            $credits = $this->creditCounts($tenantId, $eventId);
            $communications = $this->communicationCounts($tenantId, $eventId);
            $optional = $this->optionalFunnel($tenantId, $eventId, $threshold);
            $invitations = $this->invitationCounts($tenantId, $eventId);
            $tickets = $this->ticketCounts(
                $tenantId,
                $eventId,
                $this->policy->manageFinance($persistedActor, $event),
            );
            $safeguarding = $this->safeguardingCounts($tenantId, $eventId, $threshold);

            $confirmed = (int) ($registrations['confirmed'] ?? 0);
            $pending = (int) ($registrations['pending'] ?? 0);
            $capacity = $event->getRawOriginal('max_attendees');
            $capacityLimit = $capacity === null || $capacity === '' ? null : max(0, (int) $capacity);
            $waitlistJoined = (int) ($waitlistTransitions['joined'] ?? 0);
            $waitlistAccepted = (int) ($waitlistTransitions['accepted'] ?? 0);
            $attendanceOutcomes = $attendance['attended'] + $attendance['checked_out'];
            $attendanceDenominator = $attendanceOutcomes + $attendance['no_show'];
            $invitationIssued = $invitations['issued'];
            $invitationAccepted = $invitations['accepted'];
            $optionalStarts = $optional['registration_starts'];

            $result = [
                'contract_version' => 1,
                'event_id' => $eventId,
                'event_title' => (string) $event->getAttribute('title'),
                'generated_at' => $generatedAt->toIso8601String(),
                'privacy_threshold' => $threshold,
                'registration' => [
                    'capacity_limit' => $capacityLimit,
                    'confirmed' => $confirmed,
                    'pending' => $pending,
                    'invited' => (int) ($registrations['invited'] ?? 0),
                    'declined' => (int) ($registrations['declined'] ?? 0),
                    'cancelled' => (int) ($registrations['cancelled'] ?? 0),
                    'remaining' => $capacityLimit === null
                        ? null
                        : max(0, $capacityLimit - $confirmed),
                    'completion_transitions' => (int) ($registrationTransitions['confirmed'] ?? 0),
                    'cancellation_transitions' => (int) ($registrationTransitions['cancelled'] ?? 0),
                ],
                'invitation' => [
                    ...$invitations,
                    'conversion' => $this->rate($invitationAccepted, $invitationIssued),
                ],
                'waitlist' => [
                    'current_waiting' => (int) ($waitlist['waiting'] ?? 0),
                    'current_offered' => (int) ($waitlist['offered'] ?? 0),
                    'joined' => $waitlistJoined,
                    'offered' => (int) ($waitlistTransitions['offered'] ?? 0),
                    'accepted' => $waitlistAccepted,
                    'expired' => (int) ($waitlistTransitions['expired'] ?? 0),
                    'cancelled' => (int) ($waitlistTransitions['cancelled'] ?? 0),
                    'conversion' => $this->rate($waitlistAccepted, $waitlistJoined),
                ],
                'attendance' => [
                    ...$attendance,
                    'attendance_rate' => $this->rate($attendanceOutcomes, $attendanceDenominator),
                ],
                'tickets' => $tickets,
                'credits' => $credits,
                'communications' => $communications,
                'optional_funnel' => [
                    ...$optional,
                    'start_to_registration_conversion' => $optionalStarts['suppressed']
                        ? $this->suppressedRate($confirmed)
                        : $this->rate($confirmed, (int) $optionalStarts['value']),
                ],
                'safeguarding' => $safeguarding,
            ];

            [$resultCount, $suppressedCount] = $this->auditCounts($result);
            $this->analytics->auditAccess(
                $eventId,
                $persistedActor,
                $accessScope,
                $accessScope === 'csv_export' ? 'csv_export' : 'dashboard_view',
                [
                    'contract_version' => 1,
                    'event_id' => $eventId,
                    'sections' => [
                        'registration', 'invitation', 'waitlist', 'attendance',
                        'tickets', 'credits', 'communications', 'optional_funnel',
                        'safeguarding',
                    ],
                ],
                $resultCount,
                $suppressedCount,
            );

            return $result;
        }, 3);

        return $summary;
    }

    /** @return array<string,int> */
    private function groupedCounts(
        string $table,
        string $column,
        int $tenantId,
        int $eventId,
    ): array {
        $rows = DB::table($table)
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->groupBy($column)
            ->get([$column, DB::raw('COUNT(*) AS aggregate_count')]);
        $counts = [];
        foreach ($rows as $row) {
            $counts[(string) $row->{$column}] = (int) $row->aggregate_count;
        }

        return $counts;
    }

    /** @return array{checked_in:int,checked_out:int,attended:int,no_show:int} */
    private function attendanceCounts(int $tenantId, int $eventId): array
    {
        $row = DB::table('event_attendance')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->selectRaw(<<<'SQL'
SUM(CASE WHEN attendance_status = 'checked_in' OR (attendance_status IS NULL AND checked_in_at IS NOT NULL AND checked_out_at IS NULL) THEN 1 ELSE 0 END) AS checked_in,
SUM(CASE WHEN attendance_status = 'checked_out' OR (attendance_status IS NULL AND checked_out_at IS NOT NULL) THEN 1 ELSE 0 END) AS checked_out,
SUM(CASE WHEN attendance_status = 'attended' THEN 1 ELSE 0 END) AS attended,
SUM(CASE WHEN attendance_status = 'no_show' THEN 1 ELSE 0 END) AS no_show
SQL)
            ->first();

        return [
            'checked_in' => (int) ($row?->checked_in ?? 0),
            'checked_out' => (int) ($row?->checked_out ?? 0),
            'attended' => (int) ($row?->attended ?? 0),
            'no_show' => (int) ($row?->no_show ?? 0),
        ];
    }

    /** @return array<string,mixed> */
    private function creditCounts(int $tenantId, int $eventId): array
    {
        $counts = $this->groupedCounts(
            'event_attendance_credit_claims',
            'status',
            $tenantId,
            $eventId,
        );
        $completed = DB::table('event_attendance_credit_claims')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', 'completed')
            ->selectRaw('COUNT(*) AS claim_count, COALESCE(SUM(amount), 0) AS amount')
            ->first();

        return [
            'completed_claims' => (int) ($completed?->claim_count ?? 0),
            'completed_amount' => number_format((float) ($completed?->amount ?? 0), 2, '.', ''),
            'pending_claims' => (int) ($counts['pending'] ?? 0),
            'failed_claims' => (int) ($counts['failed'] ?? 0),
            'reversed_claims' => (int) ($counts['reversed'] ?? 0),
        ];
    }

    /** @return array<string,mixed> */
    private function communicationCounts(int $tenantId, int $eventId): array
    {
        $rows = DB::table('event_notification_deliveries as delivery')
            ->join('event_domain_outbox as outbox', function ($join): void {
                $join->on('outbox.id', '=', 'delivery.outbox_id')
                    ->on('outbox.tenant_id', '=', 'delivery.tenant_id');
            })
            ->where('delivery.tenant_id', $tenantId)
            ->where('outbox.event_id', $eventId)
            ->groupBy('delivery.channel', 'delivery.status')
            ->get([
                'delivery.channel',
                'delivery.status',
                DB::raw('COUNT(*) AS aggregate_count'),
            ]);
        $totals = [
            'pending' => 0,
            'delivered' => 0,
            'suppressed' => 0,
            'failed' => 0,
            'dead_lettered' => 0,
        ];
        // Immutable zero template. $totals is a RUNNING accumulator below, so
        // seeding a newly-seen channel from it handed that channel every count
        // already tallied for earlier channels — the second and later channels
        // came out inflated.
        $channelZeroes = $totals;
        $channels = [];
        foreach ($rows as $row) {
            $channel = (string) $row->channel;
            $status = (string) $row->status;
            $count = (int) $row->aggregate_count;
            $channels[$channel] ??= $channelZeroes;
            if (array_key_exists($status, $totals)) {
                $totals[$status] += $count;
                $channels[$channel][$status] += $count;
            } elseif (in_array($status, ['processing', 'claimed', 'retry', 'retrying'], true)) {
                $totals['pending'] += $count;
                $channels[$channel]['pending'] += $count;
            } elseif ($status === 'failed_terminal') {
                $totals['dead_lettered'] += $count;
                $channels[$channel]['dead_lettered'] += $count;
            } else {
                $totals['failed'] += $count;
                $channels[$channel]['failed'] += $count;
            }
        }
        ksort($channels);
        $eligible = $totals['delivered'] + $totals['failed'] + $totals['dead_lettered'];

        return [
            ...$totals,
            'delivery_rate' => $this->rate($totals['delivered'], $eligible),
            'by_channel' => $channels,
        ];
    }

    /** @return array{event_views:array{value:?int,suppressed:bool},registration_starts:array{value:?int,suppressed:bool}} */
    private function optionalFunnel(int $tenantId, int $eventId, int $threshold): array
    {
        $rows = DB::table('event_analytics_optional_facts')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', EventAnalyticsFactStatus::Active->value)
            ->groupBy('metric')
            ->get(['metric', DB::raw('COUNT(*) AS aggregate_count')]);
        $counts = [];
        foreach ($rows as $row) {
            $counts[(string) $row->metric] = (int) $row->aggregate_count;
        }

        return [
            'event_views' => $this->privacyCount(
                (int) ($counts[EventAnalyticsMetric::EventViewed->value] ?? 0),
                $threshold,
            ),
            'registration_starts' => $this->privacyCount(
                (int) ($counts[EventAnalyticsMetric::RegistrationStarted->value] ?? 0),
                $threshold,
            ),
        ];
    }

    /** @return array{available:bool,issued:int,accepted:int,revoked:int,expired:int} */
    private function invitationCounts(int $tenantId, int $eventId): array
    {
        if (! Schema::hasTable('event_invitations')) {
            return ['available' => false, 'issued' => 0, 'accepted' => 0, 'revoked' => 0, 'expired' => 0];
        }
        $counts = $this->groupedCounts('event_invitations', 'status', $tenantId, $eventId);

        return [
            'available' => true,
            'issued' => array_sum($counts),
            'accepted' => (int) ($counts['accepted'] ?? 0),
            'revoked' => (int) ($counts['revoked'] ?? 0),
            'expired' => (int) ($counts['expired'] ?? 0),
        ];
    }

    /** @return array<string,mixed> */
    private function ticketCounts(int $tenantId, int $eventId, bool $canViewFinance): array
    {
        if (! Schema::hasTable('event_ticket_entitlements') || ! $canViewFinance) {
            return [
                'available' => Schema::hasTable('event_ticket_entitlements'),
                'redacted' => ! $canViewFinance,
                'confirmed_entitlements' => null,
                'confirmed_units' => null,
                'cancelled_units' => null,
                'confirmed_credit_value' => null,
            ];
        }
        $row = DB::table('event_ticket_entitlements')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->selectRaw(<<<'SQL'
SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_entitlements,
SUM(CASE WHEN status = 'confirmed' THEN units ELSE 0 END) AS confirmed_units,
SUM(CASE WHEN status = 'cancelled' THEN units ELSE 0 END) AS cancelled_units,
COALESCE(SUM(CASE WHEN status = 'confirmed' THEN total_price_credits_snapshot ELSE 0 END), 0) AS confirmed_credit_value
SQL)
            ->first();

        return [
            'available' => true,
            'redacted' => false,
            'confirmed_entitlements' => (int) ($row?->confirmed_entitlements ?? 0),
            'confirmed_units' => (int) ($row?->confirmed_units ?? 0),
            'cancelled_units' => (int) ($row?->cancelled_units ?? 0),
            'confirmed_credit_value' => number_format(
                (float) ($row?->confirmed_credit_value ?? 0),
                2,
                '.',
                '',
            ),
        ];
    }

    /** @return array<string,mixed> */
    private function safeguardingCounts(int $tenantId, int $eventId, int $threshold): array
    {
        if (! Schema::hasTable('event_guardian_consents')) {
            return ['available' => false, 'guardian_consents' => $this->privacyCount(0, $threshold)];
        }
        $count = DB::table('event_guardian_consents')
            ->where('tenant_id', $tenantId)
            ->where('event_id', $eventId)
            ->where('status', 'active')
            ->count();

        return [
            'available' => true,
            'guardian_consents' => $this->privacyCount((int) $count, $threshold),
        ];
    }

    /** @return array{value:?int,suppressed:bool} */
    private function privacyCount(int $value, int $threshold): array
    {
        return $value > 0 && $value < $threshold
            ? ['value' => null, 'suppressed' => true]
            : ['value' => $value, 'suppressed' => false];
    }

    /** @return array{numerator:int,denominator:int,basis_points:?int,suppressed:bool} */
    private function rate(int $numerator, int $denominator): array
    {
        return [
            'numerator' => max(0, $numerator),
            'denominator' => max(0, $denominator),
            'basis_points' => $denominator > 0
                ? (int) round((max(0, $numerator) / $denominator) * 10000)
                : null,
            'suppressed' => false,
        ];
    }

    /** @return array{numerator:int,denominator:int,basis_points:null,suppressed:true} */
    private function suppressedRate(int $numerator): array
    {
        return [
            'numerator' => max(0, $numerator),
            'denominator' => 0,
            'basis_points' => null,
            'suppressed' => true,
        ];
    }

    /** @param array<string,mixed> $summary @return array{int,int} */
    private function auditCounts(array $summary): array
    {
        $resultCount = 0;
        $suppressedCount = 0;
        $walk = function (mixed $value) use (&$walk, &$resultCount, &$suppressedCount): void {
            if (! is_array($value)) {
                return;
            }
            if (($value['suppressed'] ?? false) === true) {
                $suppressedCount++;
            }
            foreach ($value as $item) {
                if (is_int($item) && $item >= 0) {
                    $resultCount++;
                } elseif (is_array($item)) {
                    $walk($item);
                }
            }
        };
        $walk($summary);

        return [max($resultCount, $suppressedCount), $suppressedCount];
    }

    /** @return array{0:User,1:Event} */
    private function managedSubjects(int $tenantId, int $eventId, User $actor): array
    {
        $persisted = User::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey((int) $actor->getKey())
            ->where('status', 'active')
            ->whereNull('deleted_at')
            ->first();
        $event = Event::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($eventId)
            ->first();
        if (! $persisted instanceof User
            || (int) $actor->getAttribute('tenant_id') !== $tenantId
            || ! $event instanceof Event
            || ! $this->policy->manage($persisted, $event)) {
            // Hide cross-tenant and cross-organiser existence alike.
            throw new EventAnalyticsException('event_analytics_event_not_found');
        }

        return [$persisted, $event];
    }

    private function tenantId(): int
    {
        $tenantId = TenantContext::currentId();
        if ($tenantId === null || $tenantId <= 0) {
            throw new EventAnalyticsException('event_analytics_tenant_context_missing');
        }
        try {
            if (! TenantContext::hasFeature('events')) {
                throw new EventAnalyticsException('event_analytics_feature_disabled');
            }
        } catch (EventAnalyticsException $exception) {
            throw $exception;
        } catch (\Throwable) {
            throw new EventAnalyticsException('event_analytics_feature_disabled');
        }

        return $tenantId;
    }

    private function assertSchemaAvailable(): void
    {
        foreach (self::REQUIRED_TABLES as $table) {
            if (! Schema::hasTable($table)) {
                throw new EventAnalyticsException('event_analytics_schema_unavailable');
            }
        }
    }
}
