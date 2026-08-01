<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Events;

use App\Enums\EventAttendanceAction;
use App\Enums\EventAttendanceState;
use App\Models\EventAttendance;

/** Result of one versioned, append-only attendance transition. */
final readonly class EventAttendanceTransitionResult
{
    public function __construct(
        public EventAttendance $attendance,
        public EventAttendanceAction $action,
        public EventAttendanceState $fromState,
        public EventAttendanceState $toState,
        public bool $changed,
        public bool $replayed,
        public ?int $activityId,
        public ?int $outboxId,
        /**
         * Outcome of the credit settle on a CheckIn transition (one of
         * EventCreditService::SETTLED_STATUSES), null for other actions.
         * Carried so the check-in UI can tell staff when a re-check-in after
         * an undo did NOT re-issue a reward (already_settled) — previously
         * the record() path reported this but the transition path silently
         * dropped it.
         */
        public ?string $creditStatus = null,
    ) {
    }

    /** @return array<string,mixed> */
    public function toArray(): array
    {
        return [
            'attendance_id' => (int) $this->attendance->getKey(),
            'event_id' => (int) $this->attendance->event_id,
            'user_id' => (int) $this->attendance->user_id,
            'action' => $this->action->value,
            'from_state' => $this->fromState->value,
            'to_state' => $this->toState->value,
            'changed' => $this->changed,
            'idempotent_replay' => $this->replayed,
            'attendance_version' => (int) ($this->attendance->attendance_version ?? 0),
            'changed_at' => $this->attendance->status_changed_at?->toIso8601String(),
            'checked_in_at' => $this->attendance->checked_in_at?->toIso8601String(),
            'checked_out_at' => $this->attendance->checked_out_at?->toIso8601String(),
            'history_entry_id' => $this->activityId,
            'credit_status' => $this->creditStatus,
        ];
    }
}
