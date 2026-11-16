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
];
