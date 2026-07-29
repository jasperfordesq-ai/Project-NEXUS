<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Ta rozmowa została wstrzymana przez zasadę ochrony społeczności. Zanim napiszesz do tego członka, Twoja społeczność musi mieć odnotowane aktualne potwierdzenie statusu :types. Poproś pośrednika lub administratora społeczności o zapisanie tego statusu wyłącznie jako metadanych. Nie wysyłaj ani nie przesyłaj żadnego dokumentu weryfikacyjnego.',
        'vetting_required_title' => 'Wymagana kontrola ochronna',
        'vetting_required_detail' => 'Z tym członkiem w ramach tego rodzaju interakcji mogą kontaktować się wyłącznie osoby, których społeczność odnotowała aktualny status :types. Zapis zawiera wyłącznie metadane; nie należy wysyłać ani przesyłać żadnego dokumentu.',
        'vetting_required_action' => 'Otworz pomoc',
        'contact_restricted' => 'Ten czlonek poprosil, aby koordynator organizowal kontakt w jego imieniu. Wiadomosc nie zostala wyslana. Skontaktuj sie z brokerem lub administratorem spolecznosci, aby ustalic kolejny bezpieczny krok.',
        'contact_restricted_title' => 'Wymagane ustalenie z koordynatorem',
        'contact_restricted_detail' => 'Ten członek nie jest dostępny do bezpośrednich wiadomości, ponieważ jego preferencje ochronne wymagają kontaktu za pośrednictwem koordynatora. Możesz poprosić koordynatora o pomoc w nawiązaniu kontaktu.',
        'contact_restricted_action' => 'Otworz pomoc',
        'coordination_not_required' => 'Bezpośredni kontakt z tym członkiem jest obecnie dostępny — nie potrzebujesz koordynatora, aby go nawiązać. Odśwież stronę i spróbuj ponownie wysłać wiadomość.',
        'coordination_request_failed' => 'Nie udało się wysłać Twojej prośby do koordynatora. Spróbuj ponownie za chwilę.',
        'vetting_check_failed' => 'Nie udało się potwierdzić Twojego statusu weryfikacji w tej chwili. Spróbuj ponownie za chwilę.',
        'statement_required' => 'Zanim będziesz mógł zadeklarować, że ta społeczność pracuje z dziećmi lub bezbronnymi dorosłymi, wymagany jest plik PDF z Oświadczeniem o ochronie dzieci. Prześlij jeden, aby kontynuować.',
        'invalid_file' => 'Nie można odczytać przesłanego pliku. Spróbuj ponownie, korzystając z prawidłowego pliku PDF.',
        'pdf_required' => 'Oświadczenie zabezpieczające musi mieć formę pliku PDF.',
        'file_too_large' => 'Plik oświadczenia zabezpieczającego jest za duży. Maksymalny rozmiar to 10MB.',
        'storage_failed' => 'Nie udało się zapisać przesłanego pliku. Spróbuj ponownie.',
        'statement_missing' => 'W aktach tej społeczności nie ma żadnego oświadczenia zabezpieczającego.',
        'file_missing' => 'Nie można znaleźć pliku instrukcji zabezpieczającej na serwerze. Prześlij go ponownie.',
        'revoke_failed' => 'Nie mogliśmy odwołać tej preferencji. Być może zostało już cofnięte.',
        'policy_unavailable' => 'Nie możemy teraz potwierdzić polityki ochrony społeczności. Żadna wiadomość nie została wysłana. Spróbuj ponownie wkrótce.',
        'interaction_not_allowed' => 'Polityka ochrony społeczności odbiorcy nie pozwala na tę bezpośrednią interakcję. Poproś koordynatora o pomoc.',
        'policy_unavailable_title' => 'Kontrola zabezpieczająca chwilowo niedostępna',
        'policy_unavailable_detail' => 'Projekt NEXUS nie mógł bezpiecznie ocenić zasad kontaktu, więc ta interakcja została wstrzymana.',
        'policy_unavailable_action' => 'Sprawdź ponownie',
        'listing_role_confirmation_required' => 'Ta aukcja wymaga osobnej, potwierdzonej przez społeczność decyzji Enhanced DBS dla tej roli. Potwierdzenie kontaktu przez komunikator nie spełnia wymagań dotyczących zabezpieczeń związanych z daną rolą.',
        'listing_role_feature_unavailable' => 'W tym miejscu nie można jeszcze włączyć sprawdzania rejestrów karnych dla poszczególnych ról. Potwierdzenie kontaktu przez komunikator celowo nie jest ponownie wykorzystywane do potwierdzenia roli.',
        'compliance_policy_unavailable' => 'W tej chwili nie możemy bezpiecznie potwierdzić wymagań dotyczących zabezpieczeń dla tego wpisu. Spróbuj ponownie później lub skontaktuj się ze swoim brokerem.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'Podstawowy DBS',
        'dbs_standard' => 'Standard DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Kontrola Gardy',
        'access_ni' => 'DostępNI',
        'pvg_scotland' => 'PVG Szkocja',
        'international' => 'Międzynarodowa kontrola przeszłości',
        'other' => 'Inna weryfikacja',
        'uk_safeguarding_clearance' => 'Wielka Brytania zapewniająca zezwolenie',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Nie skonfigurowano jurysdykcji zabezpieczającej',
        'united_kingdom' => 'United Kingdom ? national policy package',
        'england_wales' => 'Anglia i Walia',
        'scotland' => 'Szkocja',
        'northern_ireland' => 'Irlandia Północna',
        'ireland' => 'Republika Irlandii',
        'custom' => 'Jurysdykcja celna',
    ],
    'attestations' => [
        'dbs_enhanced' => 'Potwierdzono ulepszony DBS dla zabezpieczonego kontaktu członkowskiego',
        'pvg_scotland' => 'Status PVG potwierdzony dla zabezpieczonego kontaktu członkowskiego',
        'access_ni' => 'Status AccessNI potwierdzony dla chronionego kontaktu członkowskiego',
        'garda_vetting' => 'Potwierdzono, że Garda Vetting zapewnia chroniony kontakt z członkami',
        'uk_safeguarding_clearance' => 'Potwierdzono zezwolenie zabezpieczające w Wielkiej Brytanii dla chronionego kontaktu członkowskiego',
    ],
    'confirmation' => [
        'title' => 'Twoje preferencje dotyczące ochrony zostały zapisane',
        'intro' => 'Dziękuję za podzielenie się tym. Oto podsumowanie tego, co wybrałeś, kto może to zobaczyć i co się w rezultacie aktywuje.',
        'your_selections' => 'Twoje wybory',
        'no_selections' => 'Nie wybrałeś żadnych opcji zabezpieczeń.',
        'who_can_see_heading' => 'Kto może to zobaczyć',
        'who_can_see_body' => 'Tylko koordynatorzy społeczności i administratorzy mogą zobaczyć te preferencje. Inni członkowie nie mogą. Każdy dostęp jest rejestrowany.',
        'what_activates_heading' => 'Co w rezultacie się aktywuje',
        'activation_broker_review' => 'Koordynator sprawdzi i zatwierdzi zabezpieczone dopasowania lub wymiany, jeśli będą tego wymagać wybrane przez Ciebie preferencje. Nie daje im to dostępu do treści wiadomości.',
        'activation_match_approval' => 'Koordynator zatwierdzi mecze z Twoim udziałem, zanim zostaną zasugerowane innemu członkowi.',
        'activation_discovery_hidden' => 'Będziesz ukryty przed odkryciem dla członków, którzy nie przeszli wymaganej weryfikacji.',
        'activation_notification' => 'Koordynator został powiadomiony i skontaktuje się z Tobą, aby omówić, w jaki sposób możemy pomóc.',
        'activation_none' => 'Po wybraniu tych opcji nie zostaną aktywowane żadne automatyczne zabezpieczenia. Twoje preferencje są rejestrowane i udostępniane koordynatorowi.',
        'revoke_heading' => 'Jak je zmienić lub odwołać w dowolnym momencie',
        'revoke_body' => 'Możesz sprawdzić lub odwołać dowolne z tych preferencji w dowolnym momencie w ustawieniach swojego profilu. Nie musisz prosić o to administratora.',
        'revoke_cta' => 'Przejdź do ustawień zabezpieczeń',
        'continue_cta' => 'Kontynuować',
    ],
    'settings' => [
        'page_title' => 'Ochrona preferencji',
        'intro' => 'Przejrzyj lub odwołaj preferencje dotyczące zabezpieczeń ustawione podczas wdrażania. Twoi koordynatorzy mogą je zobaczyć, ale inni członkowie nie.',
        'no_preferences' => 'Nie masz aktywnych preferencji dotyczących zabezpieczeń. Możesz je ustawić w dowolnym momencie na stronie pomocy dotyczącej zabezpieczeń.',
        'selected_on' => 'Wybrano w dniu :date',
        'revoke_button' => 'Unieważnić',
        'revoke_confirm_title' => 'Cofnąć tę preferencję?',
        'revoke_confirm_body' => 'Ta preferencja nie będzie już mieć zastosowania do Twojego konta. Twoi koordynatorzy zostaną powiadomieni o zmianie.',
        'revoke_confirm_yes' => 'Tak, odwołaj',
        'revoke_confirm_no' => 'Zachowaj to',
        'revoked_toast' => 'Preferencja cofnięta.',
        'revoke_error_toast' => 'Coś poszło nie tak. Spróbuj ponownie.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Ta społeczność poważnie traktuje ochronę osób. Jeśli uważasz się za osobę dorosłą wymagającą szczególnego wsparcia lub potrzebujesz dodatkowej pomocy, poinformuj nas, aby nasi koordynatorzy mogli pomóc Ci bezpiecznie zorganizować wymiany.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Uważam się za osobę dorosłą wymagającą szczególnego wsparcia i mogę potrzebować dodatkowej pomocy w zakresie ochrony',
                    'description' => 'Dzięki temu nasi koordynatorzy dowiedzą się, że możesz potrzebować dodatkowego wsparcia przy organizowaniu wymian. Koordynator skontaktuje się z Tobą, aby omówić, jak możemy pomóc. Te informacje są poufne.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Wolę kontaktować się wyłącznie z członkami, którzy przeszli odpowiednią weryfikację',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Chcę, aby koordynator pomagał mi organizować wymiany zamiast bezpośredniego kontaktu ze mną',
                    'description' => 'Koordynator będzie pośredniczyć we wszystkich kontaktach i pomoże organizować wymiany w Twoim imieniu. Inni członkowie nie będą mogli wysyłać Ci wiadomości bezpośrednio.',
                ],
                'no_home_visits' => [
                    'label' => 'Nie chcę, aby członkowie odwiedzali mój dom bez uzgodnienia z koordynatorem',
                    'description' => 'Wszystkie wizyty domowe będą organizowane przez koordynatora, który zadba o zastosowanie odpowiednich środków ochrony.',
                ],
                'works_with_children' => [
                    'label' => 'Planuję oferować usługi, które mogą obejmować dzieci lub młodzież (poniżej 18 lat)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planuję oferować usługi, które mogą obejmować osoby dorosłe wymagające szczególnego wsparcia',
                ],
                'none_apply' => [
                    'label' => 'Żadna z tych sytuacji mnie nie dotyczy',
                    'description' => 'Zapoznałem lub zapoznałam się z powyższymi opcjami i żadna z nich nie dotyczy mojej sytuacji. Zostanie to odnotowane, aby koordynatorzy wiedzieli, że ten krok został przeze mnie sprawdzony i rozważony.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlandia',
            'vetting_authority' => 'Krajowe Biuro Weryfikacji',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Irlandii oznacza to członków z weryfikacją Garda Vetting. Nasi koordynatorzy zadbają o to, aby dobierano Ci wyłącznie zweryfikowanych członków.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Koordynator (pośrednik) będzie pośredniczyć we wszystkich kontaktach i pomoże organizować wymiany w Twoim imieniu. Inni członkowie nie będą mogli wysyłać Ci wiadomości bezpośrednio.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą wymogi Garda Vetting. W Irlandii niektóre działania z udziałem dzieci wymagają weryfikacji na mocy ustawy National Vetting Bureau Act z 2012 roku.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator może omówić z Tobą wymogi Garda Vetting. Działania z udziałem osób dorosłych wymagających szczególnego wsparcia mogą wymagać weryfikacji.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Zjednoczone Królestwo',
            'vetting_authority' => 'DBS, Disclosure Scotland i AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W całej Wielkiej Brytanii koordynatorzy potwierdzają odpowiednią podstawę wzmocnionego DBS, PVG i/lub AccessNI w celu zapewnienia bezpiecznego kontaktu.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator oceni rolę i obowiązującą jurysdykcję Wielkiej Brytanii przed podjęciem decyzji, która kontrola zabezpieczeń jest właściwa z prawnego punktu widzenia.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator oceni rolę, zaangażowane osoby dorosłe i obowiązującą jurysdykcję brytyjską, zanim podejmie decyzję, która kontrola bezpieczeństwa jest właściwa z prawnego punktu widzenia.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Anglia i Walia',
            'vetting_authority' => 'Służba ujawniania informacji i zakazów',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Anglii i Walii oznacza to członków ze sprawdzeniem DBS. Nasi koordynatorzy zadbają o to, aby dobierano Ci wyłącznie zweryfikowanych członków.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą wymogi sprawdzenia DBS.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Szkocja',
            'vetting_authority' => 'Disclosure Scotland (program PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Uważam się za osobę dorosłą wymagającą szczególnego wsparcia lub ochrony i mogę potrzebować dodatkowej pomocy w zakresie ochrony',
                ],
                'requires_vetted_partners' => [
                    'description' => 'W Szkocji oznacza to członków programu PVG. Nasi koordynatorzy zadbają o to, aby dobierano Ci wyłącznie zweryfikowanych członków.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą członkostwo w programie PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planuję oferować usługi, które mogą obejmować chronione osoby dorosłe',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlandia Północna',
            'vetting_authority' => 'DostępNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Irlandii Północnej oznacza to członków ze sprawdzeniem AccessNI. Nasi koordynatorzy zadbają o to, aby dobierano Ci wyłącznie zweryfikowanych członków.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą sprawdzenie AccessNI.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Niestandardowe',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'Twoja społeczność zmieniła jurysdykcję ochronną. Twoja istniejąca ochrona pozostaje aktywna, ale sprawdź zaktualizowaną treść w Ustawieniach.',
        'jurisdiction_changed_staff' => 'Zmieniła się jurysdykcja zabezpieczająca. Zabezpieczenia członków, których to dotyczy, pozostają aktywne i wymagają teraz sprawdzenia przez członków.',
        'attestation_policy_rotated_member' => 'Twoja społeczność rozpoczęła przegląd zasad dotyczących zabezpieczeń. Twój broker musi ponownie potwierdzić Twój status kontaktu prywatnego; nie jest to wygaśnięcie certyfikatu.',
        'reminder_subject' => 'Proszę sprawdzić swoje preferencje dotyczące zabezpieczeń',
        'reminder_title' => 'Czas sprawdzić swoje preferencje dotyczące zabezpieczeń',
        'reminder_body' => 'Minął ponad rok, odkąd ustawiłeś preferencje zabezpieczeń dla :community. Poświęć chwilę na ich przejrzenie i potwierdzenie, że nadal obowiązują, lub unieważnij te, które już nie obowiązują.',
        'reminder_cta' => 'Przejrzyj preferencje',
        'escalation_subject' => 'Zaległa kontrola dotycząca zabezpieczenia członka',
        'escalation_title' => 'Zaległy roczny przegląd zabezpieczeń',
        'escalation_body' => 'Firma :name nie odpowiedziała na prośbę o sprawdzenie swoich preferencji dotyczących zabezpieczeń w ciągu 30 dni. Ich preferencje pozostają aktywne – członek ma prawo je zachować. Jeśli chcesz się zameldować, skontaktuj się bezpośrednio.',
        'escalation_cta' => 'Wyświetl członka w panelu zabezpieczającym',
    ],
];
