<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Exceptions;

/**
 * Thrown by PollService::vote() when the poll's end date has passed.
 *
 * Extends RuntimeException so existing callers that catch RuntimeException
 * keep working, while controllers can catch THIS type and answer 409 instead
 * of letting it surface as a 500. A broad `catch (\RuntimeException)` is not
 * an option here: Illuminate's QueryException is a RuntimeException too, and
 * catching it would turn a broken query into a polite "poll closed".
 */
class PollClosedException extends \RuntimeException
{
}
