<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Diese Spendenkampagne wurde nicht gefunden.',
    'organisation_locked' => 'Diese Kampagne hat bereits Spenden erhalten, daher kann die Organisation, für die sie sammelt, nicht mehr geändert werden.',
    'organisation_not_eligible' => 'Nur genehmigte Organisationen können Spendenkampagnen durchführen.',
    'not_your_campaign' => 'Sie können nur Kampagnen Ihrer eigenen Organisation verwalten.',
    'handover_not_found' => 'Diese Übergabe wurde nicht gefunden.',
    'handover_amount_positive' => 'Geben Sie einen Betrag größer als null ein.',
    'handover_exceeds_held' => 'Das ist mehr, als diese Kampagne noch hält (:held).',
    'handover_method_invalid' => 'Wählen Sie aus, wie das Geld weitergegeben wurde.',
    'handover_reference_required' => 'Geben Sie eine Zahlungsreferenz ein, damit die Überweisung nachvollzogen werden kann.',
    'handover_date_invalid' => 'Geben Sie das Datum ein, an dem das Geld weitergegeben wurde. Es darf nicht in der Zukunft liegen.',
    'handover_campaign_has_no_organisation' => 'Diese Kampagne gilt für die gesamte Gemeinschaft, daher gibt es keine Organisation, an die Geld übergeben werden kann.',
    'handover_already_closed' => 'Diese Übergabe wurde bereits bestätigt oder storniert.',
    'cancel_reason_required' => 'Geben Sie einen Grund für die Stornierung dieser Übergabe an.',
    'email' => [
        'handover_subject' => ':community hat :amount für :campaign weitergegeben',
        'handover_title' => 'Geld an :organisation weitergegeben',
        'handover_body' => ':community hat am :date die Weitergabe von :amount aus der Kampagne „:campaign“ erfasst (Referenz :reference). Bitte prüfen Sie den Eingang und bestätigen Sie ihn im Dashboard Ihrer Organisation.',
        'handover_cta' => 'Eingang bestätigen',
        'handover_bell' => ':community hat :amount für :campaign weitergegeben. Bitte bestätigen Sie den Eingang.',
    ],
];
