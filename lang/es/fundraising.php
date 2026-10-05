<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'No se ha encontrado esa campaña de recaudación.',
    'organisation_locked' => 'Esta campaña ya ha recibido donaciones, por lo que ya no se puede cambiar la organización para la que recauda.',
    'organisation_not_eligible' => 'Solo las organizaciones aprobadas pueden llevar a cabo campañas de recaudación.',
    'not_your_campaign' => 'Solo puede gestionar las campañas de su propia organización.',
    'handover_not_found' => 'No se ha encontrado esa entrega.',
    'handover_amount_positive' => 'Introduzca un importe mayor que cero.',
    'handover_exceeds_held' => 'Eso es más de lo que esta campaña aún conserva (:held).',
    'handover_method_invalid' => 'Elija cómo se entregó el dinero.',
    'handover_reference_required' => 'Introduzca una referencia de pago para que se pueda rastrear la transferencia.',
    'handover_date_invalid' => 'Introduzca la fecha en que se entregó el dinero. No puede ser una fecha futura.',
    'handover_campaign_has_no_organisation' => 'Esta campaña es para toda la comunidad, así que no hay ninguna organización a la que entregar el dinero.',
    'handover_already_closed' => 'Esta entrega ya se ha confirmado o cancelado.',
    'cancel_reason_required' => 'Indique el motivo para cancelar esta entrega.',
    'email' => [
        'handover_subject' => ':community ha entregado :amount de :campaign',
        'handover_title' => 'Dinero entregado a :organisation',
        'handover_body' => ':community ha registrado la entrega de :amount recaudados por la campaña «:campaign» el :date (referencia :reference). Compruebe que ha llegado y confírmelo en el panel de su organización.',
        'handover_cta' => 'Confirmar recepción',
        'handover_bell' => ':community ha entregado :amount de :campaign. Confirme que lo ha recibido.',
    ],
];
