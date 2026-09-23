<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/** Machine-coded agenda failure; transport layers localize the reason. */
final class EventSessionException extends RuntimeException
{
    public function __construct(
        public readonly string $reasonCode,
        /** Only after receipt lookup under the event lock proves an obsolete request cannot apply. */
        public readonly bool $operationNotApplied = false,
    )
    {
        parent::__construct($reasonCode);
    }
}
