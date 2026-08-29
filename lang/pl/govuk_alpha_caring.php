<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => 'Troskliwa społeczność',
        'back_to_caring' => 'Powrót do troskliwej społeczności',
        'back_to_caregiver' => 'Wracając do twoich troskliwych relacji',
        'success_title' => 'Sukces',
        'error_title' => 'Jest problem',
        'unknown_member' => 'Nieznany członek',
        'optional' => '(fakultatywny)',
    ],
    'hub' => [
        'title' => 'Troskliwa społeczność',
        'caption' => 'Opieka i wsparcie',
        'intro' => 'Zorganizuj regularną opiekę dla innego członka lub odpowiedz na prośbę osoby, która poprosiła o opiekę nad tobą.',
        'caregiver_card_title' => 'Twoje troskliwe relacje',
        'caregiver_card_description' => 'Przeglądaj relacje, o które prosiłeś, odpowiadaj na zapytania dotyczące Ciebie i korzystaj z narzędzi, które odblokowuje zatwierdzony związek.',
        'become_title' => 'Zostań opiekunem',
        'become_description' => 'Poproś o zapewnienie regularnej opieki innemu członkowi tej społeczności. Nic nie wchodzi w życie, dopóki nie zgodzą się i personel nie sprawdzi.',
    ],
    'caregiver' => [
        'title' => 'Twoje troskliwe relacje',
        'caption' => 'Troskliwa społeczność',
        'intro' => 'Relacje, o które prosiłeś, i ich obecny etap.',
        'none' => 'Nie poprosiłeś jeszcze o opiekę nad nikim.',
        'become_button' => 'Poproś o opiekę nad kimś',
        'incoming_title' => 'Prośby o Ciebie',
        'incoming_intro' => 'Ci członkowie poprosili o opiekę nad tobą. Zgadzaj się tylko wtedy, gdy rozumiesz i akceptujesz, co to oznacza.',
        'incoming_explanation' => 'Jeśli się zgodzisz, personel sprawdzi Twoją prośbę przed rozpoczęciem relacji. Zgoda nie rozpoczyna tego sama.',
        'incoming_none' => 'Nikt nie prosił o opiekę nad tobą.',
        'confirm_button' => 'Zgadzam się na tę relację',
        'reject_button' => 'Nie zgadzam się',
        'status_heading' => 'Scena',
        'status_pending_recipient' => 'Czekam, aż drugi członek się zgodzi',
        'status_pending_staff' => 'Oczekiwanie na kontrolę bezpieczeństwa personelu',
        'status_active' => 'Zatwierdzone i aktywne',
        'status_rejected' => 'Niezatwierdzone',
        'status_inactive' => 'Zakończone',
        'relationship_heading' => 'Relacja',
        'relationship_family' => 'Rodzina',
        'relationship_friend' => 'Przyjaciel',
        'relationship_neighbour' => 'Sąsiad',
        'relationship_professional' => 'Profesjonalny opiekun',
        'started_heading' => 'Rozpoczęła się pielęgnacja',
        'reason_heading' => 'Powód podany',
        'pending_no_tools' => 'W czasie oczekiwania na prośbę nie masz dostępu do szczegółów opieki nad tym członkiem.',
        'active_tools_title' => 'Na co pozwala Ci ta relacja',
        'request_on_behalf_link' => 'Poproś o pomoc w imieniu tego członka',
    ],
    'link' => [
        'title' => 'Poproś o opiekę nad kimś',
        'caption' => 'Troskliwa społeczność',
        'intro' => 'Poproś o zapewnienie regularnej opieki innemu członkowi tej społeczności.',
        'consent_warning' => 'Wymieniony przez Ciebie członek zostanie zapytany, czy się zgadza. Następnie personel sprawdzi wniosek. Związek nie zaczyna się i nic nie daje, dopóki jedno i drugie się nie wydarzy.',
        'search_label' => 'Znajdź członka, którym chcesz się zaopiekować',
        'search_hint' => 'Wpisz część ich imienia, a następnie wybierz je z wyników.',
        'search_button' => 'Szukaj',
        'results_title' => 'Wybierz członka',
        'results_none' => 'Żaden członek nie pasował do tego imienia. Spróbuj innej pisowni.',
        'choose_button' => 'Wybierać',
        'chosen_label' => 'Członek, którego wybrałeś',
        'change_button' => 'Zmiana',
        'relationship_label' => 'Twój stosunek do nich',
        'start_date_label' => 'Data rozpoczęcia lub rozpoczęcia opieki',
        'start_date_hint' => 'Na przykład 27 3 2026',
        'notes_label' => 'Wszystko, co personel powinien wiedzieć',
        'notes_hint' => 'Fakultatywny. Informacja ta jest pokazywana pracownikowi sprawdzającemu wniosek.',
        'submit_button' => 'Wyślij prośbę',
        'error_no_member' => 'Wybierz członka, którym chcesz się zaopiekować',
        'error_no_relationship' => 'Wybierz swoją relację z nimi',
        'error_no_start_date' => 'Wprowadź datę rozpoczęcia lub rozpoczęcia opieki',
        'error_bad_start_date' => 'Wpisz prawdziwą datę, na przykład 27 3 2026',
        'error_search_too_short' => 'Wpisz co najmniej dwa znaki, aby wyszukać',
    ],
    'on_behalf' => [
        'title' => 'Poproś o pomoc w czyimś imieniu',
        'intro' => 'Poproś społeczność o praktyczną pomoc dla członka, którym się opiekujesz. Prośba jest rejestrowana w ich imieniu i oznacza, że ​​została złożona.',
        'for_member' => 'Ta prośba dotyczy',
        'title_label' => 'Jaka pomoc jest potrzebna',
        'title_hint' => 'Na przykład podwózka na wizytę w szpitalu.',
        'description_label' => 'Więcej szczegółów',
        'when_label' => 'Kiedy jest to potrzebne',
        'contact_label' => 'Jak pomocnicy powinni się kontaktować',
        'contact_phone' => 'Telefonicznie',
        'contact_message' => 'Przez wiadomość',
        'contact_either' => 'Albo jest w porządku',
        'submit_button' => 'Wyślij prośbę',
        'error_no_title' => 'Wpisz jaka pomoc jest potrzebna',
        'error_not_active' => 'Możesz poprosić o pomoc wyłącznie w imieniu członka, którego związek został zatwierdzony',
    ],
    'review' => [
        'title' => 'Opiekun prosi o sprawdzenie',
        'caption' => 'Troskliwa społeczność',
        'intro' => 'Przed zatwierdzeniem relacji opiekuńczej sprawdź, czy beneficjent opieki wyraził zgodę i zapisz, w jaki sposób to zweryfikowałeś.',
        'none' => 'Żadne wnioski opiekunów nie oczekują na sprawdzenie.',
        'requested_by' => 'Na prośbę',
        'requested_for' => 'Opiekować się',
        'requested_on' => 'Zażądano w dniu',
        'recipient_agreed' => 'Członek wyraził zgodę',
        'recipient_not_agreed' => 'Członek jeszcze się nie zgodził',
        'blocked_until_agreed' => 'Nie możesz zatwierdzić tej prośby, dopóki członek nie wyrazi na to zgody.',
        'evidence_label' => 'Jak zweryfikowałeś ich zgodę',
        'evidence_hint' => 'Na przykład rozmowa telefoniczna z samym członkiem w dniu 27 marca 2026 r.',
        'attestation_label' => 'Potwierdzam, że sam zweryfikowałem zgodę tego użytkownika',
        'approve_button' => 'Zatwierdź związek',
        'reject_label' => 'Dlaczego odrzucasz tę prośbę',
        'reject_hint' => 'Jest to nagrywane i pokazywane członkowi, który o to zapytał.',
        'reject_button' => 'Odrzuć prośbę',
        'decided_approved' => 'Zatwierdzony',
        'decided_rejected' => 'Odrzucony',
        'error_no_evidence' => 'Podaj, w jaki sposób zweryfikowałeś ich zgodę',
        'error_no_attestation' => 'Potwierdź, że sam zweryfikowałeś zgodę tego członka',
        'error_no_reason' => 'Wpisz, dlaczego odrzucasz tę prośbę',
    ],
    'status' => [
        'link_requested' => 'Twoja prośba została wysłana. Oczekuje, aż drugi członek wyrazi zgodę, a następnie na sprawdzenie personelu.',
        'link_failed' => 'Twoja prośba nie mogła zostać wysłana.',
        'link_duplicate' => 'Masz już prośbę lub zatwierdzoną relację z tym członkiem.',
        'incoming_confirmed' => 'Zgodziłeś się. Personel sprawdzi teraz prośbę przed rozpoczęciem relacji.',
        'incoming_rejected' => 'Odmówiłeś. Nie utworzono żadnej relacji.',
        'incoming_failed' => 'Nie można zapisać Twojej odpowiedzi.',
        'review_approved' => 'Relacja opiekuńcza została zatwierdzona.',
        'review_rejected' => 'Prośba została odrzucona.',
        'review_not_agreed' => 'Żądanie to nie może zostać przyjęte, ponieważ członek nie wyraził na to zgody.',
        'review_failed' => 'Tej decyzji nie udało się uratować.',
        'review_not_found' => 'Nie udało się znaleźć tej prośby w tej społeczności.',
        'on_behalf_sent' => 'Prośba o pomoc została wysłana.',
        'on_behalf_failed' => 'Nie udało się wysłać prośby o pomoc.',
    ],
];
