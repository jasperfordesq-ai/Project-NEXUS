<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'El monto de la tarifa debe ser mayor que cero.',
        'invalid_billing_cycle' => 'El ciclo de facturación debe ser uno de: anual, bienal o mensual.',
        'fee_not_configured' => 'No se ha configurado ninguna cuota de membresía activa para este Verein.',
        'organization_not_found' => 'Verein no encontrado.',
        'organization_not_club' => 'Esta organización no es una Verein.',
        'organization_required' => 'Se requiere id_organización.',
        'dues_not_found' => 'No se encontró el registro de cuotas de membresía.',
        'cannot_waive_paid' => 'No se puede renunciar a una fila de cuotas que ya se han pagado.',
        'cannot_remind_status' => 'Sólo se pueden enviar recordatorios de cuotas pendientes o vencidas.',
        'cannot_pay_status' => 'Esta fila de cuotas no se encuentra en estado pagadero.',
        'payment_intent_failed' => 'No se pudo iniciar el proceso de pago. Inténtelo de nuevo más tarde.',
        'waive_reason_required' => 'Se requiere un motivo de renuncia.',
    ],
];
