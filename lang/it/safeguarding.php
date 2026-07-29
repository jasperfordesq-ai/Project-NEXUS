<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Questa conversazione è in pausa per una regola di tutela della comunità. La tua comunità deve aver registrato per te una conferma :types in corso di validità prima che tu possa inviare messaggi a questo membro. Chiedi al tuo referente o al gruppo di amministrazione della comunità di registrare questo stato esclusivamente come metadati. Non inviare né caricare alcun documento di verifica.',
        'vetting_required_title' => 'Controllo di tutela necessario',
        'vetting_required_detail' => 'Questo membro può essere contattato per questo tipo di interazione soltanto da persone la cui comunità ha registrato uno stato :types in corso di validità. Il record contiene esclusivamente metadati; non deve essere inviato o caricato alcun documento.',
        'vetting_required_action' => 'Apri aiuto',
        'contact_restricted' => 'Questo membro ha chiesto che un coordinatore organizzi il contatto per suo conto. Il tuo messaggio non e stato inviato. Contatta il tuo broker o amministratore della comunita per organizzare il prossimo passo sicuro.',
        'contact_restricted_title' => 'Serve accordo con coordinatore',
        'contact_restricted_detail' => 'Questo membro non è disponibile per messaggi diretti perché le sue preferenze di salvaguardia richiedono un contatto mediato da un coordinatore. Puoi chiedere a un coordinatore di aiutarti a organizzare il contatto.',
        'contact_restricted_action' => 'Apri aiuto',
        'coordination_not_required' => 'Il contatto diretto con questo membro è attualmente disponibile — non è necessario un coordinatore per organizzarlo. Aggiorna la pagina e prova a inviare un messaggio.',
        'coordination_request_failed' => 'Non è stato possibile inviare la tua richiesta al coordinatore in questo momento. Riprova tra poco.',
        'vetting_check_failed' => 'Non è stato possibile confermare il tuo stato di verifica in questo momento. Riprova tra poco.',
        'statement_required' => 'È necessario un PDF della Dichiarazione sulla tutela dei minori prima di poter dichiarare che questa comunità lavora con bambini o adulti vulnerabili. Caricane uno per continuare.',
        'invalid_file' => 'Impossibile leggere il file caricato. Riprova con un PDF valido.',
        'pdf_required' => 'La dichiarazione di salvaguardia deve essere un file PDF.',
        'file_too_large' => 'Il file della dichiarazione di salvaguardia è troppo grande. La dimensione massima è 10 MB.',
        'storage_failed' => 'Non è stato possibile salvare il file caricato. Per favore riprova.',
        'statement_missing' => 'Non è presente alcuna dichiarazione di salvaguardia per questa comunità.',
        'file_missing' => 'Impossibile trovare il file della dichiarazione di salvaguardia sul server. Per favore caricalo di nuovo.',
        'revoke_failed' => 'Non potevamo revocare tale preferenza. Potrebbe essere già stato revocato.',
        'policy_unavailable' => 'Non possiamo confermare la politica di salvaguardia della comunità in questo momento. Nessun messaggio è stato inviato. Per favore riprova a breve.',
        'interaction_not_allowed' => 'La politica di salvaguardia della comunità del destinatario non consente questa interazione diretta. Chiedi aiuto a un coordinatore.',
        'policy_unavailable_title' => 'Controllo di salvaguardia temporaneamente non disponibile',
        'policy_unavailable_detail' => 'Il progetto NEXUS non ha potuto valutare in modo sicuro la politica di contatto, quindi questa interazione è stata sospesa.',
        'policy_unavailable_action' => 'Ricontrollare',
        'listing_role_confirmation_required' => 'Questo elenco richiede una decisione DBS avanzata separata confermata dalla comunità per questo ruolo. Una conferma di contatto di Messenger non soddisfa i requisiti di protezione specifici del ruolo.',
        'listing_role_feature_unavailable' => 'Il controllo dei precedenti penali specifico per il ruolo non può ancora essere abilitato qui. La conferma del contatto di Messenger non viene deliberatamente riutilizzata come autorizzazione al ruolo.',
        'compliance_policy_unavailable' => 'Al momento non possiamo confermare in modo sicuro i requisiti di salvaguardia per questo elenco. Riprova più tardi o contatta il tuo broker.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Base',
        'dbs_standard' => 'Norma DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Controllo del Garda',
        'access_ni' => 'AccessoNI',
        'pvg_scotland' => 'PVG Scozia',
        'international' => 'Controllo dei precedenti internazionali',
        'other' => 'Altro controllo di verifica',
        'uk_safeguarding_clearance' => 'Autorizzazione di salvaguardia del Regno Unito',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Giurisdizione di salvaguardia non configurata',
        'united_kingdom' => 'United Kingdom ? national policy package',
        'england_wales' => 'Inghilterra e Galles',
        'scotland' => 'Scozia',
        'northern_ireland' => 'Irlanda del Nord',
        'ireland' => 'Repubblica d\'Irlanda',
        'custom' => 'Giurisdizione doganale',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS avanzato confermato per il contatto protetto dei membri',
        'pvg_scotland' => 'Stato PVG confermato per il contatto membro protetto',
        'access_ni' => 'Stato AccessNI confermato per il contatto membro protetto',
        'garda_vetting' => 'Garda Vetting confermato per contatto membro salvaguardato',
        'uk_safeguarding_clearance' => 'Autorizzazione di salvaguardia del Regno Unito confermata per il contatto con membri tutelati',
    ],
    'confirmation' => [
        'title' => 'Le tue preferenze di protezione sono state salvate',
        'intro' => 'Grazie per aver condiviso questo Ecco un riepilogo di ciò che hai scelto, chi può vederlo e cosa si attiva di conseguenza.',
        'your_selections' => 'Le tue selezioni',
        'no_selections' => 'Non hai selezionato alcuna opzione di protezione.',
        'who_can_see_heading' => 'Chi può vederlo?',
        'who_can_see_body' => 'Solo i coordinatori e gli amministratori della comunità possono vedere queste preferenze. Gli altri membri non possono. Tutti gli accessi vengono registrati.',
        'what_activates_heading' => 'Cosa si attiva di conseguenza',
        'activation_broker_review' => 'Un coordinatore esaminerà e approverà le corrispondenze o gli scambi protetti quando la preferenza selezionata lo richiede. Ciò non dà loro accesso al contenuto del messaggio.',
        'activation_match_approval' => 'Un coordinatore approverà le partite che ti coinvolgono prima che vengano suggerite all\'altro membro.',
        'activation_discovery_hidden' => 'Verrai nascosto alla scoperta dei membri che non hanno completato la verifica richiesta.',
        'activation_notification' => 'Un coordinatore è stato avvisato e ti contatterà per discutere come possiamo aiutare.',
        'activation_none' => 'Da queste selezioni non si attiva alcuna protezione automatica. Le tue preferenze vengono registrate per la consapevolezza del coordinatore.',
        'revoke_heading' => 'Come modificarli o revocarli in qualsiasi momento',
        'revoke_body' => 'Puoi rivedere o revocare qualsiasi di queste preferenze in qualsiasi momento dalle impostazioni del tuo profilo. Non è necessario chiedere a un amministratore di farlo.',
        'revoke_cta' => 'Vai alle impostazioni di protezione',
        'continue_cta' => 'Continuare',
    ],
    'settings' => [
        'page_title' => 'Tutela delle preferenze',
        'intro' => 'Rivedi o revoca le preferenze di protezione impostate durante l\'onboarding. I tuoi coordinatori possono vederli ma gli altri membri no.',
        'no_preferences' => 'Non hai preferenze di salvaguardia attive. Puoi impostarli in qualsiasi momento dalla pagina di aiuto per la salvaguardia.',
        'selected_on' => 'Selezionato il :date',
        'revoke_button' => 'Revocare',
        'revoke_confirm_title' => 'Revoca questa preferenza?',
        'revoke_confirm_body' => 'Questa preferenza non sarà più valida per il tuo account. I tuoi coordinatori verranno informati del cambiamento.',
        'revoke_confirm_yes' => 'Sì, revoca',
        'revoke_confirm_no' => 'Tienilo',
        'revoked_toast' => 'Preferenza revocata.',
        'revoke_error_toast' => 'Qualcosa è andato storto. Per favore riprova.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Questa comunità prende sul serio la tutela delle persone. Se ti consideri una persona adulta vulnerabile o hai bisogno di ulteriore supporto, faccelo sapere affinché il nostro gruppo di coordinamento possa aiutarti a organizzare scambi sicuri.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Mi considero una persona adulta vulnerabile e potrei aver bisogno di ulteriore supporto per la mia tutela',
                    'description' => 'Questo consente al nostro gruppo di coordinamento di sapere che potresti avere bisogno di ulteriore supporto nell’organizzazione degli scambi. Una persona coordinatrice ti contatterà per parlare di come possiamo aiutarti. Queste informazioni sono riservate.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Preferirei interagire soltanto con membri sottoposti agli opportuni controlli',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Vorrei che una persona coordinatrice mi aiutasse a organizzare i miei scambi invece di essere contattato direttamente',
                    'description' => 'Una persona coordinatrice farà da intermediario per tutti i contatti e aiuterà a organizzare gli scambi per tuo conto. Gli altri membri non potranno inviarti messaggi direttamente.',
                ],
                'no_home_visits' => [
                    'label' => 'Non voglio che i membri visitino la mia abitazione senza che una persona coordinatrice lo abbia organizzato',
                    'description' => 'Tutte le visite a domicilio saranno organizzate tramite una persona coordinatrice, che potrà assicurare la presenza di tutele adeguate.',
                ],
                'works_with_children' => [
                    'label' => 'Prevedo di offrire servizi che potrebbero coinvolgere bambini, bambine o giovani (minori di 18 anni)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Prevedo di offrire servizi che potrebbero coinvolgere persone adulte vulnerabili',
                ],
                'none_apply' => [
                    'label' => 'Nessuna di queste situazioni mi riguarda',
                    'description' => 'Ho esaminato le opzioni precedenti e nessuna si applica alla mia situazione. La risposta viene registrata affinché il gruppo di coordinamento sappia che ho visto e considerato questo passaggio.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlanda',
            'vetting_authority' => 'Ufficio nazionale per i controlli',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Irlanda, si intendono membri con Garda Vetting. Il nostro gruppo di coordinamento farà in modo che tu venga abbinato soltanto a membri sottoposti a controllo.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Una persona coordinatrice (intermediaria) farà da tramite per tutti i contatti e aiuterà a organizzare gli scambi per tuo conto. Gli altri membri non potranno inviarti messaggi direttamente.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinatrice potrebbe parlarti dei requisiti della Garda Vetting. In Irlanda, alcune attività che coinvolgono minori richiedono un controllo ai sensi della legge del 2012 sul National Vetting Bureau.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Una persona coordinatrice potrebbe parlarti dei requisiti della Garda Vetting. Le attività che coinvolgono persone adulte vulnerabili possono richiedere un controllo.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Regno Unito',
            'vetting_authority' => 'DBS, Disclosure Scotland e AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In tutto il Regno Unito, i coordinatori confermano l’appropriata base Enhanced DBS, PVG e/o AccessNI per i contatti salvaguardati.',
                ],
                'works_with_children' => [
                    'description' => 'Un coordinatore valuterà il ruolo e la giurisdizione applicabile nel Regno Unito prima di decidere quale controllo di salvaguardia sia giuridicamente appropriato.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinatore valuterà il ruolo, gli adulti coinvolti e la giurisdizione applicabile del Regno Unito prima di decidere quale controllo di salvaguardia è legalmente appropriato.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Inghilterra e Galles',
            'vetting_authority' => 'Servizio per la divulgazione e le interdizioni',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Inghilterra e Galles, si intendono membri sottoposti a controllo DBS. Il nostro gruppo di coordinamento farà in modo che tu venga abbinato soltanto a membri sottoposti a controllo.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinatrice potrebbe parlarti dei requisiti del controllo DBS.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Scozia',
            'vetting_authority' => 'Disclosure Scotland (programma PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Mi considero una persona adulta vulnerabile o protetta e potrei aver bisogno di ulteriore supporto per la mia tutela',
                ],
                'requires_vetted_partners' => [
                    'description' => 'In Scozia, si intendono membri del programma PVG. Il nostro gruppo di coordinamento farà in modo che tu venga abbinato soltanto a membri sottoposti a controllo.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinatrice potrebbe parlarti dell’adesione al programma PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Prevedo di offrire servizi che potrebbero coinvolgere persone adulte protette',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlanda del Nord',
            'vetting_authority' => 'AccessoNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Irlanda del Nord, si intendono membri sottoposti a controllo AccessNI. Il nostro gruppo di coordinamento farà in modo che tu venga abbinato soltanto a membri sottoposti a controllo.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinatrice potrebbe parlarti del controllo AccessNI.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Personalizzato',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'La tua comunità ha cambiato la sua giurisdizione di salvaguardia. La tua protezione esistente rimane attiva, ma rivedi il testo aggiornato in Impostazioni.',
        'jurisdiction_changed_staff' => 'La giurisdizione di tutela è cambiata. Le protezioni dei membri interessati rimangono attive e ora richiedono la revisione dei membri.',
        'attestation_policy_rotated_member' => 'La tua comunità ha avviato una revisione delle politiche di salvaguardia. Il tuo broker deve riconfermare il tuo stato di contatto privato; questa non è una scadenza del certificato.',
        'reminder_subject' => 'Ti invitiamo a rivedere le tue preferenze di protezione',
        'reminder_title' => 'È ora di rivedere le tue preferenze di protezione',
        'reminder_body' => 'È passato più di un anno da quando hai impostato le tue preferenze di protezione per :community. Ti invitiamo a prenderti un momento per esaminarli e verificare che siano ancora applicabili, oppure a revocare quelli che non lo sono più.',
        'reminder_cta' => 'Esamina le preferenze',
        'escalation_subject' => 'Revisione di salvaguardia dei membri in sospeso',
        'escalation_title' => 'Revisione annuale di salvaguardia in sospeso',
        'escalation_body' => ':name non ha risposto a una richiesta di revisione delle proprie preferenze di salvaguardia negli ultimi 30 giorni. Le loro preferenze rimangono attive: il membro ha il diritto di mantenerle. Ti preghiamo di contattarci direttamente se desideri effettuare il check-in.',
        'escalation_cta' => 'Visualizza il membro nella dashboard di protezione',
    ],
];
