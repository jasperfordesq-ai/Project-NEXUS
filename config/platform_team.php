<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Platform team panel settings.
 */
return [
    /*
     * The deploy record (one JSON object per line), written on the host by
     * scripts/deploy/phases/record-deploy-metrics.sh and mounted read-only
     * into the production app container only (compose.bluegreen.yml mounts
     * the host's deploy log folder at storage/logs/host-logs). On a
     * developer's computer the file does not exist, and the Deployments page
     * says so.
     */
    'deploy_history_path' => env('PLATFORM_TEAM_DEPLOY_HISTORY_PATH', storage_path('logs/host-logs/deploys.jsonl')),

    /*
     * The date of the last independent security test, as YYYY-MM-DD, shown on
     * the Assurance facts page. Only the platform's owner sets it, on the
     * server. 🔴 No date is ever written here: unset (null) is shown as "Not
     * recorded on this server", and a malformed or future value is treated
     * the same way.
     */
    'last_independent_test_on' => env('PLATFORM_TEAM_LAST_INDEPENDENT_TEST_ON'),
];
