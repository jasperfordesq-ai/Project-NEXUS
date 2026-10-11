<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'I dati di iscrizione possono essere esaminati per la cancellazione solo dopo la fine dell’evento. Scegli una data successiva alla fine dell’evento.',
        'settings_required' => 'Salva prima le impostazioni di iscrizione di questo evento. Stabiliscono per quanto tempo vengono conservati i dati di iscrizione.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Quell’orario di invio è già passato. Scegli un orario futuro oppure invia il messaggio ora.',
        'post_event_too_early' => 'Un messaggio per il dopo evento può essere inviato solo quando l’evento è terminato. Scegli un orario successivo alla fine dell’evento.',
        'audience_empty' => 'Nessuno riceverebbe questo messaggio. Scegli un pubblico che includa almeno una persona.',
        'channel_empty' => 'Scegli almeno un modo per inviare questo messaggio.',
        'body_invalid' => 'Scrivi un messaggio di non più di :max caratteri.',
    ],
];
