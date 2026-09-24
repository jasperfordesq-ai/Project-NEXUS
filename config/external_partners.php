<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    // A rollout cannot open third-party read/write APIs through database or
    // tenant flags alone. Explicit environment approval is required as well.
    'enabled' => (bool) env('EXTERNAL_PARTNER_APIS_ENABLED', false),
];
