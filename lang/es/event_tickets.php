<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

return [
    'title' => 'Entradas para eventos',
    'intro' => 'Revisa los tipos de entradas disponibles, reclama plazas gratuitas y gestiona tus propias entradas gratuitas confirmadas.',
    'load_error' => 'No se pudo cargar el catálogo de entradas del evento.',
    'validation_error' => 'Verifique los detalles del boleto e inténtelo nuevamente.',
    'allocate_error' => 'No se pudo asignar el billete gratuito. Verifique su registro, elegibilidad y la asignación restante.',
    'cancel_error' => 'El billete gratuito no se pudo cancelar. Actualiza el catálogo y vuelve a intentarlo.',
    'allocated' => 'Su entrada gratuita ha sido asignada.',
    'cancelled' => 'Su billete gratuito ha sido cancelado y devuelto a la asignación.',
    'back_to_event' => 'Volver al evento',
    'back_to_tickets' => 'Volver a entradas para eventos',
    'gateway_disabled' => 'El pago pago y con crédito por tiempo no está disponible. Esta página nunca cobra dinero ni créditos de tiempo y no cambia tu billetera.',
    'my_tickets' => 'Mis entradas',
    'no_tickets' => 'No tienes entrada para este evento.',
    'ticket_fallback' => 'Entrada para el evento',
    'units' => 'Cantidad',
    'status_label' => 'Estado',
    'status' => [
        'confirmed' => 'Confirmado',
        'cancelled' => 'Cancelado',
    ],
    'cancel_ticket' => 'Cancelar billete',
    'time_credit_cancel_disabled' => 'La cancelación de boletos con crédito de tiempo no está disponible en este flujo de trabajo gratuito. No se ha tomado ninguna medida en la billetera.',
    'catalogue' => 'Entradas disponibles',
    'catalogue_empty' => 'No hay tipos de entradas disponibles para este evento.',
    'kind' => [
        'free' => 'Gratis',
        'time_credit' => 'créditos de tiempo',
    ],
    'remaining' => 'Asignación restante',
    'member_limit' => 'Límite por miembro',
    'time_credit_disabled' => 'Este tipo cuesta :credits créditos de tiempo, pero el pago se desactiva hasta que se conecta la puerta de enlace de billetera aprobada. No se debitarán créditos.',
    'units_to_claim' => 'Número de entradas gratis',
    'reconcile' => 'Ejecutar conciliación',
    'reconciliation_clear' => 'Conciliación del inventario de tickets y de los registros del libro mayor.',
    'reconciliation_warnings' => '{1} :count advertencia de conciliación|[2,*] :count advertencias de conciliación',
    'reconciliation_error' => 'No se pudo completar la conciliación del ticket.',
    'units_hint' => 'Puede reclamar hasta :count en esta asignación.',
    'claim_free' => 'Reclamar billete gratis',
    'registration_required' => 'Necesita un registro confirmado del evento antes de poder reclamar una entrada gratuita.',
    'not_eligible' => 'Actualmente no cumples con las reglas de elegibilidad de este tipo de boleto.',
    'sales_closed' => 'Este tipo de entrada no está actualmente abierta para asignación.',
    'sold_out' => 'No quedan entradas gratuitas para usted en esta asignación.',
    'cancel_title' => '¿Cancelar este boleto gratis?',
    'cancel_intro' => 'Dígale al organizador por qué cancela. La cantidad será devuelta a la asignación gratuita.',
    'cancel_free_only' => 'Esta acción cancela únicamente un derecho gratuito. No emite un reembolso ni cambia el saldo de la billetera.',
    'reason_label' => 'Motivo de la cancelación',
    'reason_hint' => 'No incluya información privada o sensible. Máximo 500 caracteres.',
    'confirm_cancel' => 'Cancelar billete gratis',
];
