<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [

    /*
    |--------------------------------------------------------------------------
    | Surnames are for staff only (E-122)
    |--------------------------------------------------------------------------
    |
    | Owner rule, 10 November 2026: "No surnames should be anywhere on the site
    | apart from for admins" — and brokers and coordinators count, in their own
    | community.
    |
    | This is the ONE switch for the central rule. While it is false,
    | App\Support\UserDisplayName and App\Models\User behave exactly as they did
    | before E-122: every helper returns the full name and a serialised User
    | keeps `last_name`. When it is true, those ask App\Support\Names\NameAudience
    | who is looking, and anyone who is not staff of the community gets a first
    | name (an organisation keeps its trading name).
    |
    | It is a literal, not an environment variable, on purpose: turning it on is
    | E-122 stage 4, a reviewed one-line commit that can be reverted, never a
    | setting somebody changes on a server. Tests force it with
    | config(['names.surname_audience_enforced' => true]).
    |
    */
    'surname_audience_enforced' => false,

];
