<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => 'Comunità premurosa',
        'back_to_caring' => 'Torniamo alla comunità di cura',
        'back_to_caregiver' => 'Torniamo alle vostre relazioni di cura',
        'success_title' => 'Successo',
        'error_title' => 'C\'è un problema',
        'unknown_member' => 'Membro sconosciuto',
        'optional' => '(opzionale)',
    ],
    'hub' => [
        'title' => 'Comunità premurosa',
        'caption' => 'Cura e supporto',
        'intro' => 'Organizza assistenza regolare per un altro membro o rispondi a una richiesta di qualcuno che ha chiesto di prendersi cura di te.',
        'caregiver_card_title' => 'Le tue relazioni di cura',
        'caregiver_card_description' => 'Visualizza le relazioni che hai richiesto, rispondi alle richieste su di te e utilizza gli strumenti sbloccati da una relazione approvata.',
        'become_title' => 'Diventa una badante',
        'become_description' => 'Chiedi di fornire assistenza regolare a un altro membro di questa comunità. Niente ha effetto finché non sono d\'accordo e il personale non ha controllato.',
    ],
    'caregiver' => [
        'title' => 'Le tue relazioni di cura',
        'caption' => 'Comunità premurosa',
        'intro' => 'Relazioni che hai richiesto e la loro fase attuale.',
        'none' => 'Non hai ancora chiesto di prenderti cura di nessuno.',
        'become_button' => 'Chiedi di prenderti cura di qualcuno',
        'incoming_title' => 'Richieste su di te',
        'incoming_intro' => 'Questi membri hanno chiesto di prendersi cura di te. Accetto solo se comprendi e accetti cosa significa.',
        'incoming_explanation' => 'Se sei d\'accordo, il personale controllerà la richiesta prima dell\'inizio del rapporto. L\'accordo non lo avvia da solo.',
        'incoming_none' => 'Nessuno ha chiesto di prendersi cura di te.',
        'confirm_button' => 'Sono d\'accordo con questa relazione',
        'reject_button' => 'Non sono d\'accordo',
        'status_heading' => 'Palcoscenico',
        'status_pending_recipient' => 'In attesa che l\'altro membro sia d\'accordo',
        'status_pending_staff' => 'In attesa di una verifica di salvaguardia del personale',
        'status_active' => 'Approvato e attivo',
        'status_rejected' => 'Non approvato',
        'status_inactive' => 'Finito',
        'relationship_heading' => 'Relazione',
        'relationship_family' => 'Famiglia',
        'relationship_friend' => 'Amico',
        'relationship_neighbour' => 'Vicino',
        'relationship_professional' => 'Badante professionale',
        'started_heading' => 'Sono iniziate le cure',
        'reason_heading' => 'Motivo fornito',
        'pending_no_tools' => 'Mentre una richiesta è in attesa, non ti dà accesso ai dettagli dell\'assistenza di questo membro.',
        'active_tools_title' => 'Cosa ti consente di fare questa relazione',
        'request_on_behalf_link' => 'Chiedi aiuto per conto di questo membro',
    ],
    'link' => [
        'title' => 'Chiedi di prenderti cura di qualcuno',
        'caption' => 'Comunità premurosa',
        'intro' => 'Chiedi di fornire assistenza regolare a un altro membro di questa comunità.',
        'consent_warning' => 'Al membro da te nominato verrà chiesto se è d\'accordo. Il personale provvederà poi a verificare la richiesta. La relazione non inizia e non ti dà nulla finché non sono accadute entrambe le cose.',
        'search_label' => 'Trova il membro di cui vuoi prenderti cura',
        'search_hint' => 'Inserisci parte del loro nome, quindi sceglili dai risultati.',
        'search_button' => 'Ricerca',
        'results_title' => 'Scegli un membro',
        'results_none' => 'Nessun membro corrispondeva a quel nome. Prova un\'ortografia diversa.',
        'choose_button' => 'Scegliere',
        'chosen_label' => 'Membro che hai scelto',
        'change_button' => 'Modifica',
        'relationship_label' => 'Il tuo rapporto con loro',
        'start_date_label' => 'Data di inizio o di inizio delle cure',
        'start_date_hint' => 'Ad esempio, 27 3 2026',
        'notes_label' => 'Tutto ciò che il personale dovrebbe sapere',
        'notes_hint' => 'Opzionale. Questo viene mostrato al membro dello staff che controlla la richiesta.',
        'submit_button' => 'Invia richiesta',
        'error_no_member' => 'Scegli il membro di cui vuoi prenderti cura',
        'error_no_relationship' => 'Seleziona la tua relazione con loro',
        'error_no_start_date' => 'Inserisci la data in cui l\'assistenza è iniziata o inizierà',
        'error_bad_start_date' => 'Inserisci una data reale, ad esempio 27 3 2026',
        'error_search_too_short' => 'Inserisci almeno due caratteri per la ricerca',
    ],
    'on_behalf' => [
        'title' => 'Chiedere aiuto per conto di qualcuno',
        'intro' => 'Chiedi alla comunità un aiuto pratico per il membro di cui ti prendi cura. La richiesta è registrata a loro nome e dimostra che l\'hai fatta tu.',
        'for_member' => 'Questa richiesta è per',
        'title_label' => 'Quale aiuto è necessario',
        'title_hint' => 'Ad esempio, un passaggio per un appuntamento in ospedale.',
        'description_label' => 'Maggiori dettagli',
        'when_label' => 'Quando è necessario',
        'contact_label' => 'Come gli aiutanti dovrebbero mettersi in contatto',
        'contact_phone' => 'Per telefono',
        'contact_message' => 'Per messaggio',
        'contact_either' => 'In entrambi i casi va bene',
        'submit_button' => 'Invia richiesta',
        'error_no_title' => 'Inserisci l\'aiuto necessario',
        'error_not_active' => 'Puoi chiedere aiuto solo per conto di un membro la cui relazione è stata approvata',
    ],
    'review' => [
        'title' => 'Il caregiver richiede di controllare',
        'caption' => 'Comunità premurosa',
        'intro' => 'Controlla che il destinatario dell\'assistenza abbia acconsentito e registra come lo hai verificato, prima di approvare una relazione di assistenza.',
        'none' => 'Nessuna richiesta di caregiver è in attesa di essere verificata.',
        'requested_by' => 'Richiesto da',
        'requested_for' => 'Prendersi cura di',
        'requested_on' => 'Richiesto il',
        'recipient_agreed' => 'Il membro ha acconsentito',
        'recipient_not_agreed' => 'Il membro non ha ancora accettato',
        'blocked_until_agreed' => 'Non puoi approvare questa richiesta finché il membro non l\'ha acconsentita.',
        'evidence_label' => 'Come hai verificato il loro consenso',
        'evidence_hint' => 'Ad esempio, una telefonata il 27 marzo 2026 con il membro stesso.',
        'attestation_label' => 'Confermo di aver verificato personalmente il consenso di questo membro',
        'approve_button' => 'Approvare la relazione',
        'reject_label' => 'Perché stai rifiutando questa richiesta',
        'reject_hint' => 'Questo viene registrato e mostrato al membro che ha chiesto.',
        'reject_button' => 'Rifiuta richiesta',
        'decided_approved' => 'Approvato',
        'decided_rejected' => 'Rifiutato',
        'error_no_evidence' => 'Inserisci la modalità con cui hai verificato il loro consenso',
        'error_no_attestation' => 'Conferma di aver verificato tu stesso il consenso di questo membro',
        'error_no_reason' => 'Inserisci il motivo per cui stai rifiutando questa richiesta',
    ],
    'status' => [
        'link_requested' => 'La tua richiesta è stata inviata Si attende l\'accordo dell\'altro membro e poi un controllo da parte dello staff.',
        'link_failed' => 'Non è stato possibile inviare la tua richiesta.',
        'link_duplicate' => 'Hai già una richiesta o una relazione approvata con quel membro.',
        'incoming_confirmed' => 'Hai accettato. Il personale ora controllerà la richiesta prima che il rapporto abbia inizio.',
        'incoming_rejected' => 'Hai rifiutato. Non è stata creata alcuna relazione.',
        'incoming_failed' => 'Impossibile salvare la tua risposta.',
        'review_approved' => 'La relazione di cura è stata approvata.',
        'review_rejected' => 'La richiesta è stata respinta.',
        'review_not_agreed' => 'Tale richiesta non può essere approvata perché il membro non ha accettato.',
        'review_failed' => 'Quella decisione non poteva essere salvata.',
        'review_not_found' => 'Impossibile trovare la richiesta in questa comunità.',
        'on_behalf_sent' => 'La richiesta di aiuto è stata inviata.',
        'on_behalf_failed' => 'Non è stato possibile inviare la richiesta di aiuto.',
    ],
];
