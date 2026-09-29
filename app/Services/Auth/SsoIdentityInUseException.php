<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

/**
 * A member tried to link a community SSO identity (tenant + provider +
 * subject) that is already linked to a different account.
 */
final class SsoIdentityInUseException extends \RuntimeException
{
}
