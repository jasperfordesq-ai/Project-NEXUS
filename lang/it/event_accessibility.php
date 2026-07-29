<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'form' => [
        'title' => 'Accessibilità della sede',
        'hint' => 'Indica ciò che è disponibile nella sede. Scegli «Non noto» se una caratteristica non è stata verificata; è diverso da «No».',
        'parking_details' => 'Parcheggio e arrivo',
        'parking_details_hint' => 'Descrivi i posti accessibili, i punti di discesa e il percorso fino all’ingresso.',
        'transit_details' => 'Trasporto pubblico',
        'transit_details_hint' => 'Descrivi fermate o stazioni vicine ed eventuali ostacoli lungo il percorso.',
        'assistance_contact' => 'Contatto per l’assistenza all’accessibilità',
        'assistance_contact_hint' => 'Fornisci un contatto pubblico per domande sull’accesso. Non inserire dati privati dei partecipanti.',
        'notes' => 'Ulteriori informazioni sull’accesso',
        'notes_hint' => 'Aggiungi informazioni utili su ingresso, ascensore, pavimentazione, illuminazione o ambiente sensoriale.',
        'privacy_note' => 'Queste informazioni sono mostrate ai membri dell’evento. Le richieste private di adattamento vanno inserite nel modulo di registrazione.',
    ],
    'features' => [
        'step_free_access' => 'Accesso senza gradini',
        'accessible_toilet' => 'Servizi igienici accessibili',
        'hearing_loop' => 'Anello a induzione',
        'quiet_space' => 'Spazio tranquillo',
        'seating_available' => 'Posti a sedere disponibili',
        'accessible_parking' => 'Parcheggio accessibile',
    ],
    'status' => [
        'yes' => 'Sì',
        'no' => 'NO',
        'unknown' => 'Non noto',
    ],
    'filters' => [
        'step_free_label' => 'Accesso senza gradini della sede',
        'step_free_hint' => 'Filtra in base alle informazioni sull’accesso confermate dall’organizzatore.',
        'step_free_options' => [
            'any' => 'Qualsiasi sede',
            'yes' => 'Accesso senza gradini confermato',
            'no' => 'Accesso con gradini',
            'unknown' => 'Informazioni sull’accesso non disponibili',
        ],
        'step_free_active' => 'Accesso senza gradini: :value',
    ],
    'detail' => [
        'title' => 'Accessibilità della sede',
        'intro' => 'Informazioni sull’accesso fornite dall’organizzatore. Contattalo se devi confermare una sistemazione.',
        'features_label' => 'Caratteristiche di accessibilità della sede',
        'parking_details' => 'Parcheggio e arrivo',
        'transit_details' => 'Trasporto pubblico',
        'assistance_contact' => 'Assistenza all’accessibilità',
        'notes' => 'Ulteriori informazioni sull’accesso',
    ],
];
