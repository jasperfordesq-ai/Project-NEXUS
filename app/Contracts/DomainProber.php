<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Contracts;

/**
 * The outbound part of the Platform team's "Addresses and certificates" check
 * (App\Services\PlatformTeam\DomainCheckService), kept behind one seam so no
 * test ever makes a DNS lookup or a network connection.
 *
 * The service decides WHICH host may be asked about (only one read from the
 * tenants table or the platform's own configured list); an implementation
 * only answers for the host it is given.
 */
interface DomainProber
{
    /** The name has at least one address (A or AAAA). */
    public function resolves(string $host): bool;

    /**
     * Every address of the name when ALL of them are public, else [] (see
     * App\Support\OutboundUrlGuard::publicAddressesForHost()). The service
     * connects only to an address from this list, never re-resolving.
     *
     * @return list<string>
     */
    public function publicAddresses(string $host): array;

    /**
     * The expiry of the certificate the server at $ip:443 gives for $host
     * (SNI = $host), verified as a browser would. Null when the certificate
     * carries no readable expiry. Throws
     * App\Services\PlatformTeam\DomainProbeFailure for a failure it can name.
     */
    public function certificateExpiry(string $host, string $ip): ?\DateTimeImmutable;
}
