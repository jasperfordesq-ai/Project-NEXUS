<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Los datos de inscripción solo se pueden revisar para su eliminación cuando el evento haya terminado. Elige una fecha posterior al final del evento.',
        'settings_required' => 'Guarda primero la configuración de inscripción de este evento. En ella se define cuánto tiempo se conservan los datos de inscripción.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Esa hora de envío ya ha pasado. Elige una hora futura o envía el mensaje ahora.',
        'post_event_too_early' => 'Un mensaje para después del evento solo se puede enviar cuando el evento haya terminado. Elige una hora posterior al final del evento.',
        'audience_empty' => 'Nadie recibiría este mensaje. Elige un público que incluya al menos a una persona.',
        'channel_empty' => 'Elige al menos una forma de enviar este mensaje.',
        'body_invalid' => 'Escribe un mensaje de :max caracteres como máximo.',
        'version_conflict' => 'Este mensaje se cambió en otro lugar después de cargar la página. Actualiza la página, revísalo e inténtalo de nuevo.',
        'transition_invalid' => 'Este mensaje ya ha avanzado: puede que se esté enviando o que ya se haya enviado. Actualiza la página para ver en qué punto está.',
        'cancel_after_send_forbidden' => 'El envío ya ha comenzado, así que este mensaje ya no se puede cancelar.',
        'idempotency_conflict' => 'Parece una repetición de un intento anterior con otros datos. Actualiza la página y comprueba si el mensaje ya está ahí.',
        'authorization_denied' => 'No tienes permiso para enviar mensajes de este evento. Pide a quien organiza el evento que te añada al equipo.',
    ],
];
