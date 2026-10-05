<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Exceptions;

use RuntimeException;

/**
 * A rule of the volunteer qualifications register was broken by a request.
 *
 * Carries the API error code and HTTP status the controller should answer
 * with, so the service can refuse without knowing about HTTP envelopes.
 * `errors` is the per-field list used by VALIDATION_ERROR responses.
 */
final class VolunteerQualificationException extends RuntimeException
{
    /**
     * @param list<array{code: string, message: string, field?: string}> $errors
     */
    public function __construct(
        private readonly string $errorCode,
        string $message,
        private readonly int $status = 422,
        private readonly ?string $field = null,
        private readonly array $errors = [],
    ) {
        parent::__construct($message);
    }

    public function errorCode(): string
    {
        return $this->errorCode;
    }

    public function status(): int
    {
        return $this->status;
    }

    public function field(): ?string
    {
        return $this->field;
    }

    /** @return list<array{code: string, message: string, field?: string}> */
    public function errors(): array
    {
        return $this->errors;
    }
}
