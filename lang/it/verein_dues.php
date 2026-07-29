<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'L\'importo della commissione deve essere maggiore di zero.',
        'invalid_billing_cycle' => 'Il ciclo di fatturazione deve essere uno tra: annuale, biennale, mensile.',
        'fee_not_configured' => 'Per questo Verein non è configurata alcuna quota associativa attiva.',
        'organization_not_found' => 'Verein non trovato.',
        'organization_not_club' => 'Questa organizzazione non è un Verein.',
        'organization_required' => 'l\'ID_organizzazione è obbligatorio.',
        'dues_not_found' => 'Registro delle quote associative non trovato.',
        'cannot_waive_paid' => 'Non è possibile rinunciare a una riga di quote già pagate.',
        'cannot_remind_status' => 'I solleciti possono essere inviati solo per quote pendenti o scadute.',
        'cannot_pay_status' => 'Questa riga delle quote non è in stato pagabile.',
        'payment_intent_failed' => 'Impossibile avviare il processo di pagamento. Per favore riprova più tardi.',
        'waive_reason_required' => 'È necessario un motivo di rinuncia.',
    ],
];
