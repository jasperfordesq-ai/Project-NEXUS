<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\MemberImport;

/** The import must stop at this row; nothing of the row was written. */
final class MemberImportStopped extends \RuntimeException
{
    /** @param array<string, int|string> $params */
    public function __construct(public readonly string $reason, public readonly array $params = [])
    {
        parent::__construct('Member import stopped: ' . $reason);
    }
}
