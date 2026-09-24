<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Feature\Security\E035;

use App\Services\GroupWebhookService;
use GuzzleHttp\Psr7\Response as GuzzleResponse;
use GuzzleHttp\Psr7\StreamDecoratorTrait;
use GuzzleHttp\Psr7\Utils;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Http\Client\Response;
use Psr\Http\Message\StreamInterface;
use Tests\Laravel\TestCase;

/**
 * F-189 — responseExcerpt() must not buffer an unbounded webhook response body
 * into worker memory. It reads only a bounded prefix (enough to fill the excerpt).
 */
class GroupWebhookResponseExcerptTest extends TestCase
{
    use DatabaseTransactions;

    private function excerptFor(StreamInterface $body): ?string
    {
        $response = new Response(new GuzzleResponse(200, [], $body));
        $method = new \ReflectionMethod(GroupWebhookService::class, 'responseExcerpt');
        $method->setAccessible(true);

        return $method->invoke(null, $response);
    }

    public function testDoesNotReadBeyondTheCapForAnOversizeBody(): void
    {
        // 5 MB body — far larger than the excerpt cap.
        $counting = new class(Utils::streamFor(str_repeat('a', 5 * 1024 * 1024))) implements StreamInterface {
            use StreamDecoratorTrait;

            public int $bytesRead = 0;

            public function read(int $length): string
            {
                $data = $this->stream->read($length);
                $this->bytesRead += strlen($data);

                return $data;
            }
        };

        $excerpt = $this->excerptFor($counting);

        $this->assertNotNull($excerpt);
        $this->assertLessThanOrEqual(1000, mb_strlen($excerpt));
        // The whole 5 MB body must never have been pulled into memory.
        $this->assertLessThanOrEqual(4000, $counting->bytesRead);
    }

    public function testSmallBodyIsReturnedInFullAndEmptyBodyIsNull(): void
    {
        $this->assertSame('hello world', $this->excerptFor(Utils::streamFor('hello world')));
        $this->assertNull($this->excerptFor(Utils::streamFor('')));
        $this->assertNull($this->excerptFor(Utils::streamFor('   ')));
    }
}
