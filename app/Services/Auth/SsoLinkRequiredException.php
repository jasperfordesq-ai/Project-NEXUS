<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\Auth;

/**
 * A community SSO sign-in was refused, and the way forward is for the person
 * to sign in with their usual method and link the provider from account
 * settings (F-244 follow-up).
 *
 * Thrown for two refusals that must look identical to the caller, so the
 * callback cannot be used to learn whether an email address has an account:
 *  - the provider is not host-approved and the email matches an existing
 *    account (F-244: no email auto-linking), and
 *  - the provider does not provision new accounts.
 */
final class SsoLinkRequiredException extends \RuntimeException
{
}
