<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

/** Explicit, identity-free projection for an authorised Event analytics read. */
final class EventAnalyticsResource
{
    /** @param array<string,mixed> $summary @return array<string,mixed> */
    public static function fromSummary(array $summary): array
    {
        return [
            'contract_version' => (int) ($summary['contract_version'] ?? 1),
            'event_id' => (int) ($summary['event_id'] ?? 0),
            'event_title' => self::text($summary['event_title'] ?? null),
            'generated_at' => self::text($summary['generated_at'] ?? null),
            'privacy_threshold' => max(5, (int) ($summary['privacy_threshold'] ?? 5)),
            'registration' => self::registration(self::array($summary['registration'] ?? null)),
            'invitation' => self::invitation(self::array($summary['invitation'] ?? null)),
            'waitlist' => self::waitlist(self::array($summary['waitlist'] ?? null)),
            'attendance' => self::attendance(self::array($summary['attendance'] ?? null)),
            'tickets' => self::tickets(self::array($summary['tickets'] ?? null)),
            'credits' => self::credits(self::array($summary['credits'] ?? null)),
            'communications' => self::communications(
                self::array($summary['communications'] ?? null),
            ),
            'optional_funnel' => self::optionalFunnel(
                self::array($summary['optional_funnel'] ?? null),
            ),
            'safeguarding' => self::safeguarding(
                self::array($summary['safeguarding'] ?? null),
            ),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function registration(array $value): array
    {
        return [
            'capacity_limit' => self::nullableInt($value['capacity_limit'] ?? null),
            'confirmed' => self::count($value['confirmed'] ?? 0),
            'pending' => self::count($value['pending'] ?? 0),
            'invited' => self::count($value['invited'] ?? 0),
            'declined' => self::count($value['declined'] ?? 0),
            'cancelled' => self::count($value['cancelled'] ?? 0),
            'remaining' => self::nullableInt($value['remaining'] ?? null),
            'completion_transitions' => self::count($value['completion_transitions'] ?? 0),
            'cancellation_transitions' => self::count($value['cancellation_transitions'] ?? 0),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function invitation(array $value): array
    {
        return [
            'available' => (bool) ($value['available'] ?? false),
            'issued' => self::count($value['issued'] ?? 0),
            'accepted' => self::count($value['accepted'] ?? 0),
            'revoked' => self::count($value['revoked'] ?? 0),
            'expired' => self::count($value['expired'] ?? 0),
            'conversion' => self::rate(self::array($value['conversion'] ?? null)),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function waitlist(array $value): array
    {
        return [
            'current_waiting' => self::count($value['current_waiting'] ?? 0),
            'current_offered' => self::count($value['current_offered'] ?? 0),
            'joined' => self::count($value['joined'] ?? 0),
            'offered' => self::count($value['offered'] ?? 0),
            'accepted' => self::count($value['accepted'] ?? 0),
            'expired' => self::count($value['expired'] ?? 0),
            'cancelled' => self::count($value['cancelled'] ?? 0),
            'conversion' => self::rate(self::array($value['conversion'] ?? null)),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function attendance(array $value): array
    {
        return [
            'checked_in' => self::count($value['checked_in'] ?? 0),
            'checked_out' => self::count($value['checked_out'] ?? 0),
            'attended' => self::count($value['attended'] ?? 0),
            'no_show' => self::count($value['no_show'] ?? 0),
            'attendance_rate' => self::rate(self::array($value['attendance_rate'] ?? null)),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function tickets(array $value): array
    {
        return [
            'available' => (bool) ($value['available'] ?? false),
            'redacted' => (bool) ($value['redacted'] ?? true),
            'confirmed_entitlements' => self::nullableInt($value['confirmed_entitlements'] ?? null),
            'confirmed_units' => self::nullableInt($value['confirmed_units'] ?? null),
            'cancelled_units' => self::nullableInt($value['cancelled_units'] ?? null),
            'confirmed_credit_value' => self::text($value['confirmed_credit_value'] ?? null),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function credits(array $value): array
    {
        return [
            'completed_claims' => self::count($value['completed_claims'] ?? 0),
            'completed_amount' => self::text($value['completed_amount'] ?? null) ?? '0.00',
            'pending_claims' => self::count($value['pending_claims'] ?? 0),
            'failed_claims' => self::count($value['failed_claims'] ?? 0),
            'reversed_claims' => self::count($value['reversed_claims'] ?? 0),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function communications(array $value): array
    {
        $channels = [];
        foreach (self::array($value['by_channel'] ?? null) as $name => $counts) {
            if (! is_string($name) || ! is_array($counts)) {
                continue;
            }
            $channels[$name] = [
                'pending' => self::count($counts['pending'] ?? 0),
                'delivered' => self::count($counts['delivered'] ?? 0),
                'suppressed' => self::count($counts['suppressed'] ?? 0),
                'failed' => self::count($counts['failed'] ?? 0),
                'dead_lettered' => self::count($counts['dead_lettered'] ?? 0),
            ];
        }
        ksort($channels);

        return [
            'pending' => self::count($value['pending'] ?? 0),
            'delivered' => self::count($value['delivered'] ?? 0),
            'suppressed' => self::count($value['suppressed'] ?? 0),
            'failed' => self::count($value['failed'] ?? 0),
            'dead_lettered' => self::count($value['dead_lettered'] ?? 0),
            'delivery_rate' => self::rate(self::array($value['delivery_rate'] ?? null)),
            // Cast so an EMPTY map serialises as {} and not []. PHP has one
            // array type, so json_encode turns an empty map into a JSON ARRAY —
            // and the client's schema declares this as a record, so the whole
            // analytics response was rejected as contract drift for every event
            // with no notification deliveries yet. That is most events, which is
            // why the analytics tab simply said "could not be loaded".
            'by_channel' => (object) $channels,
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function optionalFunnel(array $value): array
    {
        return [
            'event_views' => self::privacyCount(self::array($value['event_views'] ?? null)),
            'registration_starts' => self::privacyCount(
                self::array($value['registration_starts'] ?? null),
            ),
            'start_to_registration_conversion' => self::rate(
                self::array($value['start_to_registration_conversion'] ?? null),
            ),
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function safeguarding(array $value): array
    {
        return [
            'available' => (bool) ($value['available'] ?? false),
            'guardian_consents' => self::privacyCount(
                self::array($value['guardian_consents'] ?? null),
            ),
        ];
    }

    /** @param array<string,mixed> $value @return array{value:?int,suppressed:bool} */
    private static function privacyCount(array $value): array
    {
        $suppressed = (bool) ($value['suppressed'] ?? false);

        return [
            'value' => $suppressed ? null : self::nullableInt($value['value'] ?? null),
            'suppressed' => $suppressed,
        ];
    }

    /** @param array<string,mixed> $value @return array<string,mixed> */
    private static function rate(array $value): array
    {
        $suppressed = (bool) ($value['suppressed'] ?? false);

        return [
            'numerator' => self::count($value['numerator'] ?? 0),
            'denominator' => self::count($value['denominator'] ?? 0),
            'basis_points' => $suppressed
                ? null
                : self::nullableInt($value['basis_points'] ?? null),
            'suppressed' => $suppressed,
        ];
    }

    /** @return array<string,mixed> */
    private static function array(mixed $value): array
    {
        return is_array($value) ? $value : [];
    }

    private static function count(mixed $value): int
    {
        return is_numeric($value) ? max(0, (int) $value) : 0;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return is_numeric($value) ? max(0, (int) $value) : null;
    }

    private static function text(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = trim($value);

        return $value === '' ? null : $value;
    }
}
