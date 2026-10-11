<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;
use Throwable;

/** Stable internal reason code for the isolated Events ticketing boundary. */
final class EventTicketingException extends RuntimeException
{
    public function __construct(
        public readonly string $reasonCode,
        int $code = 0,
        ?Throwable $previous = null,
        /** The input at fault, when the thrower knows which one it was checking. */
        public readonly ?string $field = null,
    ) {
        parent::__construct($reasonCode, $code, $previous);
    }
}
