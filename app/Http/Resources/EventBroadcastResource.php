<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Http\Resources;

use App\Enums\EventBroadcastStatus;
use App\Models\EventBroadcast;
use BackedEnum;
use DateTimeInterface;

/** Manager projection with aggregate delivery evidence and no recipient identity. */
final class EventBroadcastResource
{
    /**
     * @param array{excerpt:?string,skipped_reasons:array<string,int>,failed_reasons:array<string,int>}|null $summary
     *        opt-in (`?include=summary`): the store app's strict schemas reject unknown fields
     * @return array<string,mixed>
     */
    public static function fromModel(
        EventBroadcast $broadcast,
        bool $includeBody = true,
        ?array $summary = null,
    ): array {
        $status = $broadcast->status instanceof BackedEnum
            ? (string) $broadcast->status->value
            : (string) $broadcast->getRawOriginal('status');
        $variant = $broadcast->variant instanceof BackedEnum
            ? (string) $broadcast->variant->value
            : (string) $broadcast->getRawOriginal('variant');
        $state = EventBroadcastStatus::tryFrom($status);

        $projection = [
            'contract_version' => 1,
            'id' => (int) $broadcast->id,
            'event_id' => (int) $broadcast->event_id,
            'variant' => $variant,
            'status' => $status,
            'version' => (int) $broadcast->broadcast_version,
            'audience' => [
                'segments' => self::strings($broadcast->audience_segments),
                'recipient_count' => max(0, (int) $broadcast->recipient_count),
            ],
            'channels' => self::strings($broadcast->channels),
            'body' => $includeBody ? (string) $broadcast->body : null,
            'delivery' => [
                'total' => max(0, (int) $broadcast->delivery_count),
                'delivered' => max(0, (int) $broadcast->delivered_count),
                'suppressed' => max(0, (int) $broadcast->suppressed_count),
                'dead_lettered' => max(0, (int) $broadcast->dead_letter_count),
                'failure_code' => self::reasonCode($broadcast->failure_code),
            ],
            'capabilities' => [
                'edit' => $state === EventBroadcastStatus::Draft,
                'schedule' => $state === EventBroadcastStatus::Draft,
                'cancel' => in_array($state, [
                    EventBroadcastStatus::Draft,
                    EventBroadcastStatus::Scheduled,
                ], true),
                'retry' => $state === EventBroadcastStatus::Failed,
            ],
            'scheduled_at' => self::timestamp($broadcast->scheduled_at),
            'cancelled_at' => self::timestamp($broadcast->cancelled_at),
            'sent_at' => self::timestamp($broadcast->sent_at),
            'failed_at' => self::timestamp($broadcast->failed_at),
            'created_at' => self::timestamp($broadcast->created_at),
            'updated_at' => self::timestamp($broadcast->updated_at),
        ];
        if ($summary !== null) {
            $projection['summary'] = $summary;
        }

        return $projection;
    }

    /** A short plain-text excerpt so the organiser can tell messages apart. */
    public static function excerpt(?string $body, int $length = 140): ?string
    {
        $collapsed = trim((string) preg_replace('/\s+/u', ' ', (string) $body));
        if ($collapsed === '') {
            return null;
        }

        return mb_strlen($collapsed) > $length
            ? rtrim(mb_substr($collapsed, 0, $length - 1)) . '…'
            : $collapsed;
    }

    /** @return list<string> */
    private static function strings(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            $value,
            static fn (mixed $item): bool => is_string($item) && trim($item) !== '',
        ));
    }

    private static function reasonCode(mixed $value): ?string
    {
        return is_string($value)
            && preg_match('/^event_broadcast_[a-z0-9_]{1,84}$/', $value) === 1
                ? $value
                : null;
    }

    private static function timestamp(mixed $value): ?string
    {
        return $value instanceof DateTimeInterface
            ? $value->format(DATE_ATOM)
            : (is_string($value) && trim($value) !== '' ? $value : null);
    }
}
