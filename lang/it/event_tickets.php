<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Biglietti per eventi',
    'intro' => 'Esamina i tipi di biglietti disponibili, richiedi posti gratuiti e gestisci i tuoi biglietti gratuiti confermati.',
    'load_error' => 'Impossibile caricare il catalogo dei biglietti dell\'evento.',
    'validation_error' => 'Controlla i dettagli del biglietto e riprova.',
    'allocate_error' => 'Non è stato possibile assegnare il biglietto gratuito. Controlla la tua registrazione, l\'idoneità e l\'allocazione rimanente.',
    'cancel_error' => 'Non è stato possibile annullare il biglietto gratuito. Aggiorna il catalogo e riprova.',
    'allocated' => 'Il tuo biglietto gratuito è stato assegnato.',
    'cancelled' => 'Il tuo biglietto gratuito è stato annullato e restituito alla dotazione.',
    'back_to_event' => 'Torna all\'evento',
    'back_to_tickets' => 'Torna ai biglietti per eventi',
    'gateway_disabled' => 'Il pagamento a pagamento e il pagamento con credito a tempo non sono disponibili. Questa pagina non addebita mai denaro o crediti di tempo e non cambia il tuo portafoglio.',
    'my_tickets' => 'I miei biglietti',
    'no_tickets' => 'Non hai un biglietto per questo evento.',
    'ticket_fallback' => 'Biglietto per eventi',
    'units' => 'Quantità',
    'status_label' => 'Stato',
    'status' => [
        'confirmed' => 'Confermato',
        'cancelled' => 'Annullato',
    ],
    'cancel_ticket' => 'Annulla biglietto',
    'time_credit_cancel_disabled' => 'L\'annullamento del biglietto con credito temporale non è disponibile in questo flusso di lavoro solo gratuito. Non è stata intrapresa alcuna azione sul portafoglio.',
    'catalogue' => 'Biglietti disponibili',
    'catalogue_empty' => 'Non sono disponibili tipologie di biglietto per questo evento.',
    'kind' => [
        'free' => 'Gratuito',
        'time_credit' => 'Crediti temporali',
    ],
    'remaining' => 'Dotazione rimanente',
    'member_limit' => 'Limite per membro',
    'time_credit_disabled' => 'Questo tipo costa :credits crediti temporali, ma il pagamento è disabilitato finché non viene connesso il gateway del portafoglio approvato. Nessun credito verrà addebitato.',
    'units_to_claim' => 'Numero di biglietti gratuiti',
    'reconcile' => 'Eseguire la riconciliazione',
    'reconciliation_clear' => 'L\'inventario dei biglietti e i registri contabili si riconciliano.',
    'reconciliation_warnings' => '{1} :count avviso di riconciliazione|[2,*] :count avvisi di riconciliazione',
    'reconciliation_error' => 'Impossibile completare la riconciliazione del ticket.',
    'units_hint' => 'Puoi richiedere fino a :count in questa allocazione.',
    'claim_free' => 'Richiedi il biglietto gratuito',
    'registration_required' => 'È necessaria la registrazione confermata dell\'evento prima di poter richiedere un biglietto gratuito.',
    'not_eligible' => 'Al momento non soddisfi le regole di idoneità di questo tipo di biglietto.',
    'sales_closed' => 'Questo tipo di biglietto non è attualmente disponibile per l\'assegnazione.',
    'sold_out' => 'Non ti restano biglietti gratuiti in questa allocazione.',
    'cancel_title' => 'Annullare questo biglietto gratuito?',
    'cancel_intro' => 'Spiega all\'organizzatore il motivo per cui stai annullando. La quantità verrà restituita all\'assegnazione gratuita.',
    'cancel_free_only' => 'Questa azione annulla solo un diritto gratuito. Non emette rimborsi né modifica il saldo del portafoglio.',
    'reason_label' => 'Motivo della cancellazione',
    'reason_hint' => 'Non includere informazioni private o sensibili. Massimo 500 caratteri.',
    'confirm_cancel' => 'Annulla il biglietto gratuito',
];
