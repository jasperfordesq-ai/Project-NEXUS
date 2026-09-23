<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Tests\Laravel\Unit\Services;

use App\Services\LinkPreviewService;
use App\Support\BoundedResponseBody;
use GuzzleHttp\Client;
use GuzzleHttp\Handler\MockHandler;
use GuzzleHttp\HandlerStack;
use GuzzleHttp\Psr7\Response;
use Tests\Laravel\TestCase;

class LinkPreviewResponseLimitTest extends TestCase
{
    private LinkPreviewService $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new LinkPreviewService();
    }

    public function test_request_options_use_a_bounded_curl_sink_and_disable_redirects(): void
    {
        $sink = new BoundedResponseBody(512000);
        $options = $this->optionsFor('https://93.184.216.34/article', $sink);

        $this->assertSame($sink, $options['sink']);
        $this->assertFalse($options['allow_redirects']);
        $this->assertArrayNotHasKey('stream', $options);
        $this->assertSame(false, $options['curl'][CURLOPT_FOLLOWLOCATION]);
        $this->assertSame(
            CURLPROTO_HTTP | CURLPROTO_HTTPS,
            $options['curl'][CURLOPT_PROTOCOLS]
        );
        $this->assertSame(
            CURLPROTO_HTTP | CURLPROTO_HTTPS,
            $options['curl'][CURLOPT_REDIR_PROTOCOLS]
        );
    }

    public function test_declared_oversize_body_is_rejected_before_any_bytes_are_written(): void
    {
        $sink = new BoundedResponseBody(512000);
        $options = $this->optionsFor('https://93.184.216.34/article', $sink);

        try {
            $options['on_headers'](new Response(200, ['Content-Length' => '512001']));
            $this->fail('Expected an excessive declared response size to be rejected.');
        } catch (\LengthException) {
            $this->assertSame(0, $sink->bytesWritten());
        }
    }

    public function test_false_low_or_missing_content_length_still_relies_on_the_bounded_sink(): void
    {
        foreach ([new Response(200), new Response(200, ['Content-Length' => '12'])] as $response) {
            $sink = new BoundedResponseBody(16);
            $options = $this->optionsFor('https://93.184.216.34/article', $sink);
            $options['on_headers']($response);

            try {
                $sink->write(str_repeat('x', 17));
                $this->fail('Expected the bounded sink to reject an oversized body.');
            } catch (\LengthException) {
                $this->assertSame(0, $sink->bytesWritten());
            }
        }
    }

    public function test_guzzle_transfer_writes_a_normal_response_into_the_bounded_sink(): void
    {
        $sink = new BoundedResponseBody(512000);
        $options = $this->optionsFor('https://93.184.216.34/small', $sink);
        $client = $this->mockClient(new Response(
            200,
            ['Content-Type' => 'text/html'],
            '<html><head><title>Bounded preview</title></head></html>'
        ));

        $client->request('GET', 'https://93.184.216.34/small', $options);

        $this->assertSame(
            '<html><head><title>Bounded preview</title></head></html>',
            $sink->contents()
        );
    }

    public function test_guzzle_transfer_rejects_a_large_body_without_a_content_length(): void
    {
        $sink = new BoundedResponseBody(512000);
        $options = $this->optionsFor('https://93.184.216.34/oversized', $sink);
        $client = $this->mockClient(new Response(200, [], str_repeat('x', 512001)));

        try {
            $client->request('GET', 'https://93.184.216.34/oversized', $options);
            $this->fail('Expected the transport sink to reject the oversized response.');
        } catch (\LengthException) {
            $this->assertSame(0, $sink->bytesWritten());
        }
    }

    public function test_guzzle_transfer_rejects_decoded_expansion_despite_a_false_low_length(): void
    {
        $sink = new BoundedResponseBody(512000);
        $options = $this->optionsFor('https://93.184.216.34/compressed', $sink);
        $client = $this->mockClient(new Response(
            200,
            ['Content-Length' => '100', 'Content-Encoding' => 'gzip'],
            str_repeat('x', 512001)
        ));

        try {
            $client->request('GET', 'https://93.184.216.34/compressed', $options);
            $this->fail('Expected decoded expansion to be rejected by the bounded sink.');
        } catch (\LengthException) {
            $this->assertSame(0, $sink->bytesWritten());
        }
    }

    /**
     * @return array<string,mixed>
     */
    private function optionsFor(string $url, BoundedResponseBody $sink): array
    {
        $method = new \ReflectionMethod(LinkPreviewService::class, 'httpOptionsFor');

        return $method->invoke($this->service, $url, $sink);
    }

    private function mockClient(Response $response): Client
    {
        return new Client([
            'handler' => HandlerStack::create(new MockHandler([$response])),
        ]);
    }
}
