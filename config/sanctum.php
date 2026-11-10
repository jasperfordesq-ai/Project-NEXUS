<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'stateful' => explode(',', env(
        'SANCTUM_STATEFUL_DOMAINS',
        'localhost,localhost:5173,localhost:8082,127.0.0.1,127.0.0.1:8082,app.project-nexus.ie,app.project-nexus.net'
    )),
    'guard' => ['web'],
    'expiration' => 60 * 24 * 7, // 7 days in minutes
];
