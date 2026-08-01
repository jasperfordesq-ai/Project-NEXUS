<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'index' => [
        'title' => 'Lugares asociados',
        'intro' => 'Lugares locales que aceptan su pase de miembro. Cualquier oferta mostrada está gestionada por el propio recinto.',
        'my_pass' => 'mostrar mi pase',
        'empty' => 'Aún no se han agregado lugares asociados.',
        'website' => 'Visitar sitio web (abre el sitio propio del lugar)',
        'how_it_works' => 'Muestra tu pase en la caja. Un miembro del personal lo escanea con su teléfono para registrar su visita; no se cobra nada y no hay detalles de pago involucrados.',
    ],
    'pass' => [
        'title' => 'mi pase de lugar',
        'back' => 'Volver a lugares asociados',
        'intro' => 'Muestra este código en un lugar asociado. El personal lo escanea con la cámara de su teléfono para registrar su visita.',
        'qr_alt' => 'Su código QR de pase personal para el lugar',
        'privacy' => 'Su pase lo identifica únicamente ante el personal del lugar registrado en esta comunidad. No es una tarjeta de pago y no contiene dinero.',
        'rotate_hint' => 'Si es posible que alguien haya fotografiado su código, obtenga uno nuevo: el código anterior deja de funcionar inmediatamente.',
        'rotate_button' => 'Obtener un nuevo código',
        'rotated_notice' => 'Tu pase tiene un nuevo código. El código anterior ya no funciona.',
        'visits_title' => 'Tus visitas grabadas',
        'visits_empty' => 'Aún no se han registrado visitas.',
    ],
    'checkin' => [
        'title' => 'Registrar la visita de un miembro',
        'intro' => 'Estás a punto de grabar la visita de un miembro a tu lugar. Aún no se ha registrado nada; confírmelo a continuación.',
        'confirm' => 'Graba esta visita',
        'choose_venue' => '¿A qué lugar es esta visita?',
        'recorded' => 'Visita registrada para :member en :venue.',
        'already_recorded' => 'Hoy ya se registró una visita de :member.',
        'visits_this_month' => 'Visitas este mes: :count',
        'challenge_completed' => 'Desafío completado: :title',
        'done' => 'Hecho',
        'forbidden_title' => 'No puedes registrar visitas',
        'forbidden_body' => 'Sólo el personal de un lugar asociado puede registrar las visitas y el personal no puede registrar su propia visita. Pídele a un administrador de la comunidad que te agregue al personal del lugar.',
        'invalid_title' => 'Este pase no es válido',
        'invalid_body' => 'El pase escaneado no existe o ha sido revocado. Pídale al miembro que abra su pase nuevamente y vuelva a escanearlo.',
    ],
];
