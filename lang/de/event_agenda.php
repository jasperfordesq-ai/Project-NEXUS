<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'withdraw_confirmation' => 'Ich verstehe, dass mein Platz in :title freigegeben wird und anderweitig vergeben werden kann.',
    'capacity_label' => 'Kapazität der Sitzung',
    'capacity_hint' => 'Leer lassen für unbegrenzte Plätze. Sitzungsplätze ändern weder die Veranstaltungsanmeldung noch Tickets.',
    'capacity_unlimited' => ':registered angemeldet · unbegrenzt',
    'capacity_limited' => ':registered von :limit angemeldet',
    'resources_title' => 'Sitzungsressourcen',
    'resources_hint' => 'HTTPS-Links in Anzeigereihenfolge hinzufügen. Streams und Aufzeichnungen müssen auf Angemeldete oder Mitarbeitende beschränkt sein.',
    'resource_number' => 'Ressource :number',
    'resource_type' => 'Ressourcentyp',
    'resource_visibility' => 'Zugriffsberechtigte',
    'resource_title' => 'Titel der Ressource',
    'resource_url' => 'Sichere HTTPS-URL',
    'resource_url_hint' => 'Eine vollständige Adresse mit https:// verwenden.',
    'resource_types' => [
        'link' => 'Link',
        'document' => 'Dokument',
        'slides' => 'Folien',
        'download' => 'Herunterladen',
        'stream' => 'Livestream',
        'recording' => 'Aufzeichnung',
    ],
    'opens_new_window' => 'Öffnet in einem neuen Fenster',
    'resource_unavailable' => 'Link nicht verfügbar',
    'registered_success' => 'Sie sind für die Sitzung angemeldet.',
    'withdrawn_success' => 'Sie haben sich von der Sitzung abgemeldet.',
    'register_action' => 'Für Sitzung anmelden',
    'withdraw_action' => 'Von Sitzung abmelden',
    'registered_state' => 'Für diese Sitzung angemeldet',
    'ineligible_state' => 'Ihre Veranstaltungsanmeldung berechtigt nicht mehr zu dieser Sitzung.',
    'full_state' => 'Diese Sitzung ist ausgebucht.',
    'session_full_error' => 'Für diese Sitzung sind keine Plätze mehr frei.',
    'eligibility_error' => 'Bestätigen Sie Ihre Veranstaltungsanmeldung, bevor Sie sich für eine Sitzung anmelden.',
];
