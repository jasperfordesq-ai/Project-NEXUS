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
    'caption' => 'Project NEXUS Plattform',
    'effective_date' => 'Gültig ab :date',
    'provider_notice_title' => 'Plattform-Anbieterhinweis',
    'provider_notice_body' => 'Dieses Dokument regelt die Beziehung zwischen Ihnen und Project NEXUS (dem Plattformanbieter). Es ist von den Bedingungen von :tenant (Ihrem Gemeinschaftsbetreiber) getrennt.',
    'authoritative_notice_title' => 'Verbindliche englische Fassung',
    'authoritative_notice_body' => 'Der maßgebliche Rechtstext auf dieser Seite ist die englische Fassung. Dieser Hinweis wurde zur Unterstützung übersetzt; bei Abweichungen ist der englische Text maßgeblich.',
    'view_tenant_legal' => 'Rechtsdokumente von :tenant ansehen',
    'contents' => 'Inhaltsverzeichnis',
    'related_documents' => 'Verwandte Plattform-Dokumente',
    'cta_title' => 'Fragen zu diesem Dokument?',
    'cta_body' => 'Wenn Sie Fragen zu diesem Plattform-Dokument haben, kontaktieren Sie das Project NEXUS-Team. Bei Fragen zu den Richtlinien Ihrer Gemeinschaft, kontaktieren Sie :tenant direkt.',
    'nexus_website' => 'Projekt NEXUS Website',
    'contact_tenant' => ':tenant kontaktieren',
    'documents' => [
        'terms' => [
            'page_title' => 'Plattform-Nutzungsbedingungen',
            'title' => 'Plattform-Nutzungsbedingungen',
            'subtitle' => 'Die Nutzungsbedingungen für die Project NEXUS-Plattforminfrastruktur',
            'meta_title' => 'Nutzungsbedingungen der Plattform',
            'meta_description' => 'Nutzungsbedingungen für die Nutzung der NEXUS Community-Zeitbanking-Plattform.',
            'link_label' => 'Plattform-Nutzungsbedingungen',
            'sections' => [
                'introduction' => 'Einleitung & Annahme',
                'provider' => 'Identität des Plattformanbieters',
                'definitions' => 'Begriffsbestimmungen',
                'operator-responsibilities' => 'Pflichten der Betreiber',
                'acceptable-use' => 'Zulässige Nutzung',
                'intellectual-property' => 'Geistiges Eigentum',
                'limitation-of-liability' => 'Haftungsbeschränkung',
                'indemnification' => 'Freistellung',
                'data-processing' => 'Datenverarbeitung',
                'termination' => 'Beendigung',
                'changes' => 'Änderungen der Bedingungen',
                'governing-law' => 'Anwendbares Recht',
            ],
        ],
        'privacy' => [
            'page_title' => 'Plattform-Datenschutzrichtlinie',
            'title' => 'Plattform-Datenschutzrichtlinie',
            'subtitle' => 'Wie Project NEXUS Daten auf Plattform-Infrastrukturebene handhabt',
            'meta_title' => 'Datenschutzrichtlinie der Plattform',
            'meta_description' => 'Wie die NEXUS-Plattform Ihre persönlichen Daten sammelt, verarbeitet und schützt.',
            'link_label' => 'Plattform-Datenschutzrichtlinie',
            'sections' => [
                'introduction' => 'Einleitung',
                'controller-processor' => 'Verantwortlicher vs. Auftragsverarbeiter',
                'data-collected' => 'Auf Plattformebene erfasste Daten',
                'legal-basis' => 'Rechtsgrundlage der Verarbeitung',
                'data-sharing' => 'Datenweitergabe',
                'international-transfers' => 'Internationale Datenübermittlung',
                'retention' => 'Aufbewahrung der Daten',
                'your-rights' => 'Ihre Rechte nach der DSGVO',
                'security' => 'Sicherheitsmaßnahmen',
                'contact' => 'Kontakt',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Plattform-Haftungsausschluss',
            'title' => 'Plattform-Haftungsausschluss',
            'subtitle' => 'Wichtige Haftungsausschlüsse und Haftungsbeschränkungen für die Project NEXUS-Plattform',
            'meta_title' => 'Haftungsausschluss der Plattform',
            'meta_description' => 'Wichtige Haftungsausschlüsse zur Nutzung der NEXUS Community-Zeitbanking-Plattform.',
            'link_label' => 'Plattform-Haftungsausschluss',
            'sections' => [
                'no-warranty' => 'Keine Gewährleistung',
                'no-advice' => 'Keine Rechts-, Finanz- oder Regulierungsberatung',
                'operator-independence' => 'Unabhängigkeit der Community-Betreiber',
                'member-interactions' => 'Interaktionen zwischen Mitgliedern',
                'content-uploads' => 'Inhalte und Uploads',
                'identity-verification' => 'Identitätsprüfung',
                'third-party' => 'Dienste Dritter',
                'limitation-of-liability' => 'Haftungsbeschränkung',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Rechtliche Hinweise zum Plattformanbieter',
        'section_desc' => 'Diese Dokumente regeln die Infrastruktur der Project NEXUS-Plattform und sind von den Richtlinien Ihrer Community getrennt.',
        'terms' => 'Plattformbedingungen',
        'privacy' => 'Plattform-Datenschutz',
        'disclaimer' => 'Haftungsausschluss',
    ],
];
