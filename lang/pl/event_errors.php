<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Dane rejestracyjne można przejrzeć pod kątem usunięcia dopiero po zakończeniu wydarzenia. Wybierz datę po zakończeniu wydarzenia.',
        'settings_required' => 'Najpierw zapisz ustawienia rejestracji tego wydarzenia. Określają one, jak długo przechowywane są dane rejestracyjne.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Ten czas wysyłki już minął. Wybierz czas w przyszłości albo wyślij wiadomość teraz.',
        'post_event_too_early' => 'Wiadomość na czas po wydarzeniu można wysłać dopiero po jego zakończeniu. Wybierz czas po zakończeniu wydarzenia.',
        'audience_empty' => 'Nikt nie otrzymałby tej wiadomości. Wybierz grupę odbiorców, która obejmuje co najmniej jedną osobę.',
        'channel_empty' => 'Wybierz co najmniej jeden sposób wysłania tej wiadomości.',
        'body_invalid' => 'Napisz wiadomość o długości nie większej niż :max znaków.',
        'version_conflict' => 'Ta wiadomość została zmieniona w innym miejscu po wczytaniu strony. Odśwież stronę, sprawdź ją i spróbuj ponownie.',
        'transition_invalid' => 'Ta wiadomość jest już na dalszym etapie: może być wysyłana lub już wysłana. Odśwież stronę, aby zobaczyć jej stan.',
        'cancel_after_send_forbidden' => 'Wysyłanie już się rozpoczęło, więc tej wiadomości nie można już anulować.',
        'idempotency_conflict' => 'Wygląda to na powtórzenie wcześniejszej próby z innymi danymi. Odśwież stronę i sprawdź, czy wiadomość już tam jest.',
        'authorization_denied' => 'Nie masz uprawnień do wysyłania wiadomości dotyczących tego wydarzenia. Poproś organizatora o dodanie Cię do zespołu wydarzenia.',
    ],
];
