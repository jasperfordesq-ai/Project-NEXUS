<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Accessible Explore page (web-uk) — parity with React's ExplorePage.
// Most strings reuse react-frontend/public/locales/<locale>/explore.json.

return [
    'tabs_label' => 'Przeglądaj zakładki z treściami',
    'tabs' => [
        'all' => 'Wszystko',
        'for_you' => 'Dla Ciebie',
        'listings' => 'Ogłoszenia',
        'people' => 'Osoby',
        'events' => 'Wydarzenia',
        'groups' => 'Grupy',
    ],
    'search_label' => 'Odkryj umiejętności, wydarzenia, grupy',
    'search_button' => 'Szukaj',
    'categories_heading' => 'Przeglądaj ogłoszenia według kategorii',
    'see_all' => 'Zobacz wszystko',
    'stats' => [
        'heading' => 'Twoja społeczność w liczbach',
        'members' => 'Członkowie',
        'exchanges_this_month' => 'Wymiany w tym miesiącu',
        'hours_exchanged' => 'Godziny wymienione',
        'active_listings' => 'Aktywne ogłoszenia',
    ],
    'sections' => [
        'trending_posts' => [
            'title' => 'Trendy posty',
            'subtitle' => 'Najbardziej angażujące posty w tym tygodniu',
        ],
        'popular_listings' => [
            'title' => 'Popularne ogłoszenia',
            'subtitle' => 'Najczęściej oglądane oferty i prośby',
        ],
        'upcoming_events' => [
            'title' => 'Nadchodzące wydarzenia',
            'subtitle' => 'Dołącz do swojej społeczności',
        ],
        'active_groups' => [
            'title' => 'Aktywne grupy',
            'subtitle' => 'Połącz się z podobnie myślącymi członkami',
        ],
        'top_contributors' => [
            'title' => 'Najlepsi współpracownicy',
            'subtitle' => 'Liderzy społeczności według doświadczenia',
        ],
        'trending_hashtags' => [
            'title' => 'Trendy hashtagi',
            'subtitle' => 'Popularne tematy w twojej społeczności',
        ],
        'recommended' => [
            'title' => 'Polecane dla Ciebie',
            'subtitle' => 'Na podstawie twoich zainteresowań i aktywności',
        ],
        'near_you' => [
            'title' => 'W Twojej okolicy',
            'subtitle' => 'Ogłoszenia blisko Twojej lokalizacji',
        ],
        'suggested_connections' => [
            'title' => 'Ludzie, których możesz znać',
            'subtitle' => 'Połącz się z członkami, którzy dzielą Twoje zainteresowania',
        ],
        'blog_posts' => [
            'title' => 'Z bloga',
            'subtitle' => 'Najnowsze historie z Twojej społeczności',
        ],
        'volunteering' => [
            'title' => 'Możliwości wolontariatu',
            'subtitle' => 'Zrób różnicę w swojej społeczności',
        ],
        'polls' => [
            'title' => 'Aktywne ankiety',
            'subtitle' => 'Wyraź swoje zdanie na temat spraw społecznościowych',
        ],
        'in_demand_skills' => [
            'title' => 'Umiejętności w popycie',
            'subtitle' => 'Najczęściej poszukiwane umiejętności w Twojej społeczności',
        ],
        'organisations' => [
            'title' => 'Organizacje',
            'subtitle' => 'Partnerzy społecznościowi, którzy mają wpływ',
        ],
        'jobs' => [
            'title' => 'Oferty pracy',
            'subtitle' => 'Najnowsze oferty od partnerów społeczności',
        ],
        'resources' => [
            'title' => 'Wyróżnione zasoby',
            'subtitle' => 'Przewodniki i materiały dla Twojej społeczności',
        ],
        'new_members' => [
            'title' => 'Witamy naszych najnowszych członków',
            'subtitle' => 'Przywitaj się z nowymi członkami',
        ],
        'featured_challenges' => [
            'title' => 'Wyróżnione wyzwania',
            'subtitle' => 'Podziel się swoimi pomysłami i wprowadź zmiany',
        ],
    ],
    'meta' => [
        'attending' => ':count uczestniczy',
        'members' => ':count członków',
        'level' => 'Poziom :level',
        'match' => ':score% dopasowanie',
        'by_author' => 'przez :name',
        'distance' => ':distance km stąd',
        'read_time' => ':count min czytania',
        'applications' => ':count aplikacji',
        'votes' => ':count głosów',
        'closes' => 'Zamknięcie :date',
        'requesting' => ':count prosi o pomoc',
        'offering' => ':count oferuje pomoc',
        'opportunities' => ':count możliwości',
        'deadline' => 'Termin: :date',
        'ideas' => ':count pomysłów',
        'ends' => 'Kończy się :date',
    ],
    'content_types' => [
        'listing' => 'Ogłoszenie',
        'post' => 'Wpis',
        'event' => 'Wydarzenie',
        'group' => 'Grupa',
        'member' => 'Członek',
        'blog' => 'Artykuł na blogu',
    ],
    'dismiss' => 'Nie zainteresowany',
    'dismissed' => 'Nie będziemy już polecać Ci tego ogłoszenia.',
    'dismiss_failed' => 'Nie udało się ukryć tej rekomendacji. Spróbuj ponownie później.',
    'for_you' => [
        'empty' => 'Interakcja z ogłoszeniami, postami i wydarzeniami, aby uzyskać spersonalizowane rekomendacje.',
        'end_of_feed' => 'Jesteś na bieżąco!',
        'load_more' => 'Pokaż więcej rekomendacji',
        'load_error' => 'Nie udało się wczytać Twoich osobistych rekomendacji. Spróbuj ponownie później.',
    ],
    'load_error' => 'Nie udało się wczytać sekcji odkrywania. Może to być problem tymczasowy. Spróbuj ponownie później.',
    'empty' => [
        'listings' => 'Brak ogłoszeń do wyświetlenia. Bądź pierwszym, który je stworzy!',
        'people' => 'Brak członków do wyświetlenia. Zaproś kogoś do dołączenia!',
        'events' => 'Brak nadchodzących wydarzeń. Stwórz jedno, aby zjednoczyć swoją społeczność!',
        'groups' => 'Brak aktywnych grup. Załóż grupę wokół swoich zainteresowań!',
    ],
    'create_listing' => 'Utwórz ogłoszenie',
    'create_group' => 'Utwórz Grupę',
];
