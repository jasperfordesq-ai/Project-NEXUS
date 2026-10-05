<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Scegli uno dei cinque tipi di scambio di gruppo.',
        'no_givers' => 'Aggiungi almeno una persona che dà tempo.',
        'no_receivers' => 'Aggiungi almeno una persona che riceve tempo.',
        'hours_missing' => 'Indica per ogni persona un numero di ore maggiore di zero.',
        'earned_exceeds_paid' => 'Le persone che danno tempo guadagnerebbero :earned ore, ma chi partecipa pagherebbe solo :paid. In un laboratorio o in un corso, ogni partecipante paga il tempo che riceve, quindi deve pagare almeno quanto viene guadagnato. Se più persone danno il loro tempo a una sola persona, scegli invece «Una squadra aiuta qualcuno».',
        'unbalanced' => 'Le ore guadagnate (:earned) devono essere uguali alle ore pagate (:paid). Modifica alcuni numeri perché coincidano.',
    ],
    'ledger' => [
        'to_fund' => 'Scambio di gruppo «:title» — ore avanzate al Fondo Comunitario',
    ],
    'fund' => [
        'description' => 'Ore avanzate dallo scambio di gruppo «:title»',
    ],
];
