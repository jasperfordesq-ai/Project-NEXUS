<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * A member's report about another member or a message could not be filed.
 * Carries the API error code, HTTP status, translation key and field.
 */
class MemberConcernReportException extends RuntimeException
{
    public function __construct(
        public readonly string $errorCode,
        public readonly int $status,
        public readonly string $messageKey,
        public readonly ?string $field = null,
    ) {
        parent::__construct($errorCode);
    }
}
