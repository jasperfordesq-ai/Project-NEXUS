<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Exceptions;

final class AiBudgetExceededException extends \RuntimeException
{
    /** @param array<string, int|string|bool|null> $limits */
    public function __construct(public readonly array $limits)
    {
        parent::__construct((string) ($limits['reason'] ?? 'ai_budget_exhausted'));
    }
}
