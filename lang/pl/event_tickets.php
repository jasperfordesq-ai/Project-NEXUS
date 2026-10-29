<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Bilety na wydarzenie',
    'intro' => 'Przeglądaj dostępne rodzaje biletów, ubiegaj się o bezpłatne miejsca i zarządzaj własnymi potwierdzonymi bezpłatnymi biletami.',
    'load_error' => 'Nie można załadować katalogu biletów na wydarzenie.',
    'validation_error' => 'Sprawdź szczegóły biletu i spróbuj ponownie.',
    'allocate_error' => 'Nie udało się przydzielić bezpłatnego biletu. Sprawdź swoją rejestrację, uprawnienia i pozostały przydział.',
    'cancel_error' => 'Nie można anulować bezpłatnego biletu. Odśwież katalog i spróbuj ponownie.',
    'allocated' => 'Twój bezpłatny bilet został przydzielony.',
    'cancelled' => 'Twój bezpłatny bilet został anulowany i zwrócony do przydziału.',
    'back_to_event' => 'Powrót do wydarzenia',
    'back_to_tickets' => 'Wracając do biletów na wydarzenia',
    'gateway_disabled' => 'Płatne i czasowe rozliczenie kredytowe nie jest dostępne. Ta strona nigdy nie pobiera opłat ani kredytów czasowych i nie powoduje zmian w Twoim portfelu.',
    'my_tickets' => 'Moje bilety',
    'no_tickets' => 'Nie masz biletu na to wydarzenie.',
    'ticket_fallback' => 'Bilet na wydarzenie',
    'units' => 'Ilość',
    'status_label' => 'Stan',
    'status' => [
        'confirmed' => 'Potwierdzone',
        'cancelled' => 'Anulowano',
    ],
    'cancel_ticket' => 'Anuluj bilet',
    'time_credit_cancel_disabled' => 'Anulowanie biletu z kredytem czasowym nie jest dostępne w tym bezpłatnym przepływie pracy. Nie podjęto żadnych działań w portfelu.',
    'catalogue' => 'Dostępne bilety',
    'catalogue_empty' => 'Na to wydarzenie nie są dostępne żadne rodzaje biletów.',
    'kind' => [
        'free' => 'Bezpłatny',
        'time_credit' => 'Kredyty czasowe',
    ],
    'remaining' => 'Pozostały przydział',
    'member_limit' => 'Limit na członka',
    'time_credit_disabled' => 'Ten typ kosztuje :credits kredytów czasowych, ale realizacja transakcji jest wyłączona do czasu podłączenia zatwierdzonej bramy portfela. Żadne kredyty nie zostaną pobrane.',
    'units_to_claim' => 'Liczba bezpłatnych biletów',
    'reconcile' => 'Prowadź pojednanie',
    'reconciliation_clear' => 'Inwentarz biletów i zapisy księgi są zgodne.',
    'reconciliation_warnings' => '{1} :count ostrzeżenie dotyczące uzgodnienia|[2,*] :count ostrzeżenia dotyczące uzgodnienia',
    'reconciliation_error' => 'Nie można ukończyć uzgadniania biletów.',
    'units_hint' => 'W tej alokacji możesz ubiegać się o maksymalnie :count.',
    'claim_free' => 'Odbierz darmowy bilet',
    'registration_required' => 'Zanim będziesz mógł ubiegać się o bezpłatny bilet, potrzebujesz potwierdzonej rejestracji na wydarzenie.',
    'not_eligible' => 'Obecnie nie spełniasz zasad kwalifikowalności tego typu biletu.',
    'sales_closed' => 'Ten typ biletu nie jest aktualnie dostępny do przydziału.',
    'sold_out' => 'W tym przydziale nie pozostały już dla Ciebie żadne bezpłatne bilety.',
    'cancel_title' => 'Anulować ten bezpłatny bilet?',
    'cancel_intro' => 'Powiedz organizatorowi, dlaczego odwołujesz wydarzenie. Ilość zostanie zwrócona do bezpłatnego przydziału.',
    'cancel_free_only' => 'Ta czynność anuluje wyłącznie bezpłatne uprawnienie. Nie powoduje zwrotu pieniędzy ani zmiany salda portfela.',
    'reason_label' => 'Powód anulowania',
    'reason_hint' => 'Nie podawaj informacji prywatnych ani wrażliwych. Maksymalnie 500 znaków.',
    'confirm_cancel' => 'Anuluj bezpłatny bilet',
];
