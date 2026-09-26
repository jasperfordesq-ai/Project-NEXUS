<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/*
|--------------------------------------------------------------------------
| Tenant host policy (E-038 / F-035)
|--------------------------------------------------------------------------
|
| An API request whose Host is not recognised is refused with a plain 404
| instead of being served the master tenant. See
| App\Support\Tenancy\PlatformHostPolicy for the full rule.
|
| A Host is RECOGNISED when it is any of:
|   - a community's `tenants.domain` or `tenants.accessible_domain`
|     (compared leniently: case, scheme, `www.`, port and trailing slash ignored);
|   - an internal name: an IP literal, a single-label name (Docker service
|     names such as nexus-green-php-app — web-uk's server-side calls arrive
|     with one because Node fetch drops a Host header), or a name ending in
|     one of `internal_host_suffixes`;
|   - a platform host: the hosts of APP_URL, FRONTEND_URL and
|     ACCESSIBLE_FRONTEND_URL, every host in config('cors.allowed_origins')
|     (so CORS_ALLOWED_ORIGINS covers a cross-origin React deployment such as
|     staging), the defaults below, and anything in TENANT_PLATFORM_HOSTS.
|
| 🔴 The defaults are an ALLOWLIST, additive, never a destination: they cannot
| point a non-production environment at production. Staging adds its own hosts
| through TENANT_PLATFORM_HOSTS / CORS_ALLOWED_ORIGINS / APP_URL.
|
| Emergency switch: TENANT_REFUSE_UNKNOWN_HOSTS=false restores the previous
| behaviour (unknown host => master tenant) without a code change.
|
*/

return [

    'refuse_unknown_hosts' => filter_var(
        env('TENANT_REFUSE_UNKNOWN_HOSTS', true),
        FILTER_VALIDATE_BOOLEAN
    ),

    'platform_hosts' => array_values(array_unique(array_filter(array_merge(
        [
            'project-nexus.ie',
            'api.project-nexus.ie',
            'app.project-nexus.ie',
            'accessible.project-nexus.ie',
        ],
        array_map('trim', explode(',', (string) env('TENANT_PLATFORM_HOSTS', '')))
    )))),

    'internal_host_suffixes' => ['.localhost', '.test', '.internal', '.local'],

];
