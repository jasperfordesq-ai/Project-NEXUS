<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Support\Messaging;

/**
 * Stable identifier for a one-to-one conversation between two members.
 *
 * One-to-one messages have no `conversations` row (`messages.conversation_id`
 * is null), so the pair of member ids is the only durable key. Two things are
 * derived from it and must agree with each other and with both clients:
 *
 *  - `of()` — the synthetic `conversation_id` carried in realtime payloads.
 *    It is a crc32 of "{min}-{max}", never a database id. The mobile app keys
 *    its thread handlers by the OTHER member's id, so a value that cannot be a
 *    user id makes it dispatch exactly once (via `message.sender.id`).
 *  - `chatSuffix()` — the per-pair private channel suffix, `chat.{min}-{max}`,
 *    which `PusherService::canAccessPrivateChannel` grants to either member.
 */
final class MessagePairId
{
    public static function of(int $a, int $b): int
    {
        [$min, $max] = self::ordered($a, $b);

        return crc32("{$min}-{$max}");
    }

    public static function chatSuffix(int $a, int $b): string
    {
        [$min, $max] = self::ordered($a, $b);

        return "chat.{$min}-{$max}";
    }

    /** @return array{0: int, 1: int} */
    private static function ordered(int $a, int $b): array
    {
        return $a <= $b ? [$a, $b] : [$b, $a];
    }
}
