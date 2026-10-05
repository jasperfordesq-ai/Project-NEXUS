<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Exceptions;

/** A campaign or hand-over that does not exist in this community (HTTP 404). */
class FundraisingNotFoundException extends \RuntimeException
{
}
