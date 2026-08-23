<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'manage' => [
        'title' => 'Zarządzaj swoimi środkami',
        'caption' => 'Kredyty czasowe',
        'description' => 'Rzuć okiem na oczekujące środki, wyślij je członkowi lub przekaż darowiznę na fundusz społecznościowy.',
        'back_to_wallet' => 'Wracając do portfela',
    ],
    'balance' => [
        'heading' => 'Twoje saldo',
        'label' => 'Dostępne saldo',
        'pending_badge_in' => '{0} Brak oczekujących kredytów|{1} Oczekujących za: :count godzina|[2,*] Oczekujących za: :count godzin',
        'no_pending' => 'Brak oczekujących kredytów',
    ],
    'stats' => [
        'heading' => 'Streszczenie',
        'earned' => 'Zdobyte',
        'spent' => 'Zużyty',
        'pending' => 'Oczekujące',
        'earned_value' => '+:value godz',
        'spent_value' => '-:value godz',
        'pending_value' => ':value godz',

        'pending_in' => 'Oczekujące — przychodzące',

        'pending_out' => 'Oczekujące — wychodzące',
        'pending_hint' => 'Kredyty przychodzące i wychodzące, które nie zostały jeszcze zakończone.',
    ],
    'hours_value' => ':value godz',
    'member_since' => 'Członek od :date',
    'transfer' => [
        'heading' => 'Wyślij kredyty członkowi',
        'description' => 'Wyszukaj członka według nazwiska, a następnie wybierz liczbę godzin, które chcesz wysłać.',
        'prefill_notice' => 'Odbiorca został wstępnie wybrany z Twojego linku. Sprawdź szczegóły przed wysłaniem.',
        'search_label' => 'Wyszukaj członka',
        'search_hint' => 'Wpisz nazwę i wybierz Szukaj.',
        'search_button' => 'Szukaj',
        'search_empty' => 'Żaden członek nie pasował do Twojego wyszukiwania.',
        'recipient_heading' => 'Pasujący członkowie',
        'amount_label' => 'Kwota w godzinach',
        'amount_hint' => 'Na przykład 1 lub 2,5. Możesz wysłać do 1000 godzin.',
        'note_label' => 'Dodaj notatkę (opcjonalnie)',
        'note_hint' => 'Odbiorca zobaczy to wraz z przelewem.',
        'send_button' => 'Wyślij kredyty do :name',
    ],
    'donate' => [
        'heading' => 'Przekaż kredyty',
        'description' => 'Przekaż część swojego czasu na fundusz społecznościowy lub bezpośrednio innemu członkowi.',
        'credits_not_money' => 'Spowoduje to przekazanie Twoich kredytów czasowych do wspólnej puli społeczności. To nie jest darowizna pieniężna.',
        'warning' => 'Darowizny przenoszą środki w jedną stronę i nie można ich cofnąć.',
        'target_legend' => 'Komu chciałbyś podarować?',
        'target_fund' => 'Fundusz wspólnotowy',
        'target_fund_hint' => 'Wspólna pula, z której może korzystać każdy członek.',
        'target_member' => 'Konkretny członek',
        'target_member_hint' => 'Zanim przekażesz darowiznę, wyszukaj poniżej członka.',
        'fund_balance_label' => 'Saldo funduszu wspólnotowego',
        'fund_donated_label' => 'Łączna suma darowizn od członków',
        'recipient_required' => 'Najpierw wyszukaj i wybierz członka, któremu chcesz przekazać darowiznę.',
        'amount_label' => 'Kwota w godzinach',
        'amount_hint' => 'Tylko całe godziny, do 1000.',
        'message_label' => 'Dodaj wiadomość (opcjonalnie)',
        'message_hint' => 'Krótka notatka, którą należy dołączyć do darowizny.',
        'button_fund' => 'Przekaż darowiznę na fundusz społecznościowy',
        'button_member' => 'Przekaż darowiznę na rzecz :name',
    ],
    'states' => [
        'success_title' => 'Sukces',
        'error_title' => 'Jest problem',
        'warning' => 'Ostrzeżenie',
        'transfer_sent' => 'Twoje kredyty zostały wysłane.',
        'donate_sent' => 'Dziękuję. Twoja darowizna została przekazana.',
    ],
    'errors' => [
        'invalid' => 'Wprowadź prawidłową kwotę i odbiorcę.',
        'insufficient' => 'Nie masz na to wystarczającej liczby kredytów.',
        'not_found' => 'Nie udało się znaleźć tego członka.',
        'self' => 'Nie możesz wysyłać kredytów do siebie.',
        'inactive' => 'Ten członek nie może teraz otrzymać kredytów.',
        'too_large' => 'Kwota ta jest zbyt duża.',
        'decimals' => 'Darowizny muszą obejmować całe godziny.',
        'failed' => 'Coś poszło nie tak. Spróbuj ponownie.',
    ],
    'footer' => [
        'wallet_link' => 'Przeglądaj swój pełny portfel i historię transakcji',
    ],
    'nav' => [
        'manage' => 'Zarządzaj swoimi środkami',
    ],
];
