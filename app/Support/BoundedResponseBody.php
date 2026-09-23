<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Support;

use GuzzleHttp\Psr7\StreamDecoratorTrait;
use GuzzleHttp\Psr7\Utils;
use Psr\Http\Message\StreamInterface;

/**
 * Writable response sink that refuses bytes beyond a fixed limit.
 *
 * Guzzle's cURL handler writes decoded response chunks into this stream. The
 * limit therefore remains effective for missing, false-low, or compressed
 * Content-Length values without first materialising the full response body.
 */
final class BoundedResponseBody implements StreamInterface
{
    use StreamDecoratorTrait;

    private StreamInterface $stream;

    private int $bytesWritten = 0;

    public function __construct(private readonly int $maxBytes)
    {
        if ($maxBytes < 1) {
            throw new \InvalidArgumentException('Response body limit must be positive.');
        }

        $this->stream = Utils::streamFor('');
    }

    public function write($string): int
    {
        if (! is_string($string)) {
            throw new \InvalidArgumentException('Response body chunks must be strings.');
        }

        $length = strlen($string);
        if ($length > $this->maxBytes - $this->bytesWritten) {
            throw new \LengthException('Remote response body exceeds the allowed size.');
        }

        $written = $this->stream->write($string);
        $this->bytesWritten += $written;

        return $written;
    }

    public function contents(): string
    {
        $this->rewind();

        return $this->getContents();
    }

    public function bytesWritten(): int
    {
        return $this->bytesWritten;
    }
}
