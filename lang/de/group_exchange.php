<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Wähle eine der fünf Arten von Gruppentausch.',
        'no_givers' => 'Füge mindestens eine Person hinzu, die Zeit gibt.',
        'no_receivers' => 'Füge mindestens eine Person hinzu, die Zeit erhält.',
        'hours_missing' => 'Gib für jede Person eine Stundenzahl über null an.',
        'earned_exceeds_paid' => 'Die Personen, die Zeit geben, würden :earned Stunden verdienen, die Teilnehmenden würden aber nur :paid bezahlen. Bei einem Workshop oder Kurs bezahlen alle Teilnehmenden die Zeit, die sie erhalten, also müssen sie mindestens so viel bezahlen, wie verdient wird. Wenn mehrere Personen einer Person ihre Zeit geben, wähle stattdessen „Ein Team hilft jemandem“.',
        'unbalanced' => 'Die verdienten Stunden (:earned) müssen den bezahlten Stunden (:paid) entsprechen. Ändere einige Zahlen, damit sie übereinstimmen.',
    ],
    'ledger' => [
        'to_fund' => 'Gruppentausch „:title“ – übrige Stunden an den Gemeinschaftsfonds',
    ],
    'fund' => [
        'description' => 'Übrige Stunden aus dem Gruppentausch „:title“',
    ],
];
