<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Exceptions;

/**
 * Thrown by JobOfferService::accept() when a timebank offer cannot be paid:
 * the employer's locked balance is below the vacancy's time credits.
 *
 * A dedicated type (rather than a broad RuntimeException catch) lets the
 * controller answer 422 with a translated message while every other failure
 * — including a QueryException, which is also a RuntimeException — keeps the
 * generic "unable to accept" path.
 */
class JobOfferCreditException extends \RuntimeException
{
}
