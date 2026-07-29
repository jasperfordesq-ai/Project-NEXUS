<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'Het bedrag van de vergoeding moet groter zijn dan nul.',
        'invalid_billing_cycle' => 'De factureringscyclus moet een van de volgende zijn: jaarlijks, tweejaarlijks, maandelijks.',
        'fee_not_configured' => 'Voor deze Verein zijn geen actieve lidmaatschapskosten geconfigureerd.',
        'organization_not_found' => 'Verein niet gevonden.',
        'organization_not_club' => 'Deze organisatie is geen Verein.',
        'organization_required' => 'organisatie_id is vereist.',
        'dues_not_found' => 'Lidmaatschapscontributierecord niet gevonden.',
        'cannot_waive_paid' => 'Kan geen afstand doen van een reeds betaalde contributie.',
        'cannot_remind_status' => 'Herinneringen kunnen alleen worden verzonden voor openstaande of achterstallige contributies.',
        'cannot_pay_status' => 'Deze contributierij bevindt zich niet in de status Betaalbaar.',
        'payment_intent_failed' => 'Kan het betalingsproces niet starten. Probeer het later opnieuw.',
        'waive_reason_required' => 'Er is een reden voor vrijstelling vereist.',
    ],
];
