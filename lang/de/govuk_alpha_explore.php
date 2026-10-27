<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Accessible Explore page (web-uk) — parity with React's ExplorePage.
// Most strings reuse react-frontend/public/locales/<locale>/explore.json.

return [
    'tabs_label' => 'Entdecken-Inhaltsregister',
    'tabs' => [
        'all' => 'Alle',
        'for_you' => 'Für Sie',
        'listings' => 'Anzeigen',
        'people' => 'Personen',
        'events' => 'Veranstaltungen',
        'groups' => 'Gruppen',
    ],
    'search_label' => 'Fähigkeiten, Veranstaltungen, Gruppen entdecken',
    'search_button' => 'Suchen',
    'categories_heading' => 'Anzeigen nach Kategorie durchsuchen',
    'see_all' => 'Alle anzeigen',
    'stats' => [
        'heading' => 'Ihre Gemeinschaft in Zahlen',
        'members' => 'Mitglieder',
        'exchanges_this_month' => 'Tausche diesen Monat',
        'hours_exchanged' => 'Getauschte Stunden',
        'active_listings' => 'Aktive Anzeigen',
    ],
    'sections' => [
        'trending_posts' => [
            'title' => 'Trendende Beiträge',
            'subtitle' => 'Beliebteste Beiträge dieser Woche',
        ],
        'popular_listings' => [
            'title' => 'Beliebte Anzeigen',
            'subtitle' => 'Meistgesehene Angebote und Gesuche',
        ],
        'upcoming_events' => [
            'title' => 'Bevorstehende Veranstaltungen',
            'subtitle' => 'Treten Sie Ihrer Gemeinschaft bei',
        ],
        'active_groups' => [
            'title' => 'Aktive Gruppen',
            'subtitle' => 'Mit Gleichgesinnten vernetzen',
        ],
        'top_contributors' => [
            'title' => 'Top-Beitragende',
            'subtitle' => 'Gemeinschaftsführer nach Erfahrung',
        ],
        'trending_hashtags' => [
            'title' => 'Trendende Hashtags',
            'subtitle' => 'Beliebte Themen in Ihrer Gemeinschaft',
        ],
        'recommended' => [
            'title' => 'Für Sie empfohlen',
            'subtitle' => 'Basierend auf Ihren Interessen und Aktivitäten',
        ],
        'near_you' => [
            'title' => 'In Ihrer Nähe',
            'subtitle' => 'Anzeigen in der Nähe Ihres Standorts',
        ],
        'suggested_connections' => [
            'title' => 'Personen, die Sie kennen könnten',
            'subtitle' => 'Vernetzen Sie sich mit Mitgliedern, die Ihre Interessen teilen',
        ],
        'blog_posts' => [
            'title' => 'Aus dem Blog',
            'subtitle' => 'Neueste Geschichten aus Ihrer Gemeinschaft',
        ],
        'volunteering' => [
            'title' => 'Freiwilligenmöglichkeiten',
            'subtitle' => 'Machen Sie einen Unterschied in Ihrer Gemeinschaft',
        ],
        'polls' => [
            'title' => 'Aktive Umfragen',
            'subtitle' => 'Sagen Sie Ihre Meinung zu Gemeinschaftsthemen',
        ],
        'in_demand_skills' => [
            'title' => 'Gefragte Fähigkeiten',
            'subtitle' => 'Die meistgefragten Fähigkeiten in Ihrer Gemeinschaft',
        ],
        'organisations' => [
            'title' => 'Organisationen',
            'subtitle' => 'Gemeinschaftspartner mit Wirkung',
        ],
        'jobs' => [
            'title' => 'Stellenangebote',
            'subtitle' => 'Neueste Stellen von Gemeinschaftspartnern',
        ],
        'resources' => [
            'title' => 'Empfohlene Ressourcen',
            'subtitle' => 'Anleitungen und Materialien für Ihre Gemeinschaft',
        ],
        'new_members' => [
            'title' => 'Begrüssen Sie unsere neuesten Mitglieder',
            'subtitle' => 'Begrüssen Sie neue Mitglieder',
        ],
        'featured_challenges' => [
            'title' => 'Empfohlene Herausforderungen',
            'subtitle' => 'Teilen Sie Ihre Ideen und bewirken Sie etwas',
        ],
    ],
    'meta' => [
        'attending' => ':count nehmen teil',
        'members' => ':count Mitglieder',
        'level' => 'Stufe :level',
        'match' => ':score% Übereinstimmung',
        'by_author' => 'von :name',
        'distance' => ':distance km entfernt',
        'read_time' => ':count Min. Lesezeit',
        'applications' => ':count beworben',
        'votes' => ':count Stimmen',
        'closes' => 'Endet am :date',
        'requesting' => ':count suchen',
        'offering' => ':count bieten an',
        'opportunities' => ':count Möglichkeiten',
        'deadline' => 'Frist: :date',
        'ideas' => ':count Ideen',
        'ends' => 'Endet am :date',
    ],
    'content_types' => [
        'listing' => 'Anzeige',
        'post' => 'Beitrag',
        'event' => 'Veranstaltung',
        'group' => 'Gruppe',
        'member' => 'Mitglied',
        'blog' => 'Blogartikel',
    ],
    'dismiss' => 'Nicht interessiert',
    'dismissed' => 'Wir werden Ihnen diese Anzeige nicht mehr empfehlen.',
    'dismiss_failed' => 'Diese Empfehlung konnte nicht ausgeblendet werden. Versuchen Sie es später erneut.',
    'for_you' => [
        'empty' => 'Interagieren Sie mit Inseraten, Beiträgen und Veranstaltungen, um personalisierte Empfehlungen zu erhalten.',
        'end_of_feed' => 'Sie sind auf dem neuesten Stand!',
        'load_more' => 'Weitere Empfehlungen anzeigen',
        'load_error' => 'Ihre persönlichen Empfehlungen konnten nicht geladen werden. Versuchen Sie es später erneut.',
    ],
    'load_error' => 'Die Entdecken-Bereiche konnten nicht geladen werden. Das kann ein vorübergehendes Problem sein. Versuchen Sie es später erneut.',
    'empty' => [
        'listings' => 'Noch keine Inserate vorhanden. Erstellen Sie das erste!',
        'people' => 'Noch keine Mitglieder anzuzeigen. Laden Sie jemanden ein!',
        'events' => 'Keine bevorstehenden Veranstaltungen. Erstellen Sie eine, um Ihre Gemeinschaft zusammenzubringen!',
        'groups' => 'Noch keine aktiven Gruppen. Gründen Sie eine Gruppe zu Ihren Interessen!',
    ],
    'create_listing' => 'Inserat erstellen',
    'create_group' => 'Gruppe erstellen',
];
