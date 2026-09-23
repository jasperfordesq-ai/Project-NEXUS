<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Support;

use App\Support\BoundedResponseBody;
use PHPUnit\Framework\TestCase;

class BoundedResponseBodyTest extends TestCase
{
    public function test_accepts_a_body_exactly_at_the_limit(): void
    {
        $body = new BoundedResponseBody(8);

        $this->assertSame(4, $body->write('abcd'));
        $this->assertSame(4, $body->write('efgh'));
        $this->assertSame(8, $body->bytesWritten());
        $this->assertSame('abcdefgh', $body->contents());
    }

    public function test_rejects_the_first_chunk_that_would_exceed_the_limit(): void
    {
        $body = new BoundedResponseBody(8);
        $body->write('abcdef');

        try {
            $body->write('ghi');
            $this->fail('Expected an oversized decoded response chunk to be rejected.');
        } catch (\LengthException $exception) {
            $this->assertSame('Remote response body exceeds the allowed size.', $exception->getMessage());
        }

        $this->assertSame(6, $body->bytesWritten());
        $this->assertSame('abcdef', $body->contents());
    }

    public function test_rejects_many_chunks_without_accumulating_past_the_limit(): void
    {
        $body = new BoundedResponseBody(512000);
        $chunk = str_repeat('x', 16384);

        try {
            while (true) {
                $body->write($chunk);
            }
        } catch (\LengthException) {
            $this->assertLessThanOrEqual(512000, $body->bytesWritten());
            $this->assertSame($body->bytesWritten(), strlen($body->contents()));
        }
    }

    public function test_rejects_invalid_limits(): void
    {
        $this->expectException(\InvalidArgumentException::class);

        new BoundedResponseBody(0);
    }
}
