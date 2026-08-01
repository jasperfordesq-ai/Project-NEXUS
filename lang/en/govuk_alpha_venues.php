<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'index' => [
        'title' => 'Partner venues',
        'intro' => 'Local venues that welcome your member pass. Any offer shown is run by the venue itself.',
        'my_pass' => 'Show my pass',
        'empty' => 'No partner venues have been added yet.',
        'website' => 'Visit website (opens the venue\'s own site)',
        'how_it_works' => 'Show your pass at the till. A member of staff scans it with their phone to record your visit — nothing is charged and no payment details are involved.',
    ],
    'pass' => [
        'title' => 'My venue pass',
        'back' => 'Back to partner venues',
        'intro' => 'Show this code at a partner venue. Staff scan it with their phone camera to record your visit.',
        'qr_alt' => 'Your personal venue pass QR code',
        'privacy' => 'Your pass identifies you only to venue staff signed in to this community. It is not a payment card and holds no money.',
        'visits_title' => 'Your recorded visits',
        'visits_empty' => 'No visits recorded yet.',
    ],
    'checkin' => [
        'title' => 'Record a member visit',
        'intro' => 'You are about to record a member\'s visit to your venue. Nothing has been recorded yet — confirm below.',
        'confirm' => 'Record this visit',
        'choose_venue' => 'Which venue is this visit for?',
        'recorded' => 'Visit recorded for :member at :venue.',
        'already_recorded' => 'A visit for :member was already recorded today.',
        'visits_this_month' => 'Visits this month: :count',
        'challenge_completed' => 'Challenge completed: :title',
        'done' => 'Done',
        'forbidden_title' => 'You cannot record visits',
        'forbidden_body' => 'Only staff of a partner venue can record visits, and staff cannot record their own visit. Ask a community admin to add you to the venue\'s staff.',
        'invalid_title' => 'This pass is not valid',
        'invalid_body' => 'The scanned pass does not exist or has been revoked. Ask the member to open their pass again and rescan.',
    ],
];
