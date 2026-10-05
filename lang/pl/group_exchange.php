<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Wybierz jeden z pięciu rodzajów wymiany grupowej.',
        'no_givers' => 'Dodaj co najmniej jedną osobę, która daje czas.',
        'no_receivers' => 'Dodaj co najmniej jedną osobę, która otrzymuje czas.',
        'hours_missing' => 'Podaj dla każdej osoby liczbę godzin większą od zera.',
        'earned_exceeds_paid' => 'Osoby dające czas zarobiłyby :earned godz., a uczestnicy zapłaciliby tylko :paid. Na warsztatach lub zajęciach każdy uczestnik płaci za czas, który otrzymuje, więc uczestnicy muszą zapłacić co najmniej tyle, ile zostaje zarobione. Jeśli kilka osób daje swój czas jednej osobie, wybierz „Zespół pomaga komuś”.',
        'unbalanced' => 'Zarobione godziny (:earned) muszą być równe zapłaconym (:paid). Zmień niektóre liczby, aby się zgadzały.',
    ],
    'ledger' => [
        'to_fund' => 'Wymiana grupowa „:title” — pozostałe godziny do Funduszu społeczności',
    ],
    'fund' => [
        'description' => 'Pozostałe godziny z wymiany grupowej „:title”',
    ],
];
