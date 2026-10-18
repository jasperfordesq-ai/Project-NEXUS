<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Exceptions;

/**
 * A webhook the admin asked for breaks one of WebhookDispatchService's rules.
 *
 * It carries a stable code and the field at fault, because the admin page
 * shows its own translated wording for each rule and must never display the
 * server's text (the admin UI-literal gate enforces that). It extends
 * InvalidArgumentException so every existing caller that catches that keeps
 * working unchanged.
 */
final class WebhookValidationException extends \InvalidArgumentException
{
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly ?string $field = null,
    ) {
        parent::__construct($message);
    }
}
