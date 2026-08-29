<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — caregiver links, accessible frontend.
 *
 * 🔴 Wording rules that are not stylistic here.
 *
 * A caregiver link is consent-gated authority over another person's care. The
 * copy must never tell anyone the relationship is established before it is:
 * creating a request produces a PENDING record, the care recipient must agree,
 * and staff must separately verify that agreement. The React copy for the same
 * journey was changed away from "Care receiver linked successfully" for exactly
 * this reason, and these strings must not reintroduce it.
 *
 * Read by web-uk through scripts/sync-laravel-locales.php, which globs
 * lang/{locale}/govuk_alpha*.php. Every key added here must exist in all eleven
 * locales, TRANSLATED — the parity gate compares key sets only, so copying the
 * English value across satisfies it while leaving the string untranslated.
 */

return [
    'shared' => [
        'service_name' => 'Comunidad solidaria',
        'back_to_caring' => 'Volver a Comunidad solidaria',
        'back_to_caregiver' => 'De vuelta a tus relaciones afectuosas',
        'success_title' => 'Éxito',
        'error_title' => 'hay un problema',
        'unknown_member' => 'Miembro desconocido',
        'optional' => '(opcional)',
    ],
    'hub' => [
        'title' => 'Comunidad solidaria',
        'caption' => 'Cuidado y apoyo',
        'intro' => 'Coordinar la atención regular para otro miembro o responder a una solicitud de alguien que haya solicitado cuidar de usted.',
        'caregiver_card_title' => 'Tus relaciones afectuosas',
        'caregiver_card_description' => 'Vea las relaciones que ha solicitado, responda solicitudes sobre usted y utilice las herramientas que desbloquea una relación aprobada.',
        'become_title' => 'Conviértete en un cuidador',
        'become_description' => 'Solicite brindar atención regular a otro miembro de esta comunidad. Nada surte efecto hasta que estén de acuerdo y el personal lo haya verificado.',
    ],
    'caregiver' => [
        'title' => 'Tus relaciones afectuosas',
        'caption' => 'Comunidad solidaria',
        'intro' => 'Relaciones que has pedido y su etapa actual.',
        'none' => 'Aún no has pedido cuidar a nadie.',
        'become_button' => 'pedir cuidar a alguien',
        'incoming_title' => 'Solicitudes sobre ti',
        'incoming_intro' => 'Estos miembros han pedido cuidar de usted. Acepte sólo si comprende y acepta lo que significa.',
        'incoming_explanation' => 'Si está de acuerdo, el personal verificará la solicitud antes de que comience la relación. Estar de acuerdo no lo inicia por sí solo.',
        'incoming_none' => 'Nadie ha pedido cuidar de ti.',
        'confirm_button' => 'Acepto esta relación',
        'reject_button' => 'no estoy de acuerdo',
        'status_heading' => 'Escenario',
        'status_pending_recipient' => 'Esperando que el otro miembro esté de acuerdo',
        'status_pending_staff' => 'A la espera de un control de seguridad del personal',
        'status_active' => 'Aprobado y activo',
        'status_rejected' => 'No aprobado',
        'status_inactive' => 'Terminado',
        'relationship_heading' => 'Relación',
        'relationship_family' => 'Familia',
        'relationship_friend' => 'amigo',
        'relationship_neighbour' => 'Vecino',
        'relationship_professional' => 'cuidador profesional',
        'started_heading' => 'Cuidado iniciado',
        'reason_heading' => 'Razón dada',
        'pending_no_tools' => 'Mientras una solicitud está en espera, no le brinda acceso a los detalles de atención de este miembro.',
        'active_tools_title' => 'Lo que esta relación te permite hacer',
        'request_on_behalf_link' => 'Solicite ayuda en nombre de este miembro',
    ],
    'link' => [
        'title' => 'pedir cuidar a alguien',
        'caption' => 'Comunidad solidaria',
        'intro' => 'Solicite brindar atención regular a otro miembro de esta comunidad.',
        'consent_warning' => 'Al miembro que nombre se le preguntará si está de acuerdo. Luego, el personal verificará la solicitud. La relación no comienza, y no te aporta nada, hasta que ambos hayan sucedido.',
        'search_label' => 'Encuentre el miembro que desea cuidar',
        'search_hint' => 'Ingrese parte de su nombre y luego selecciónelo entre los resultados.',
        'search_button' => 'Buscar',
        'results_title' => 'Elige un miembro',
        'results_none' => 'Ningún miembro coincidió con ese nombre. Pruebe con una ortografía diferente.',
        'choose_button' => 'Elegir',
        'chosen_label' => 'Miembro que has elegido',
        'change_button' => 'Cambiar',
        'relationship_label' => 'Tu relación con ellos',
        'start_date_label' => 'Fecha en que comenzó o comenzará la atención',
        'start_date_hint' => 'Por ejemplo, 27 3 2026',
        'notes_label' => 'Todo lo que el personal debería saber.',
        'notes_hint' => 'Opcional. Esto se muestra al miembro del personal que verifica la solicitud.',
        'submit_button' => 'Enviar solicitud',
        'error_no_member' => 'Elija el miembro que desea cuidar',
        'error_no_relationship' => 'Seleccione su relación con ellos',
        'error_no_start_date' => 'Ingrese la fecha en que comenzó o comenzará la atención',
        'error_bad_start_date' => 'Introduzca una fecha real, por ejemplo 27 3 2026',
        'error_search_too_short' => 'Introduzca al menos dos caracteres para buscar',
    ],
    'on_behalf' => [
        'title' => 'Pedir ayuda en nombre de alguien',
        'intro' => 'Solicite a la comunidad ayuda práctica para el miembro que cuida. La solicitud se registra a su nombre y muestra que usted la realizó.',
        'for_member' => 'Esta solicitud es para',
        'title_label' => 'que ayuda se necesita',
        'title_hint' => 'Por ejemplo, un traslado a una cita en el hospital.',
        'description_label' => 'Más detalles',
        'when_label' => 'cuando es necesario',
        'contact_label' => 'Cómo deben ponerse en contacto los ayudantes',
        'contact_phone' => 'Por telefono',
        'contact_message' => 'Por mensaje',
        'contact_either' => 'Cualquiera está bien',
        'submit_button' => 'Enviar solicitud',
        'error_no_title' => 'Ingrese qué ayuda se necesita',
        'error_not_active' => 'Sólo puedes pedir ayuda en nombre de un miembro cuya relación haya sido aprobada.',
    ],
    'review' => [
        'title' => 'El cuidador solicita verificar',
        'caption' => 'Comunidad solidaria',
        'intro' => 'Verifique que el destinatario de la atención haya aceptado y registre cómo lo verificó antes de aprobar una relación de atención.',
        'none' => 'No hay solicitudes de cuidadores esperando a ser revisadas.',
        'requested_by' => 'Solicitado por',
        'requested_for' => 'cuidar de',
        'requested_on' => 'Solicitado el',
        'recipient_agreed' => 'El miembro ha aceptado',
        'recipient_not_agreed' => 'El miembro aún no ha aceptado',
        'blocked_until_agreed' => 'No puede aprobar esta solicitud hasta que el miembro la haya aceptado.',
        'evidence_label' => 'Cómo verificaste su consentimiento',
        'evidence_hint' => 'Por ejemplo, una llamada telefónica el 27 de marzo de 2026 con el propio afiliado.',
        'attestation_label' => 'Confirmo que verifiqué yo mismo el consentimiento de este miembro',
        'approve_button' => 'Aprobar relación',
        'reject_label' => '¿Por qué rechazas esta solicitud?',
        'reject_hint' => 'Esto se registra y se muestra al miembro que preguntó.',
        'reject_button' => 'Rechazar solicitud',
        'decided_approved' => 'Aprobado',
        'decided_rejected' => 'Rechazado',
        'error_no_evidence' => 'Ingrese cómo verificó su consentimiento',
        'error_no_attestation' => 'Confirme que usted mismo verificó el consentimiento de este miembro',
        'error_no_reason' => 'Ingrese por qué rechaza esta solicitud',
    ],
    'status' => [
        'link_requested' => 'Su solicitud ha sido enviada. Está esperando que el otro miembro esté de acuerdo y luego que el personal lo revise.',
        'link_failed' => 'Su solicitud no pudo ser enviada.',
        'link_duplicate' => 'Ya tienes una solicitud o una relación aprobada con ese miembro.',
        'incoming_confirmed' => 'Has aceptado. El personal ahora verificará la solicitud antes de que comience la relación.',
        'incoming_rejected' => 'Te has negado. No se ha creado ninguna relación.',
        'incoming_failed' => 'Tu respuesta no se pudo guardar.',
        'review_approved' => 'La relación de cariño ha sido aprobada.',
        'review_rejected' => 'La solicitud ha sido rechazada.',
        'review_not_agreed' => 'Esa solicitud no puede aprobarse porque el miembro no ha aceptado la misma.',
        'review_failed' => 'Esa decisión no se pudo salvar.',
        'review_not_found' => 'Esa solicitud no se pudo encontrar en esta comunidad.',
        'on_behalf_sent' => 'La solicitud de ayuda ha sido enviada.',
        'on_behalf_failed' => 'No se pudo enviar la solicitud de ayuda.',
    ],
];
