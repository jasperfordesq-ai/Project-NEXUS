<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services;

/** The invite was consumed or withdrawn after its pre-registration check. */
final class RegistrationInviteRedemptionFailed extends \RuntimeException
{
}
