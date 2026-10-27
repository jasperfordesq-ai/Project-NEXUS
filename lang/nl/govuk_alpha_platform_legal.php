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
    'caption' => 'Project NEXUS-platform',
    'effective_date' => 'Ingangsdatum :date',
    'provider_notice_title' => 'Kennisgeving van de platformprovider',
    'provider_notice_body' => 'Dit document regelt de relatie tussen jou en Project NEXUS (de platformprovider). Het is afzonderlijk van de voorwaarden die zijn vastgesteld door :tenant (jouw communityoperator).',
    'authoritative_notice_title' => 'Autoritatieve Engelse versie',
    'authoritative_notice_body' => 'De inhoudelijke juridische tekst op deze pagina is de autoritatieve Engelse versie. Deze kennisgeving is voor het gemak vertaald; bij verschillen is de Engelse tekst leidend.',
    'view_tenant_legal' => 'Bekijk de juridische documenten van :tenant',
    'contents' => 'Inhoud',
    'related_documents' => 'Gerelateerde platformdocumenten',
    'cta_title' => 'Vragen over dit document?',
    'cta_body' => 'Als je vragen hebt over dit document op platformniveau, neem dan contact op met het Project NEXUS-team. Voor vragen over het beleid van jouw community, neem je rechtstreeks contact op met :tenant.',
    'nexus_website' => 'Project NEXUS-website',
    'contact_tenant' => 'Neem contact op met :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Platform Gebruiksvoorwaarden',
            'title' => 'Platform Gebruiksvoorwaarden',
            'subtitle' => 'De voorwaarden die de infrastructuur van het Project NEXUS-platform regelen',
            'meta_title' => 'Voorwaarden van de Dienst van het Platform',
            'meta_description' => 'Voorwaarden voor het gebruik van het NEXUS gemeenschaps timebanking platform.',
            'link_label' => 'Platform Gebruiksvoorwaarden',
            'sections' => [
                'introduction' => 'Inleiding en aanvaarding',
                'provider' => 'Identiteit van de platformaanbieder',
                'definitions' => 'Definities',
                'operator-responsibilities' => 'Verantwoordelijkheden van de operator',
                'acceptable-use' => 'Aanvaardbaar gebruik',
                'intellectual-property' => 'Intellectuele eigendom',
                'limitation-of-liability' => 'Beperking van aansprakelijkheid',
                'indemnification' => 'Vrijwaring',
                'data-processing' => 'Gegevensverwerking',
                'termination' => 'Beëindiging',
                'changes' => 'Wijzigingen in de voorwaarden',
                'governing-law' => 'Toepasselijk recht',
            ],
        ],
        'privacy' => [
            'page_title' => 'Platform Privacybeleid',
            'title' => 'Platform Privacybeleid',
            'subtitle' => 'Hoe Project NEXUS gegevens beheert op het niveau van de platforminfrastructuur',
            'meta_title' => 'Privacybeleid van het Platform',
            'meta_description' => 'Hoe het NEXUS platform jouw persoonlijke gegevens verzamelt, verwerkt en beschermt.',
            'link_label' => 'Platform Privacybeleid',
            'sections' => [
                'introduction' => 'Inleiding',
                'controller-processor' => 'Verwerkingsverantwoordelijke versus verwerker',
                'data-collected' => 'Gegevens die wij op platformniveau verzamelen',
                'legal-basis' => 'Rechtsgrondslag voor verwerking',
                'data-sharing' => 'Delen van gegevens',
                'international-transfers' => 'Internationale doorgifte van gegevens',
                'retention' => 'Bewaartermijn van gegevens',
                'your-rights' => 'Uw rechten onder de AVG',
                'security' => 'Beveiligingsmaatregelen',
                'contact' => 'Contact',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Platformdisclaimer',
            'title' => 'Platformdisclaimer',
            'subtitle' => 'Belangrijke disclaimers en aansprakelijkheidsbeperkingen voor het Project NEXUS-platform',
            'meta_title' => 'Disclaimer van het Platform',
            'meta_description' => 'Belangrijke disclaimers over het gebruik van het NEXUS gemeenschaps timebanking platform.',
            'link_label' => 'Platformdisclaimer',
            'sections' => [
                'no-warranty' => 'Geen garantie',
                'no-advice' => 'Geen juridisch, financieel of regelgevend advies',
                'operator-independence' => 'Onafhankelijkheid van communityoperators',
                'member-interactions' => 'Interacties tussen leden',
                'content-uploads' => 'Content en uploads',
                'identity-verification' => 'Identiteitsverificatie',
                'third-party' => 'Diensten van derden',
                'limitation-of-liability' => 'Beperking van aansprakelijkheid',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Platformaanbieder juridisch',
        'section_desc' => 'Deze documenten zijn van toepassing op de infrastructuur van het Project NEXUS-platform en staan ​​los van het beleid van uw community.',
        'terms' => 'Platformvoorwaarden',
        'privacy' => 'Platformprivacy',
        'disclaimer' => 'Vrijwaring',
    ],
];
