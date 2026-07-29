<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'Kwota opłaty musi być większa od zera.',
        'invalid_billing_cycle' => 'Cykl rozliczeniowy musi być następujący: roczny, dwuletni, miesięczny.',
        'fee_not_configured' => 'Dla tego Verein nie skonfigurowano żadnej aktywnej opłaty członkowskiej.',
        'organization_not_found' => 'Nie znaleziono Vereina.',
        'organization_not_club' => 'Ta organizacja nie jest Verein.',
        'organization_required' => 'identyfikator_organizacji jest wymagany.',
        'dues_not_found' => 'Nie znaleziono rejestru składek członkowskich.',
        'cannot_waive_paid' => 'Nie można odstąpić od już uiszczonej składki.',
        'cannot_remind_status' => 'Przypomnienia mogą być wysyłane wyłącznie w przypadku zaległych lub zaległych płatności.',
        'cannot_pay_status' => 'Ten wiersz należności nie jest w stanie do zapłaty.',
        'payment_intent_failed' => 'Nie można rozpocząć procesu płatności. Spróbuj ponownie później.',
        'waive_reason_required' => 'Wymagany jest powód rezygnacji.',
    ],
];
