<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Volunteering;

/**
 * The outcome of a staff update to a safeguarding incident. Replaces a bare bool,
 * which made "no such incident" and "that value is invalid" the same answer.
 */
final class IncidentUpdateResult
{
    private function __construct(
        public readonly bool $ok,
        public readonly bool $notFound,
        public readonly ?string $errorField,
    ) {
    }

    public static function ok(): self
    {
        return new self(true, false, null);
    }

    /** No such incident here, or the caller is someone it is about (F-507). */
    public static function notFound(): self
    {
        return new self(false, true, null);
    }

    public static function invalid(string $field): self
    {
        return new self(false, false, $field);
    }
}
