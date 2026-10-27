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
    'caption' => 'Platforma Project NEXUS',
    'effective_date' => 'Ważne od :date',
    'provider_notice_title' => 'Informacja dla dostawcy platformy',
    'provider_notice_body' => 'Ten dokument reguluje relacje między Tobą a Project NEXUS (dostawcą platformy). Jest oddzielny od jakichkolwiek warunków ustalonych przez :tenant (Twojego operatora społecznościowego).',
    'authoritative_notice_title' => 'Autorytatywna wersja angielska',
    'authoritative_notice_body' => 'Treść prawna tej strony w języku angielskim jest wiążącą wersją. Niniejszą informację przetłumaczono dla wygody; w razie rozbieżności obowiązuje tekst angielski.',
    'view_tenant_legal' => 'Zobacz dokumenty prawne :tenant',
    'contents' => 'Zawartość',
    'related_documents' => 'Powiązane dokumenty platformy',
    'cta_title' => 'Masz pytania dotyczące tego dokumentu?',
    'cta_body' => 'Jeśli masz pytania dotyczące tego dokumentu na poziomie platformy, skontaktuj się z zespołem Project NEXUS. W przypadku pytań dotyczących polityki Twojej społeczności, skontaktuj się bezpośrednio z :tenant.',
    'nexus_website' => 'Strona internetowa Project NEXUS',
    'contact_tenant' => 'Skontaktuj się z :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Warunki korzystania z platformy',
            'title' => 'Warunki korzystania z platformy',
            'subtitle' => 'Warunki regulujące infrastrukturę platformy Project NEXUS',
            'meta_title' => 'Warunki korzystania z platformy',
            'meta_description' => 'Warunki korzystania regulujące korzystanie z platformy czasowej NEXUS.',
            'link_label' => 'Warunki korzystania z platformy',
            'sections' => [
                'introduction' => 'Wprowadzenie i akceptacja',
                'provider' => 'Tożsamość dostawcy platformy',
                'definitions' => 'Definicje',
                'operator-responsibilities' => 'Obowiązki operatora',
                'acceptable-use' => 'Dopuszczalne korzystanie',
                'intellectual-property' => 'Własność intelektualna',
                'limitation-of-liability' => 'Ograniczenie odpowiedzialności',
                'indemnification' => 'Zwolnienie z odpowiedzialności',
                'data-processing' => 'Przetwarzanie danych',
                'termination' => 'Wygaśnięcie',
                'changes' => 'Zmiany warunków',
                'governing-law' => 'Prawo właściwe',
            ],
        ],
        'privacy' => [
            'page_title' => 'Polityka prywatności platformy',
            'title' => 'Polityka prywatności platformy',
            'subtitle' => 'Jak Project NEXUS zarządza danymi na poziomie infrastruktury platformy',
            'meta_title' => 'Polityka prywatności platformy',
            'meta_description' => 'Jak platforma NEXUS zbiera, przetwarza i chroni Twoje dane osobowe.',
            'link_label' => 'Polityka prywatności platformy',
            'sections' => [
                'introduction' => 'Wprowadzenie',
                'controller-processor' => 'Administrator danych a podmiot przetwarzający',
                'data-collected' => 'Dane gromadzone na poziomie platformy',
                'legal-basis' => 'Podstawa prawna przetwarzania',
                'data-sharing' => 'Udostępnianie danych',
                'international-transfers' => 'Międzynarodowe przekazywanie danych',
                'retention' => 'Okres przechowywania danych',
                'your-rights' => 'Twoje prawa wynikające z RODO',
                'security' => 'Środki bezpieczeństwa',
                'contact' => 'Kontakt',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Zrzeczenie się odpowiedzialności platformy',
            'title' => 'Zrzeczenie się odpowiedzialności platformy',
            'subtitle' => 'Wažne zrzeczenia się odpowiedzialności i ograniczenia odpowiedzialności dla platformy Project NEXUS',
            'meta_title' => 'Zrzeczenie się odpowiedzialności platformy',
            'meta_description' => 'Wažne zrzeczenia dotyczące korzystania z platformy czasowej NEXUS.',
            'link_label' => 'Zrzeczenie się odpowiedzialności platformy',
            'sections' => [
                'no-warranty' => 'Brak gwarancji',
                'no-advice' => 'Brak doradztwa prawnego, finansowego ani regulacyjnego',
                'operator-independence' => 'Niezależność operatorów społeczności',
                'member-interactions' => 'Interakcje między członkami',
                'content-uploads' => 'Treści i przesyłane pliki',
                'identity-verification' => 'Weryfikacja tożsamości',
                'third-party' => 'Usługi podmiotów trzecich',
                'limitation-of-liability' => 'Ograniczenie odpowiedzialności',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Dostawca platformy Informacje prawne',
        'section_desc' => 'Dokumenty te regulują infrastrukturę platformy Project NEXUS i są niezależne od zasad obowiązujących w Twojej społeczności.',
        'terms' => 'Warunki platformy',
        'privacy' => 'Prywatność platformy',
        'disclaimer' => 'Zastrzeżenie',
    ],
];
