<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Choose one of the five kinds of group exchange.',
        'no_givers' => 'Add at least one person giving time.',
        'no_receivers' => 'Add at least one person receiving time.',
        'hours_missing' => 'Give every person a number of hours above zero.',
        'earned_exceeds_paid' => 'The people giving time would earn :earned hours, but the people attending would pay only :paid. In a workshop or class, everyone attending pays for the time they receive, so they must pay at least as much as is earned. If several people are giving their time to one person, choose "A team helping someone" instead.',
        'unbalanced' => 'The hours earned (:earned) must be the same as the hours paid (:paid). Change some of the numbers so they match.',
    ],
    'ledger' => [
        'to_fund' => 'Group exchange ":title" — leftover hours to the community time fund',
    ],
    'fund' => [
        'description' => 'Leftover hours from the group exchange ":title"',
    ],
];
