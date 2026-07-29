<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'withdraw_confirmation' => 'Comprendo che il mio posto in :title verrà liberato e potrà essere occupato da un’altra persona.',
    'capacity_label' => 'Capienza della sessione',
    'capacity_hint' => 'Lascia vuoto per non imporre limiti. I posti della sessione non modificano l’iscrizione all’evento né i biglietti.',
    'capacity_unlimited' => ':registered iscritti · nessun limite',
    'capacity_limited' => ':registered iscritti su :limit',
    'resources_title' => 'Risorse della sessione',
    'resources_hint' => 'Aggiungi link HTTPS nell’ordine di visualizzazione. Streaming e registrazioni devono essere riservati agli iscritti o allo staff.',
    'resource_number' => 'Risorsa :number',
    'resource_type' => 'Tipo di risorsa',
    'resource_visibility' => 'Chi può accedere',
    'resource_title' => 'Titolo della risorsa',
    'resource_url' => 'URL HTTPS sicuro',
    'resource_url_hint' => 'Usa un indirizzo completo che inizi con https://.',
    'resource_types' => [
        'link' => 'Collegamento',
        'document' => 'Documento',
        'slides' => 'Diapositive',
        'download' => 'Scaricamento',
        'stream' => 'Diretta streaming',
        'recording' => 'Registrazione',
    ],
    'opens_new_window' => 'Si apre in una nuova finestra',
    'resource_unavailable' => 'Link non disponibile',
    'registered_success' => 'Ti sei iscritto alla sessione.',
    'withdrawn_success' => 'Hai annullato l’iscrizione alla sessione.',
    'register_action' => 'Iscriviti alla sessione',
    'withdraw_action' => 'Annulla iscrizione',
    'registered_state' => 'Iscrizione confermata per questa sessione',
    'ineligible_state' => 'La tua iscrizione all’evento non consente più l’accesso a questa sessione.',
    'full_state' => 'Questa sessione è al completo.',
    'session_full_error' => 'Non ci sono più posti disponibili per questa sessione.',
    'eligibility_error' => 'Conferma l’iscrizione all’evento prima di iscriverti a una sessione.',
];
