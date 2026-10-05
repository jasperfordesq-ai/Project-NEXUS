<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'Nie znaleziono tej zbiórki.',
    'organisation_locked' => 'Ta zbiórka otrzymała już darowizny, więc nie można już zmienić organizacji, na rzecz której zbiera pieniądze.',
    'organisation_not_eligible' => 'Zbiórki mogą prowadzić tylko zatwierdzone organizacje.',
    'not_your_campaign' => 'Możesz zarządzać tylko zbiórkami własnej organizacji.',
    'handover_not_found' => 'Nie znaleziono tego przekazania.',
    'handover_amount_positive' => 'Wpisz kwotę większą od zera.',
    'handover_exceeds_held' => 'To więcej, niż ta zbiórka jeszcze przechowuje (:held).',
    'handover_method_invalid' => 'Wybierz, w jaki sposób przekazano pieniądze.',
    'handover_reference_required' => 'Wpisz numer referencyjny płatności, aby można było prześledzić przelew.',
    'handover_date_invalid' => 'Wpisz datę przekazania pieniędzy. Nie może to być data przyszła.',
    'handover_campaign_has_no_organisation' => 'Ta zbiórka jest dla całej społeczności, więc nie ma organizacji, której można przekazać pieniądze.',
    'handover_already_closed' => 'To przekazanie zostało już potwierdzone lub anulowane.',
    'cancel_reason_required' => 'Podaj powód anulowania tego przekazania.',
    'email' => [
        'handover_subject' => ':community przekazała :amount ze zbiórki :campaign',
        'handover_title' => 'Pieniądze przekazane organizacji :organisation',
        'handover_body' => ':community zarejestrowała przekazanie :amount zebranych w zbiórce „:campaign” w dniu :date (numer referencyjny :reference). Sprawdź, czy pieniądze dotarły, i potwierdź to w panelu swojej organizacji.',
        'handover_cta' => 'Potwierdź odbiór',
        'handover_bell' => ':community przekazała :amount ze zbiórki :campaign. Potwierdź, że pieniądze dotarły.',
    ],
];
