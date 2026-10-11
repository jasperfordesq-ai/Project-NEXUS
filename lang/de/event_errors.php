<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Registrierungsdaten können erst nach dem Ende der Veranstaltung zum Löschen geprüft werden. Wählen Sie ein Datum nach dem Ende der Veranstaltung.',
        'settings_required' => 'Speichern Sie zuerst die Registrierungseinstellungen dieser Veranstaltung. Dort wird festgelegt, wie lange Registrierungsdaten aufbewahrt werden.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Dieser Sendezeitpunkt liegt bereits in der Vergangenheit. Wählen Sie einen Zeitpunkt in der Zukunft oder senden Sie die Nachricht jetzt.',
        'post_event_too_early' => 'Eine Nachricht für die Zeit nach der Veranstaltung kann erst gesendet werden, wenn die Veranstaltung beendet ist. Wählen Sie einen Zeitpunkt nach dem Ende der Veranstaltung.',
        'audience_empty' => 'Niemand würde diese Nachricht erhalten. Wählen Sie eine Zielgruppe, die mindestens eine Person umfasst.',
        'channel_empty' => 'Wählen Sie mindestens einen Weg, auf dem diese Nachricht gesendet wird.',
        'body_invalid' => 'Schreiben Sie eine Nachricht mit höchstens :max Zeichen.',
    ],
];
