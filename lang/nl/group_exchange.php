<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Kies een van de vijf soorten groepsruil.',
        'no_givers' => 'Voeg minstens één persoon toe die tijd geeft.',
        'no_receivers' => 'Voeg minstens één persoon toe die tijd ontvangt.',
        'hours_missing' => 'Geef iedereen een aantal uren groter dan nul.',
        'earned_exceeds_paid' => 'De mensen die tijd geven zouden :earned uur verdienen, maar de deelnemers zouden maar :paid betalen. Bij een workshop of les betaalt iedere deelnemer voor de tijd die hij ontvangt, dus ze moeten minstens zoveel betalen als er wordt verdiend. Geven meerdere mensen hun tijd aan één persoon? Kies dan "Een team helpt iemand".',
        'unbalanced' => 'De verdiende uren (:earned) moeten gelijk zijn aan de betaalde uren (:paid). Pas enkele getallen aan zodat ze gelijk zijn.',
        'too_many_participants' => 'Een groepsruil kan hoogstens :max personen hebben.',
    ],
    'ledger' => [
        'to_fund' => 'Groepsruil ":title" — overgebleven uren naar het Gemeenschapsfonds',
    ],
    'fund' => [
        'description' => 'Overgebleven uren van de groepsruil ":title"',
    ],
];
