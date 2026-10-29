<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Veranstaltungstickets',
    'intro' => 'Überprüfen Sie verfügbare Tickettypen, beanspruchen Sie freie Plätze und verwalten Sie Ihre eigenen bestätigten Gratistickets.',
    'load_error' => 'Der Veranstaltungsticketkatalog konnte nicht geladen werden.',
    'validation_error' => 'Überprüfen Sie die Ticketdetails und versuchen Sie es erneut.',
    'allocate_error' => 'Die Freikarte konnte nicht zugeteilt werden. Überprüfen Sie Ihre Anmeldung, Berechtigung und das verbleibende Kontingent.',
    'cancel_error' => 'Das Freiticket konnte nicht storniert werden. Aktualisieren Sie den Katalog und versuchen Sie es erneut.',
    'allocated' => 'Ihr kostenloses Ticket wurde zugeteilt.',
    'cancelled' => 'Ihr Gratisticket wurde storniert und in das Kontingent zurückgeführt.',
    'back_to_event' => 'Zurück zur Veranstaltung',
    'back_to_tickets' => 'Zurück zu den Veranstaltungstickets',
    'gateway_disabled' => 'Eine kostenpflichtige und Zeitguthaben-Kaufabwicklung ist nicht möglich. Diese Seite erhebt weder Geld noch Zeitguthaben und verändert Ihren Geldbeutel nicht.',
    'my_tickets' => 'Meine Tickets',
    'no_tickets' => 'Sie haben kein Ticket für diese Veranstaltung.',
    'ticket_fallback' => 'Veranstaltungsticket',
    'units' => 'Menge',
    'status_label' => 'Status',
    'status' => [
        'confirmed' => 'Bestätigt',
        'cancelled' => 'Abgesagt',
    ],
    'cancel_ticket' => 'Ticket stornieren',
    'time_credit_cancel_disabled' => 'Die Stornierung von Zeitguthabentickets ist in diesem kostenlosen Workflow nicht verfügbar. Es wurden keine Wallet-Maßnahmen ergriffen.',
    'catalogue' => 'Verfügbare Tickets',
    'catalogue_empty' => 'Für diese Veranstaltung sind keine Ticketarten verfügbar.',
    'kind' => [
        'free' => 'Kostenlos',
        'time_credit' => 'Zeitguthaben',
    ],
    'remaining' => 'Verbleibende Zuteilung',
    'member_limit' => 'Limit pro Mitglied',
    'time_credit_disabled' => 'Dieser Typ kostet :credits Zeitguthaben, der Checkout ist jedoch deaktiviert, bis das genehmigte Wallet-Gateway verbunden ist. Es werden keine Gutschriften abgebucht.',
    'units_to_claim' => 'Anzahl der Freikarten',
    'reconcile' => 'Führen Sie den Abgleich durch',
    'reconciliation_clear' => 'Ticketbestand und Buchhaltungsdatensätze werden abgeglichen.',
    'reconciliation_warnings' => '{1} :count Abgleichswarnung|[2,*] :count Abgleichswarnungen',
    'reconciliation_error' => 'Der Ticketabgleich konnte nicht abgeschlossen werden.',
    'units_hint' => 'Sie können in dieser Zuteilung bis zu :count beanspruchen.',
    'claim_free' => 'Fordern Sie ein kostenloses Ticket an',
    'registration_required' => 'Sie benötigen eine bestätigte Veranstaltungsanmeldung, bevor Sie ein kostenloses Ticket erhalten können.',
    'not_eligible' => 'Sie erfüllen derzeit nicht die Teilnahmebedingungen dieser Ticketart.',
    'sales_closed' => 'Für diesen Tickettyp ist derzeit keine Zuteilung möglich.',
    'sold_out' => 'In diesem Kontingent verbleiben keine Freikarten für Sie.',
    'cancel_title' => 'Dieses Freiticket stornieren?',
    'cancel_intro' => 'Teilen Sie dem Veranstalter mit, warum Sie stornieren. Die Menge wird in die kostenlose Zuteilung zurückgeführt.',
    'cancel_free_only' => 'Durch diese Aktion wird lediglich eine kostenlose Berechtigung storniert. Es erfolgt keine Rückerstattung oder Änderung des Guthabens.',
    'reason_label' => 'Grund für die Stornierung',
    'reason_hint' => 'Geben Sie keine privaten oder sensiblen Informationen an. Maximal 500 Zeichen.',
    'confirm_cancel' => 'Gratisticket stornieren',
];
