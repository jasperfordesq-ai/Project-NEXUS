<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Optional malware scanning for podcast uploads via a ClamAV daemon
 * (clamd INSTREAM protocol over a TCP socket).
 *
 * Entirely opt-in: with no CLAMAV_ADDRESS configured, scan() reports
 * 'unavailable' and the media pipeline records scan_unavailable — uploads
 * are never blocked by the absence of a scanner, and unscanned media is
 * never labelled clean. Any connection or protocol error also degrades to
 * 'unavailable' so a flaky scanner cannot take down publishing.
 */
class PodcastMediaScanner
{
    private const CHUNK_BYTES = 1024 * 1024;
    private const TIMEOUT_SECONDS = 10;
    /** Reading the verdict waits for clamd to scan the whole stream; hosted audio runs to hundreds of MB. */
    private const SCAN_TIMEOUT_SECONDS = 120;

    public static function isConfigured(): bool
    {
        return trim((string) config('services.clamav.address', '')) !== '';
    }

    /**
     * Is the daemon answering right now? clamd replies PONG to PING only once its
     * signature database is loaded, so a scanner still starting reports false.
     */
    public static function isReachable(): bool
    {
        $address = trim((string) config('services.clamav.address', ''));
        if ($address === '') {
            return false;
        }

        $socket = @stream_socket_client($address, $errorCode, $errorMessage, self::TIMEOUT_SECONDS);
        if (!is_resource($socket)) {
            return false;
        }

        try {
            stream_set_timeout($socket, self::TIMEOUT_SECONDS);
            fwrite($socket, "zPING\0");

            return trim((string) stream_get_contents($socket), "\0\r\n ") === 'PONG';
        } catch (\Throwable) {
            return false;
        } finally {
            fclose($socket);
        }
    }

    /**
     * @return 'clean'|'infected'|'unavailable'
     */
    public static function scan(string $absolutePath): string
    {
        $address = trim((string) config('services.clamav.address', ''));
        if ($address === '' || !is_file($absolutePath)) {
            return 'unavailable';
        }

        $socket = null;
        $file = null;

        try {
            $socket = @stream_socket_client($address, $errorCode, $errorMessage, self::TIMEOUT_SECONDS);
            if (!is_resource($socket)) {
                Log::warning('PodcastMediaScanner: clamd connection failed', [
                    'address' => $address,
                    'error' => trim($errorCode . ' ' . $errorMessage),
                ]);

                return 'unavailable';
            }
            stream_set_timeout($socket, self::SCAN_TIMEOUT_SECONDS);

            fwrite($socket, "zINSTREAM\0");

            $file = fopen($absolutePath, 'rb');
            if (!is_resource($file)) {
                return 'unavailable';
            }

            while (!feof($file)) {
                $chunk = fread($file, self::CHUNK_BYTES);
                if ($chunk === false) {
                    return 'unavailable';
                }
                if ($chunk !== '') {
                    fwrite($socket, pack('N', strlen($chunk)) . $chunk);
                }
            }
            // Zero-length chunk terminates the stream.
            fwrite($socket, pack('N', 0));

            $response = trim((string) stream_get_contents($socket));
            if ($response === '') {
                return 'unavailable';
            }
            if (str_contains($response, 'FOUND')) {
                return 'infected';
            }
            if (str_contains($response, 'OK')) {
                return 'clean';
            }

            Log::warning('PodcastMediaScanner: unexpected clamd response', ['response' => $response]);

            return 'unavailable';
        } catch (\Throwable $e) {
            Log::warning('PodcastMediaScanner: scan failed', ['error' => $e->getMessage()]);

            return 'unavailable';
        } finally {
            if (is_resource($file)) {
                fclose($file);
            }
            if (is_resource($socket)) {
                fclose($socket);
            }
        }
    }
}
