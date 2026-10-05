<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Elige uno de los cinco tipos de intercambio grupal.',
        'no_givers' => 'Añade al menos una persona que dé tiempo.',
        'no_receivers' => 'Añade al menos una persona que reciba tiempo.',
        'hours_missing' => 'Indica para cada persona un número de horas mayor que cero.',
        'earned_exceeds_paid' => 'Las personas que dan tiempo ganarían :earned horas, pero las que asisten solo pagarían :paid. En un taller o una clase, cada asistente paga el tiempo que recibe, así que deben pagar al menos lo que se gana. Si varias personas dan su tiempo a una sola persona, elige «Un equipo ayuda a alguien».',
        'unbalanced' => 'Las horas ganadas (:earned) deben ser iguales a las horas pagadas (:paid). Cambia algunas cifras para que coincidan.',
    ],
    'ledger' => [
        'to_fund' => 'Intercambio grupal «:title»: horas sobrantes al Fondo Comunitario',
    ],
    'fund' => [
        'description' => 'Horas sobrantes del intercambio grupal «:title»',
    ],
];
