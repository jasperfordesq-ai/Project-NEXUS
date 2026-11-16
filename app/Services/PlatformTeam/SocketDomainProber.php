<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

use App\Contracts\DomainProber;
use App\Support\OutboundUrlGuard;

/**
 * The real DomainProber: DNS through PHP's resolver, the public-address rule
 * through OutboundUrlGuard (called, not copied), and the certificate read over
 * a TLS connection to port 443 with a 5 second limit.
 *
 * The certificate is verified as a browser would verify it (verify_peer and
 * verify_peer_name on, SNI = the host). A certificate that fails verification
 * is reported as `certificate_not_trusted`; there is no fallback to an
 * unverified read. The connection goes to an address the guard already
 * approved, so a DNS answer cannot change between the check and the
 * connection.
 */
final class SocketDomainProber implements DomainProber
{
    public const TIMEOUT_SECONDS = 5;

    public function resolves(string $host): bool
    {
        $records = @dns_get_record($host, DNS_A + DNS_AAAA);
        if (is_array($records) && $records !== []) {
            return true;
        }

        $v4 = @gethostbynamel($host);

        return is_array($v4) && $v4 !== [];
    }

    public function publicAddresses(string $host): array
    {
        return OutboundUrlGuard::publicAddressesForHost($host);
    }

    public function certificateExpiry(string $host, string $ip): ?\DateTimeImmutable
    {
        $target = str_contains($ip, ':') ? "[{$ip}]" : $ip;

        $socket = @stream_socket_client(
            "tcp://{$target}:443",
            $errno,
            $errstr,
            self::TIMEOUT_SECONDS,
            STREAM_CLIENT_CONNECT
        );
        if ($socket === false) {
            throw new DomainProbeFailure('no_answer', 'TCP connection failed');
        }

        // The TLS handshake on a blocking socket waits up to
        // default_socket_timeout, not the connect limit: hold it to 5 seconds
        // for this read and put it back afterwards.
        $previousTimeout = ini_get('default_socket_timeout');
        ini_set('default_socket_timeout', (string) self::TIMEOUT_SECONDS);

        try {
            stream_set_timeout($socket, self::TIMEOUT_SECONDS);
            stream_context_set_option($socket, ['ssl' => [
                'peer_name' => $host,
                'SNI_enabled' => true,
                'verify_peer' => true,
                'verify_peer_name' => true,
                'allow_self_signed' => false,
                'capture_peer_cert' => true,
            ]]);

            $ok = @stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
            if ($ok !== true) {
                throw new DomainProbeFailure('certificate_not_trusted', 'TLS handshake or verification failed');
            }

            $params = stream_context_get_params($socket);
            $certificate = $params['options']['ssl']['peer_certificate'] ?? null;
            if ($certificate === null) {
                throw new DomainProbeFailure('could_not_read_certificate', 'No peer certificate');
            }

            $parsed = @openssl_x509_parse($certificate);
            $validTo = is_array($parsed) ? ($parsed['validTo_time_t'] ?? null) : null;
            if (!is_int($validTo)) {
                return null;
            }

            return (new \DateTimeImmutable('@' . $validTo))->setTimezone(new \DateTimeZone('UTC'));
        } finally {
            if ($previousTimeout !== false) {
                ini_set('default_socket_timeout', $previousTimeout);
            }
            @fclose($socket);
        }
    }
}
