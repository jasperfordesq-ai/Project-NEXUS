<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
 * Copying in-app support reports to the Jira Service Management help desk.
 *
 * Both switches are platform-wide and default OFF, so the code can ship dark.
 *
 * - SUPPORT_JIRA_ENABLED turns the whole connection on. Off: reports are saved
 *   and admins notified exactly as before, and nothing is sent to Atlassian.
 * - SUPPORT_JIRA_SEND_MEMBER_EMAIL raises the ticket in the member's own name
 *   (their email address goes to Atlassian, so Jira can email them replies).
 *   Off: the ticket is raised by the platform's service account and identifies
 *   the member only by platform user id and community. Turn it on only after
 *   the Data Protection Officer has confirmed the privacy notice covers
 *   Atlassian as a processor.
 *
 * The API token belongs to a dedicated Atlassian service account. It lives in
 * the server .env only — never commit it, never log it. Service-account tokens
 * are scoped, expire after at most 365 days, and need these scopes:
 * read:servicedesk-request, write:servicedesk-request, read:jira-work,
 * write:jira-work, and manage:servicedesk-customer once
 * SUPPORT_JIRA_SEND_MEMBER_EMAIL is on.
 */
return [
    'enabled' => (bool) env('SUPPORT_JIRA_ENABLED', false),
    'send_member_email' => (bool) env('SUPPORT_JIRA_SEND_MEMBER_EMAIL', false),

    // The Jira site, e.g. https://hour-timebank.atlassian.net. Used for the
    // "Open in Jira" links admins see, and for API calls when no cloud id is set.
    'site_url' => rtrim((string) env('SUPPORT_JIRA_SITE_URL', ''), '/'),

    // The site's cloud id. When set, API calls go through the Atlassian
    // platform gateway, https://api.atlassian.com/ex/jira/{cloud_id} — which is
    // the ONLY address a service-account (scoped) API token works on. Leave it
    // empty only when using a classic user API token against the site address.
    'cloud_id' => trim((string) env('SUPPORT_JIRA_CLOUD_ID', '')),
    'service_desk_id' => (string) env('SUPPORT_JIRA_SERVICE_DESK_ID', ''),
    'email' => (string) env('SUPPORT_JIRA_EMAIL', ''),
    'api_token' => (string) env('SUPPORT_JIRA_API_TOKEN', ''),

    // Jira request type id for each kind of in-app request. Verify against
    // GET /rest/servicedeskapi/servicedesk/{id}/requesttype before enabling.
    'request_types' => [
        'broken' => (string) env('SUPPORT_JIRA_REQUEST_TYPE_BROKEN', '5'),
        'how_to' => (string) env('SUPPORT_JIRA_REQUEST_TYPE_HOW_TO', '6'),
        'account' => (string) env('SUPPORT_JIRA_REQUEST_TYPE_ACCOUNT', '8'),
        'suggestion' => (string) env('SUPPORT_JIRA_REQUEST_TYPE_SUGGESTION', '9'),
    ],

    // How badly a fault affects the member, mapped to Jira's priority names.
    'priorities' => [
        'blocked' => 'Highest',
        'major' => 'High',
        'minor' => 'Medium',
        'cosmetic' => 'Low',
    ],

    // Atlassian account id of the person who answers the help desk. Every new
    // ticket is assigned to them, so Jira emails them "assigned to you".
    // Empty = tickets stay unassigned.
    'assignee_account_id' => trim((string) env('SUPPORT_JIRA_ASSIGNEE_ACCOUNT_ID', '')),

    // Address Jira's customer notifications are sent from (named in the
    // platform receipt so members know where to look). Empty = jira@<site
    // host>, Jira Cloud's default. Set it once a custom sender domain is
    // configured in the help desk.
    'notification_sender' => trim((string) env('SUPPORT_JIRA_NOTIFICATION_SENDER', '')),

    'timeout_seconds' => (int) env('SUPPORT_JIRA_TIMEOUT', 15),

    // Reports one member may send in any rolling 24 hours (spam guard). This
    // applies whether or not the Jira connection is on.
    'daily_member_limit' => (int) env('SUPPORT_REPORTS_DAILY_MEMBER_LIMIT', 5),
];
