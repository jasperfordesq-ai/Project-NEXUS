<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace Tests\Laravel\Unit\Support\Messaging;

use App\Support\Messaging\MessagePairId;
use PHPUnit\Framework\TestCase;

final class MessagePairIdTest extends TestCase
{
    public function test_pair_id_is_order_independent_and_matches_the_historical_crc32(): void
    {
        $this->assertSame(MessagePairId::of(9, 5), MessagePairId::of(5, 9));
        // The value the outbox has always dispatched, so existing consumers keep the same ids.
        $this->assertSame(crc32('5-9'), MessagePairId::of(9, 5));
    }

    public function test_chat_suffix_puts_the_smaller_id_first(): void
    {
        $this->assertSame('chat.5-9', MessagePairId::chatSuffix(9, 5));
        $this->assertSame('chat.5-9', MessagePairId::chatSuffix(5, 9));
    }
}
