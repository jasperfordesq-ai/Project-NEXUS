<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'form' => [
        'title' => 'Accesibilidad del lugar',
        'hint' => 'Indica qué ofrece el lugar. Elige «No se sabe» si la organización no ha verificado una característica; no significa lo mismo que «No».',
        'parking_details' => 'Aparcamiento y llegada',
        'parking_details_hint' => 'Describe las plazas accesibles, los puntos de bajada y la ruta hasta la entrada.',
        'transit_details' => 'Transporte público',
        'transit_details_hint' => 'Describe las paradas o estaciones cercanas y cualquier barrera en el recorrido.',
        'assistance_contact' => 'Contacto para asistencia de accesibilidad',
        'assistance_contact_hint' => 'Indica un contacto público para consultas de acceso. No incluyas datos privados de asistentes.',
        'notes' => 'Información de acceso adicional',
        'notes_hint' => 'Incluye datos útiles sobre la entrada, el ascensor, el suelo, la iluminación o el entorno sensorial.',
        'privacy_note' => 'Esta información se muestra a los miembros del evento. Las adaptaciones privadas deben solicitarse en el formulario de inscripción.',
    ],
    'features' => [
        'step_free_access' => 'Acceso sin escalones',
        'accessible_toilet' => 'Aseo accesible',
        'hearing_loop' => 'Bucle de inducción',
        'quiet_space' => 'Espacio tranquilo',
        'seating_available' => 'Asientos disponibles',
        'accessible_parking' => 'Aparcamiento accesible',
    ],
    'status' => [
        'yes' => 'Sí',
        'no' => 'No',
        'unknown' => 'No se sabe',
    ],
    'filters' => [
        'step_free_label' => 'Acceso sin escalones del lugar',
        'step_free_hint' => 'Filtra según la información de acceso confirmada por la organización.',
        'step_free_options' => [
            'any' => 'Cualquier lugar',
            'yes' => 'Acceso sin escalones confirmado',
            'no' => 'No tiene acceso sin escalones',
            'unknown' => 'Acceso sin escalones desconocido',
        ],
        'step_free_active' => 'Acceso sin escalones: :value',
    ],
    'detail' => [
        'title' => 'Accesibilidad del lugar',
        'intro' => 'Información de acceso facilitada por la organización. Contacta con ella si necesitas confirmar alguna medida.',
        'features_label' => 'Características de accesibilidad del lugar',
        'parking_details' => 'Aparcamiento y llegada',
        'transit_details' => 'Transporte público',
        'assistance_contact' => 'Asistencia de accesibilidad',
        'notes' => 'Información de acceso adicional',
    ],
];
