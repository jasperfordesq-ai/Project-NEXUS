<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

use Illuminate\Database\Query\Builder;
use InvalidArgumentException;

/** Single ownership boundary for authoritative Event notification-outbox facts. */
final class EventNotificationOutboxScope
{
    public static function apply(Builder $query, string $alias = ''): Builder
    {
        [$column, $modeColumn] = self::columns($alias);

        return $query
            ->where($modeColumn, 'outbox_authoritative')
            ->where(static function (Builder $actions) use ($column): void {
                $actions->where($column, 'event.lifecycle.transitioned')
                    ->orWhere($column, 'event.updated')
                    ->orWhere($column, 'event.reminder.due')
                    ->orWhereIn($column, self::GUARDIAN_CONSENT_ACTIONS)
                    ->orWhereIn($column, self::DELEGATED_ACTIONS)
                    ->orWhere($column, 'like', 'event.registration.%')
                    ->orWhere($column, 'like', 'event.waitlist.%')
                    ->orWhere($column, 'like', 'event.staff_role.%');
            });
    }

    /**
     * Select authoritative facts that no active Event outbox consumer owns,
     * other than the audit-only facts that are not meant to be consumed.
     */
    public static function applyUnowned(Builder $query, string $alias = ''): Builder
    {
        [$column, $modeColumn] = self::columns($alias);

        return $query
            ->where($modeColumn, 'outbox_authoritative')
            ->where(static function (Builder $unowned) use ($column): void {
                $unowned->whereNull($column)
                    ->orWhere(static function (Builder $actions) use ($column): void {
                        $actions->where($column, '<>', 'event.lifecycle.transitioned')
                            ->where($column, '<>', 'event.updated')
                            ->where($column, '<>', 'event.reminder.due')
                            ->whereNotIn($column, self::GUARDIAN_CONSENT_ACTIONS)
                            ->whereNotIn($column, self::DELEGATED_ACTIONS)
                            ->whereNotIn($column, self::AUDIT_ONLY_ACTIONS)
                            ->where($column, 'not like', 'event.registration.%')
                            ->where($column, 'not like', 'event.waitlist.%')
                            ->where($column, 'not like', 'event.staff_role.%');
                    });
            });
    }

    public static function includes(string $action): bool
    {
        return $action === 'event.lifecycle.transitioned'
            || $action === 'event.updated'
            || $action === 'event.reminder.due'
            || in_array($action, self::GUARDIAN_CONSENT_ACTIONS, true)
            || in_array($action, self::DELEGATED_ACTIONS, true)
            || str_starts_with($action, 'event.registration.')
            || str_starts_with($action, 'event.waitlist.')
            || str_starts_with($action, 'event.staff_role.');
    }

    /** @var list<string> */
    private const GUARDIAN_CONSENT_ACTIONS = [
        'event.safety.guardian_consent.requested',
        'event.safety.guardian_consent.granted',
        'event.safety.guardian_consent.withdrawn',
    ];

    /**
     * Facts EventNotificationOutboxActionHandler hands to a dedicated consumer
     * (EventInvitationDeliveryConsumer, EventRegistrationGuestNotificationConsumer).
     * Listed exactly: `event.registration_guest.%` is NOT matched by the
     * `event.registration.%` prefix, and without these entries the scheduled
     * processor never claimed either fact, so invitations and guest-withdrawal
     * emails sat `pending` for ever under outbox_authoritative delivery.
     *
     * @var list<string>
     */
    private const DELEGATED_ACTIONS = [
        'event.invitation.issued',
        'event.registration_guest.withdrawn',
    ];

    /**
     * Facts written as a durable audit record that no consumer is meant to
     * claim. EventAttendanceService records one per check-in / attendance
     * transition, but nothing notifies anyone about attendance and the
     * member-facing history is event_attendance_activity. Under the default
     * outbox_authoritative mode these rows stay `pending`, inert: they are
     * outside apply() (never claimed), and listed here so applyUnowned() and
     * the event health check stop reporting them as an unowned backlog. A
     * genuinely unknown action is still unowned. If a consumer for one of
     * these is ever built, move it into apply() and off this list.
     *
     * @var list<string>
     */
    private const AUDIT_ONLY_ACTIONS = [
        'event.attendance.recorded',
        'event.attendance.transitioned',
    ];

    /** @return array{string,string} */
    private static function columns(string $alias): array
    {
        if ($alias !== '' && preg_match('/^[a-z][a-z0-9_]*$/', $alias) !== 1) {
            throw new InvalidArgumentException('Event notification outbox alias is invalid.');
        }
        $prefix = $alias !== '' ? $alias . '.' : '';

        return [$prefix . 'action', $prefix . 'production_mode'];
    }
}
