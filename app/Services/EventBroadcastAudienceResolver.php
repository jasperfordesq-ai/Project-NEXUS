<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use App\Enums\EventAttendanceState;
use App\Enums\EventBroadcastAudienceSegment;
use App\Enums\EventCapacityRegistrationState;
use App\Enums\EventWaitlistQueueState;
use App\Exceptions\EventBroadcastException;
use App\Models\Event;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/** Exact, canonical-only audience expansion with no legacy RSVP fallback. */
final class EventBroadcastAudienceResolver
{
    public function __construct(
        private readonly SafeguardingInteractionPolicy $safeguarding,
    ) {
    }

    /**
     * @param list<EventBroadcastAudienceSegment> $segments
     * @return array{recipient_ids:list<int>,recipient_count:int,segment_counts:array<string,int>}
     */
    public function resolve(Event $event, array $segments, bool $assertContactPolicy = true): array
    {
        $tenantId = (int) $event->tenant_id;
        $eventId = (int) $event->getKey();
        $organizerId = (int) $event->user_id;
        if ($tenantId <= 0 || $eventId <= 0 || $organizerId <= 0 || $segments === []) {
            throw new EventBroadcastException('event_broadcast_audience_invalid');
        }

        foreach ([
            'event_registrations' => ['tenant_id', 'event_id', 'user_id', 'registration_state'],
            'event_waitlist_entries' => ['tenant_id', 'event_id', 'user_id', 'queue_state', 'offer_expires_at'],
            'event_attendance' => ['tenant_id', 'event_id', 'user_id', 'attendance_status'],
        ] as $table => $columns) {
            if (! Schema::hasTable($table) || ! Schema::hasColumns($table, $columns)) {
                throw new EventBroadcastException('event_broadcast_audience_schema_unavailable');
            }
        }

        $recipientIds = collect();
        $segmentCounts = [];
        foreach ($segments as $segment) {
            if (! $segment instanceof EventBroadcastAudienceSegment) {
                throw new EventBroadcastException('event_broadcast_audience_segment_invalid');
            }
            $ids = $this->segmentQuery($tenantId, $eventId, $segment)
                ->join('users as broadcast_user', function ($join) use ($tenantId): void {
                    $join->on('broadcast_user.id', '=', 'broadcast_subject.user_id')
                        ->where('broadcast_user.tenant_id', '=', $tenantId)
                        ->where('broadcast_user.status', '=', 'active')
                        ->whereNull('broadcast_user.deleted_at');
                })
                ->where('broadcast_subject.user_id', '<>', $organizerId)
                ->distinct()
                ->pluck('broadcast_subject.user_id')
                ->map(static fn (mixed $id): int => (int) $id)
                ->filter(static fn (int $id): bool => $id > 0)
                ->values();
            $segmentCounts[$segment->value] = $ids->count();
            $recipientIds = $recipientIds->merge($ids);
        }

        $ids = $recipientIds
            ->unique()
            ->sort()
            ->values()
            ->all();
        if ($assertContactPolicy && $ids !== []) {
            $this->safeguarding->assertCommunitySpaceBroadcastAllowed(
                $organizerId,
                $ids,
                [],
                $tenantId,
                'event_broadcast',
            );
        }

        return [
            'recipient_ids' => $ids,
            'recipient_count' => count($ids),
            'segment_counts' => $segmentCounts,
        ];
    }

    private function segmentQuery(
        int $tenantId,
        int $eventId,
        EventBroadcastAudienceSegment $segment,
    ): Builder {
        $query = match ($segment) {
            EventBroadcastAudienceSegment::RegistrationConfirmed => DB::table('event_registrations')
                ->where('registration_state', EventCapacityRegistrationState::Confirmed->value),
            EventBroadcastAudienceSegment::WaitlistActive => DB::table('event_waitlist_entries')
                ->where(static function (Builder $active): void {
                    $active->where('queue_state', EventWaitlistQueueState::Waiting->value)
                        ->orWhere(static function (Builder $offered): void {
                            $offered->where('queue_state', EventWaitlistQueueState::Offered->value)
                                ->where('offer_expires_at', '>', now());
                        });
                }),
            EventBroadcastAudienceSegment::AttendanceAttended => DB::table('event_attendance')
                ->whereIn('attendance_status', [
                    EventAttendanceState::CheckedIn->value,
                    EventAttendanceState::CheckedOut->value,
                    EventAttendanceState::Attended->value,
                ]),
            EventBroadcastAudienceSegment::AttendanceNoShow => DB::table('event_attendance')
                ->where('attendance_status', EventAttendanceState::NoShow->value),
        };

        return $query
            ->from($query->from, 'broadcast_subject')
            ->where('broadcast_subject.tenant_id', $tenantId)
            ->where('broadcast_subject.event_id', $eventId)
            ->select('broadcast_subject.user_id');
    }
}
