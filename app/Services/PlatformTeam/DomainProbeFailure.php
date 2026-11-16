<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\PlatformTeam;

/**
 * A certificate read that failed in a way the prober can name. Only `kind`
 * ever leaves the server; the message may hold an internal address and is
 * never stored, sent or logged by DomainCheckService.
 */
final class DomainProbeFailure extends \RuntimeException
{
    public function __construct(public readonly string $kind, string $message = '')
    {
        parent::__construct($message);
    }
}
