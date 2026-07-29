<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'Der Gebührenbetrag muss größer als Null sein.',
        'invalid_billing_cycle' => 'Der Abrechnungszyklus muss einer der folgenden sein: jährlich, zweijährlich oder monatlich.',
        'fee_not_configured' => 'Für diesen Verein ist kein aktiver Mitgliedsbeitrag konfiguriert.',
        'organization_not_found' => 'Verein nicht gefunden.',
        'organization_not_club' => 'Diese Organisation ist kein Verein.',
        'organization_required' => 'Organisations-ID ist erforderlich.',
        'dues_not_found' => 'Der Eintrag zu den Mitgliedsbeiträgen wurde nicht gefunden.',
        'cannot_waive_paid' => 'Auf eine bereits bezahlte Beitragszeile kann nicht verzichtet werden.',
        'cannot_remind_status' => 'Mahnungen können nur für ausstehende oder überfällige Gebühren versendet werden.',
        'cannot_pay_status' => 'Diese Beitragszeile ist nicht zahlbar.',
        'payment_intent_failed' => 'Der Zahlungsvorgang konnte nicht gestartet werden. Bitte versuchen Sie es später noch einmal.',
        'waive_reason_required' => 'Es ist ein Verzichtsgrund erforderlich.',
    ],
];
