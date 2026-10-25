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
        'contact_restricted' => 'Z tym członkiem można się skontaktować wyłącznie za pośrednictwem koordynatora. Nic nie zostało wysłane. Możesz poprosić koordynatora o skontaktowanie się z Tobą.',
        'contact_restricted_title' => 'Kontakt poprzez koordynatora',
        'contact_restricted_detail' => 'Kontakt z tym członkiem odbywa się za pośrednictwem koordynatora. Możesz poprosić koordynatora o skontaktowanie się z Tobą.',
        'contact_via_coordinator' => 'Ze względu na dokonany wybór dotyczący bezpieczeństwa możesz kontaktować się wyłącznie z koordynatorami i członkami, których weryfikacja została zarejestrowana przez tę społeczność. Nic nie zostało wysłane. Koordynator może pomóc w nawiązaniu kontaktu.',
        'contact_via_coordinator_title' => 'Możesz skontaktować się z koordynatorami i zweryfikowanymi członkami',
        'contact_via_coordinator_detail' => 'Ze względu na dokonany wybór dotyczący bezpieczeństwa możesz skontaktować się z koordynatorami i członkami, których weryfikacja została zarejestrowana przez tę społeczność. Zapytaj koordynatora, czy chcesz pomóc w skontaktowaniu się z tym członkiem.',
        'contact_restricted_action' => 'Otworz pomoc',
        'coordination_not_required' => 'Bezpośredni kontakt z tym członkiem jest obecnie dostępny — nie potrzebujesz koordynatora, aby go nawiązać. Odśwież stronę i spróbuj ponownie wysłać wiadomość.',
        'coordination_request_failed' => 'Nie udało się wysłać Twojej prośby do koordynatora. Spróbuj ponownie za chwilę.',
        'vetting_check_failed' => 'Nie udało się potwierdzić Twojego statusu weryfikacji w tej chwili. Spróbuj ponownie za chwilę.',
        'policy_unavailable' => 'Nie możemy teraz potwierdzić polityki ochrony społeczności. Żadna wiadomość nie została wysłana. Spróbuj ponownie wkrótce.',
        'blocked_interaction' => 'Nie możesz wchodzić w interakcje z tym członkiem.',
        'interaction_not_allowed' => 'Polityka ochrony społeczności odbiorcy nie pozwala na tę bezpośrednią interakcję. Poproś koordynatora o pomoc.',
        'policy_unavailable_title' => 'Kontrola zabezpieczająca chwilowo niedostępna',
        'policy_unavailable_detail' => 'Projekt NEXUS nie mógł bezpiecznie ocenić zasad kontaktu, więc ta interakcja została wstrzymana.',
        'policy_unavailable_action' => 'Sprawdź ponownie',
        'listing_role_confirmation_required' => 'Ta aukcja wymaga osobnej, potwierdzonej przez społeczność decyzji Enhanced DBS dla tej roli. Potwierdzenie kontaktu przez komunikator nie spełnia wymagań dotyczących zabezpieczeń związanych z daną rolą.',
        'listing_role_feature_unavailable' => 'W tym miejscu nie można jeszcze włączyć sprawdzania rejestrów karnych dla poszczególnych ról. Potwierdzenie kontaktu przez komunikator celowo nie jest ponownie wykorzystywane do potwierdzenia roli.',
        'compliance_policy_unavailable' => 'W tej chwili nie możemy bezpiecznie potwierdzić wymagań dotyczących zabezpieczeń dla tego wpisu. Spróbuj ponownie później lub skontaktuj się ze swoim brokerem.',
        'statement_required' => 'Zanim będziesz mógł zadeklarować, że ta społeczność pracuje z dziećmi lub bezbronnymi dorosłymi, wymagany jest plik PDF z Oświadczeniem o ochronie dzieci. Prześlij jeden, aby kontynuować.',
        'invalid_file' => 'Nie można odczytać przesłanego pliku. Spróbuj ponownie, korzystając z prawidłowego pliku PDF.',
        'pdf_required' => 'Oświadczenie zabezpieczające musi mieć formę pliku PDF.',
        'file_too_large' => 'Plik oświadczenia zabezpieczającego jest za duży. Maksymalny rozmiar to 10MB.',
        'storage_failed' => 'Nie udało się zapisać przesłanego pliku. Spróbuj ponownie.',
        'statement_missing' => 'W aktach tej społeczności nie ma żadnego oświadczenia zabezpieczającego.',
        'file_missing' => 'Nie można znaleźć pliku instrukcji zabezpieczającej na serwerze. Prześlij go ponownie.',
        'revoke_failed' => 'Nie mogliśmy odwołać tej preferencji. Być może zostało już cofnięte.',
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
        'united_kingdom' => 'Zjednoczone Królestwo — krajowy pakiet zasad',
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
        'activation_discovery_hidden' => 'Członkowie bez weryfikacji zarejestrowanej przez tę społeczność nie mogą wysyłać Ci wiadomości, odpowiadać na Twoje wiadomości, wysyłać Ci kredytów czasowych ani rozpoczynać z Tobą wymiany.',
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
        'switch_heading' => 'Dostępna jest delikatniejsza opcja',
        'switch_body' => 'Wybrałeś opcję, aby kontaktowali się z Tobą wyłącznie członkowie, których weryfikacja została zarejestrowana w tej społeczności. To powstrzymuje prawie wszystkich przed dotarciem do Ciebie. Możesz przełączyć się na koordynatora, który będzie nadzorował Twoją wymianę zdań i zamiast tego przedstawiał Cię członkom, a inni członkowie będą mogli ponownie wysyłać do Ciebie wiadomości.',
        'switch_button' => 'Przejdź do przedstawiania koordynatorów',
        'switched_toast' => 'Zrobione. Koordynator będzie obserwował Twoje wymiany, a członkowie będą mogli ponownie wysyłać Ci wiadomości.',
        'switch_not_held' => 'Nie masz ustawienia tylko dla zweryfikowanych członków, więc nie ma czego zmieniać.',
        'switch_unavailable' => 'Przedstawienia koordynatorów nie są jeszcze dostępne w tej społeczności. Prosimy o kontakt z koordynatorem.',
    ],
    'effects' => [
        'broker_approval' => 'Koordynator przygląda się każdej zorganizowanej przez Ciebie wymianie, zanim ona się rozpocznie. Nie mogą czytać Twoich wiadomości.',
        'restricts_messaging' => 'Inni członkowie nie mogą wysyłać Ci wiadomości, rozpoczynać z Tobą rozmów ani wspominać o Tobie. Koordynatorzy zawsze mogą się z Tobą skontaktować, a Ty możesz skontaktować się z nimi. Grupy, do których należysz, działają normalnie.',
        'restricts_matching' => 'Sugerowane dopasowania między Tobą a innymi członkami są najpierw sprawdzane przez koordynatora.',
        'vetted_only' => 'Tylko koordynatorzy i członkowie, których :vetting zarejestrowała ta społeczność, mogą wysyłać Ci wiadomości, odpowiadać, wysyłać Ci kredyty czasowe lub rozpoczynać z Tobą wymianę zdań. Tylko z nimi możesz się kontaktować. Wszyscy inni są zablokowani. Grupy, do których należysz, działają normalnie.',
        'vetted_count' => '{0} W tej chwili żaden członek nie zarejestrował tutaj :vetting, więc na razie mogą się z Tobą skontaktować tylko koordynatorzy.|{1} W tej chwili tylko 1 członek zarejestrował tutaj :vetting.|[2,*] :count członków zarejestrowało tutaj w tej chwili :vetting.',
        'notify_coordinator' => 'Koordynator zostaje poinformowany o Twoim wyborze, więc może się z Tobą skontaktować, jeśli będziesz czegoś potrzebować.',
        'no_home_visits' => 'Koordynatorzy wiedzą, że nie chcesz wizyt domowych, chyba że je zorganizują.',
        'check_before_helping' => 'Koordynator zostaje o tym poinformowany i potwierdzi, czy konieczna jest weryfikacja (:vetting). Dopóki tego nie zrobią, proszę nie organizować pomocy z udziałem dzieci lub bezbronnych dorosłych za pośrednictwem banku czasu.',
        'informational' => 'Dla pozostałych członków nic się nie zmienia. Twoja odpowiedź pomoże koordynatorom udzielić Ci wsparcia.',
        'declined' => 'Nic się nie zmienia. Koordynatorzy widzą, że zapoznałeś się z tym krokiem.',
        'vetting_fallback' => 'weryfikacja',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Ta społeczność poważnie podchodzi do kwestii ochrony. Jeśli potrzebujesz dodatkowej opieki podczas korzystania z banku czasu, daj nam znać poniżej, a nasi koordynatorzy pomogą. Każdy wybór informuje Cię dokładnie, co robi, zanim go wybierzesz.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Uważam się za bezbronną osobę dorosłą i potrzebuję dodatkowego wsparcia',
                    'description' => 'Aby zapewnić Ci bezpieczeństwo, tylko koordynatorzy i członkowie, których weryfikacja została zarejestrowana przez tę społeczność, będą mogli się z Tobą skontaktować, a Ty będziesz mógł kontaktować się tylko z nimi. Koordynator skontaktuje się z Tobą.',
                ],
                'coordinator_introductions' => [
                    'label' => 'Chciałbym, aby koordynator obserwował moje wymiany i pomagał przedstawiać mnie członkom',
                    'description' => 'Dobrze, jeśli chcesz uzyskać pewność, nie będąc odciętym. Inni członkowie nadal mogą wysyłać do Ciebie wiadomości.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Tylko członkowie, których weryfikacja zarejestrowała ta społeczność, mogą się ze mną kontaktować',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Chciałbym, aby koordynator zorganizował dla mnie cały kontakt, zamiast wysyłać mi bezpośrednie wiadomości',
                    'description' => 'Koordynator zorganizuje w Twoim imieniu kontakt i wymianę zdań, a także może zatwierdzić poszczególnych członków do skontaktowania się z Tobą. Inni członkowie nie będą mogli skontaktować się z Tobą bezpośrednio.',
                ],
                'no_home_visits' => [
                    'label' => 'Nie chcę, aby członkowie odwiedzali mój dom, chyba że koordynator to zaaranżował',
                    'description' => 'Koordynatorzy zostają o tym poinformowani, aby mogli pomóc w zorganizowaniu wizyty w Twoim domu i upewnić się, że zastosowano odpowiednie zabezpieczenia.',
                ],
                'works_with_children' => [
                    'label' => 'Planuję oferować usługi, które mogą obejmować dzieci lub młodzież (poniżej 18 lat)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planuję zaoferować pomoc obejmującą dzieci lub bezbronnych dorosłych (na przykład korepetycje dla dziecka członka lub opieka osobista)',
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
                    'description' => 'W Irlandii Garda Vetting jest organizowana przez organizację odpowiedzialną za określoną rolę. Liczy się tylko weryfikacja zarejestrowana przez tę społeczność, a nie sprawdzanie, czy ktoś to zrobił na podstawie swojej pracy lub innej grupy.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Koordynator zorganizuje w Twoim imieniu kontakt i wymianę zdań, a także może zatwierdzić poszczególnych członków do skontaktowania się z Tobą. Inni członkowie nie będą mogli skontaktować się z Tobą bezpośrednio.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą wymogi Garda Vetting. W Irlandii niektóre działania z udziałem dzieci wymagają weryfikacji na mocy ustawy National Vetting Bureau Act z 2012 roku.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator zostanie o tym poinformowany. W Irlandii do regularnej pracy z dziećmi lub osobami bezbronnymi konieczna jest weryfikacja Garda Vetting, którą może zorganizować wyłącznie zarejestrowana organizacja, a nauczanie, coaching lub mentoring dzieci zawsze to robi. Prosimy nie organizować tego rodzaju pomocy poprzez bank czasu, dopóki koordynator nie potwierdzi, co jest potrzebne.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Zjednoczone Królestwo',
            'vetting_authority' => 'DBS, Disclosure Scotland i AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Wielkiej Brytanii oznacza to kontrolę Enhanced DBS, PVG lub AccessNI zarejestrowaną przez tę społeczność. Czek, który ktoś posiada poprzez swoją pracę lub inną grupę, nie liczy się tutaj.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator oceni rolę i obowiązującą jurysdykcję Wielkiej Brytanii przed podjęciem decyzji, która kontrola zabezpieczeń jest właściwa z prawnego punktu widzenia.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator zostanie o tym poinformowany i potwierdzi, czy do tego, co planujesz, konieczna jest kontrola Enhanced DBS, PVG lub AccessNI. Proszę nie organizować tego rodzaju pomocy poprzez bank czasu, dopóki oni tego nie zrobią.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Anglia i Walia',
            'vetting_authority' => 'Służba ujawniania informacji i zakazów',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Anglii i Walii oznacza to kontrolę Enhanced DBS zarejestrowaną przez tę społeczność. Nie liczy się tutaj czek, który ktoś posiada poprzez swoją pracę lub inną grupę.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą wymogi sprawdzenia DBS.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator zostanie o tym poinformowany i potwierdzi, czy w związku z Twoim planem konieczna jest kontrola DBS. Proszę nie organizować tego rodzaju pomocy poprzez bank czasu, dopóki oni tego nie zrobią.',
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
                    'description' => 'W Szkocji oznacza to członkostwo w programie PVG odnotowane przez tę społeczność. Członkostwo, które ktoś posiada poprzez swoją pracę lub inną grupę, nie liczy się tutaj.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą członkostwo w programie PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planuję zaoferować pomoc obejmującą dzieci lub dorosłych objętych ochroną (na przykład korepetycje dla dziecka członka lub opieka osobista)',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlandia Północna',
            'vetting_authority' => 'DostępNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'W Irlandii Północnej oznacza to sprawdzenie AccessNI zarejestrowane przez tę społeczność. Czek, który ktoś posiada poprzez swoją pracę lub inną grupę, nie liczy się tutaj.',
                ],
                'works_with_children' => [
                    'description' => 'Koordynator może omówić z Tobą sprawdzenie AccessNI.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Koordynator zostanie o tym poinformowany i potwierdzi, czy w związku z Twoim planem konieczna jest kontrola AccessNI. Proszę nie organizować tego rodzaju pomocy poprzez bank czasu, dopóki oni tego nie zrobią.',
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
