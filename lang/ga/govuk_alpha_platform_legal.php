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
    'caption' => 'Ardán Project NEXUS',
    'effective_date' => 'I bhfeidhm ón :date',
    'provider_notice_title' => 'Fógra Soláthraí Ardáin',
    'provider_notice_body' => 'Rialaíonn an doiciméad seo an gaol idir tú féin agus Project NEXUS (soláthraí an ardáin). Tá sé ar leith ó aon téarmaí arna mbunú ag :tenant (oibreoir do phobail).',
    'authoritative_notice_title' => 'Leagan údarásach Béarla',
    'authoritative_notice_body' => 'Is é an téacs dlíthiúil substainteach ar an leathanach seo an leagan údarásach Béarla. Aistríodh an fógra seo ar mhaithe le háisiúlacht; má bhíonn difríocht idir aistriúchán agus an téacs Béarla, is é an téacs Béarla atá i réim.',
    'view_tenant_legal' => 'Féach ar dhoiciméid dhlíthiúla :tenant',
    'contents' => 'Clár Ábhair',
    'related_documents' => 'Doiciméid Ghaolmhara an Ardáin',
    'cta_title' => 'Ceisteanna Faoin Doiciméad Seo?',
    'cta_body' => 'Má tá ceisteanna agat faoin doiciméad seo ar leibhéal an ardáin, déan teagmháil le foireann Project NEXUS. Maidir le ceisteanna faoi bheartais do phobail, déan teagmháil le :tenant go díreach.',
    'nexus_website' => 'Suíomh Gréasáin Project NEXUS',
    'contact_tenant' => 'Déan teagmháil le :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Téarmaí Seirbhíse an Ardáin',
            'title' => 'Téarmaí Seirbhíse an Ardáin',
            'subtitle' => 'Na téarmaí a rialaíonn bonneagar ardáin Project NEXUS',
            'meta_title' => 'Téarmaí Seirbhíse an Ardáin',
            'meta_description' => 'Téarmaí seirbhíse a rialaíonn úsáid ardán baincéireachta ama pobail NEXUS.',
            'link_label' => 'Téarmaí Seirbhíse an Ardáin',
            'sections' => [
                'introduction' => 'Réamhrá agus Glacadh',
                'provider' => 'Céannacht Sholáthraí an Ardáin',
                'definitions' => 'Sainmhínithe',
                'operator-responsibilities' => 'Freagrachtaí an Oibreora',
                'acceptable-use' => 'Úsáid Inghlactha',
                'intellectual-property' => 'Maoin Intleachtúil',
                'limitation-of-liability' => 'Teorannú Dliteanais',
                'indemnification' => 'Slánaíocht',
                'data-processing' => 'Próiseáil Sonraí',
                'termination' => 'Foirceannadh',
                'changes' => 'Athruithe ar na Téarmaí',
                'governing-law' => 'An Dlí is Infheidhme',
            ],
        ],
        'privacy' => [
            'page_title' => 'Beartas Príobháideachais an Ardáin',
            'title' => 'Beartas Príobháideachais an Ardáin',
            'subtitle' => 'Conas a láimhseálann Project NEXUS sonraí ag leibhéal bonneagair an ardáin',
            'meta_title' => 'Beartas Príobháideachais an Ardáin',
            'meta_description' => 'Conas a bhailíonn, a phróiseálann agus a chosnaíonn ardán NEXUS do shonraí pearsanta.',
            'link_label' => 'Beartas Príobháideachais an Ardáin',
            'sections' => [
                'introduction' => 'Réamhrá',
                'controller-processor' => 'Rialaitheoir Sonraí agus Próiseálaí Sonraí',
                'data-collected' => 'Sonraí a Bhailímid ar Leibhéal an Ardáin',
                'legal-basis' => 'Bunús Dlíthiúil leis an bPróiseáil',
                'data-sharing' => 'Comhroinnt Sonraí',
                'international-transfers' => 'Aistrithe Sonraí Idirnáisiúnta',
                'retention' => 'Coinneáil Sonraí',
                'your-rights' => 'Do Chearta faoi RGCS',
                'security' => 'Bearta Slándála',
                'contact' => 'Teagmháil',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Séanadh an Ardáin',
            'title' => 'Séanadh an Ardáin',
            'subtitle' => 'Séanaimh thábhachtacha agus teorainneacha dliteanais don ardán Project NEXUS',
            'meta_title' => 'Séanadh an Ardáin',
            'meta_description' => 'Séanaidh thábhachtacha maidir le húsáid ardán baincéireachta ama pobail NEXUS.',
            'link_label' => 'Séanadh an Ardáin',
            'sections' => [
                'no-warranty' => 'Gan Aon Bharántas',
                'no-advice' => 'Gan Comhairle Dlí, Airgeadais ná Rialála',
                'operator-independence' => 'Neamhspleáchas Oibreoir an Phobail',
                'member-interactions' => 'Idirghníomhaíochtaí idir Baill',
                'content-uploads' => 'Ábhar agus Uaslódálacha',
                'identity-verification' => 'Fíorú Céannachta',
                'third-party' => 'Seirbhísí Tríú Páirtí',
                'limitation-of-liability' => 'Teorannú Dliteanais',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Dlí Soláthraí an Ardáin',
        'section_desc' => 'Rialaíonn na doiciméid seo bonneagar ardáin Project NEXUS agus tá siad ar leith ó bheartais do phobail.',
        'terms' => 'Téarmaí an Ardáin',
        'privacy' => 'Príobháideachas an Ardáin',
        'disclaimer' => 'Séanadh',
    ],
];
