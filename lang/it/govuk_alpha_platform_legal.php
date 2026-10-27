<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Page chrome for the PLATFORM's own legal documents (Project NEXUS, not a
// community) on the accessible frontend: /platform/terms, /platform/privacy and
// /platform/disclaimer. Ported from react-frontend/public/locales/<locale>/legal.json
// (platform, platform_terms, platform_privacy, platform_disclaimer, page_meta, hub).
// The documents' substantive text is canonically English and is NOT translated
// here — see web-uk/scripts/build-platform-legal-text.js.

return [
    'caption' => 'Piattaforma Project NEXUS',
    'effective_date' => 'In vigore dal :date',
    'provider_notice_title' => 'Avviso del Fornitore della Piattaforma',
    'provider_notice_body' => 'Questo documento regola il rapporto tra te e Project NEXUS (il fornitore della piattaforma). È separato da qualsiasi termine stabilito da :tenant (il tuo operatore comunitario).',
    'authoritative_notice_title' => 'Versione inglese autentica',
    'authoritative_notice_body' => 'Il testo giuridico sostanziale di questa pagina è la versione inglese autentica. Questo avviso è tradotto per comodità; in caso di differenze, prevale il testo inglese.',
    'view_tenant_legal' => 'Visualizza i documenti legali di :tenant',
    'contents' => 'Indice',
    'related_documents' => 'Documenti della Piattaforma Correlati',
    'cta_title' => 'Domande su Questo Documento?',
    'cta_body' => 'Per domande su questo documento a livello di piattaforma, contatta il team di Project NEXUS. Per domande sulle politiche della tua comunità, contatta direttamente :tenant.',
    'nexus_website' => 'Sito Web Project NEXUS',
    'contact_tenant' => 'Contatta :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Termini di Servizio della Piattaforma',
            'title' => 'Termini di Servizio della Piattaforma',
            'subtitle' => 'I termini che regolano l\'infrastruttura della piattaforma Project NEXUS',
            'meta_title' => 'Termini di Servizio della Piattaforma',
            'meta_description' => 'Termini di servizio che regolano l\'uso della piattaforma di timebanking comunitario NEXUS.',
            'link_label' => 'Termini di Servizio della Piattaforma',
            'sections' => [
                'introduction' => 'Introduzione e accettazione',
                'provider' => 'Identità del fornitore della piattaforma',
                'definitions' => 'Definizioni',
                'operator-responsibilities' => 'Responsabilità dell\'operatore',
                'acceptable-use' => 'Uso accettabile',
                'intellectual-property' => 'Proprietà intellettuale',
                'limitation-of-liability' => 'Limitazione di responsabilità',
                'indemnification' => 'Indennizzo',
                'data-processing' => 'Trattamento dei dati',
                'termination' => 'Risoluzione',
                'changes' => 'Modifiche alle condizioni',
                'governing-law' => 'Legge applicabile',
            ],
        ],
        'privacy' => [
            'page_title' => 'Informativa sulla Privacy della Piattaforma',
            'title' => 'Informativa sulla Privacy della Piattaforma',
            'subtitle' => 'Come Project NEXUS gestisce i dati a livello di infrastruttura della piattaforma',
            'meta_title' => 'Informativa sulla Privacy della Piattaforma',
            'meta_description' => 'Come la piattaforma NEXUS raccoglie, elabora e protegge i tuoi dati personali.',
            'link_label' => 'Informativa sulla Privacy della Piattaforma',
            'sections' => [
                'introduction' => 'Introduzione',
                'controller-processor' => 'Titolare del trattamento e responsabile del trattamento',
                'data-collected' => 'Dati raccolti a livello di piattaforma',
                'legal-basis' => 'Base giuridica del trattamento',
                'data-sharing' => 'Comunicazione dei dati',
                'international-transfers' => 'Trasferimenti internazionali di dati',
                'retention' => 'Conservazione dei dati',
                'your-rights' => 'I tuoi diritti ai sensi del GDPR',
                'security' => 'Misure di sicurezza',
                'contact' => 'Contatto',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Disclaimer della Piattaforma',
            'title' => 'Disclaimer della Piattaforma',
            'subtitle' => 'Importanti limitazioni di responsabilità per la piattaforma Project NEXUS',
            'meta_title' => 'Dichiarazione di Non Responsabilità della Piattaforma',
            'meta_description' => 'Importanti dichiarazioni di non responsabilità sull\'uso della piattaforma di timebanking comunitario NEXUS.',
            'link_label' => 'Disclaimer della Piattaforma',
            'sections' => [
                'no-warranty' => 'Nessuna garanzia',
                'no-advice' => 'Nessuna consulenza legale, finanziaria o regolamentare',
                'operator-independence' => 'Indipendenza degli operatori della community',
                'member-interactions' => 'Interazioni tra membri',
                'content-uploads' => 'Contenuti e caricamenti',
                'identity-verification' => 'Verifica dell\'identità',
                'third-party' => 'Servizi di terzi',
                'limitation-of-liability' => 'Limitazione di responsabilità',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Legale del fornitore della piattaforma',
        'section_desc' => 'Questi documenti regolano l\'infrastruttura della piattaforma Project NEXUS e sono separati dalle politiche della tua comunità.',
        'terms' => 'Termini della piattaforma',
        'privacy' => 'Privacy della piattaforma',
        'disclaimer' => 'Disclaimer della Piattaforma',
    ],
];
