<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Esta conversación está pausada por una norma de protección de la comunidad. Tu comunidad debe haber registrado una confirmación vigente del estado :types antes de que puedas enviar mensajes a este miembro. Pide a tu intermediario o al equipo administrador de la comunidad que registre este estado únicamente como metadatos. No envíes ni subas ningún documento de comprobación.',
        'vetting_required_title' => 'Se necesita una comprobacion de proteccion',
        'vetting_required_detail' => 'Solo pueden contactar con este miembro para este tipo de interacción quienes tengan un estado :types vigente registrado por su comunidad. El registro contiene únicamente metadatos; no debe enviarse ni subirse ningún documento.',
        'vetting_required_action' => 'Abrir ayuda',
        'contact_restricted' => 'Esta persona ha pedido que un coordinador organice el contacto en su nombre. Tu mensaje no se ha enviado. Contacta con tu broker o administrador de la comunidad para organizar el siguiente paso seguro.',
        'contact_restricted_title' => 'Hace falta coordinacion',
        'contact_restricted_detail' => 'Este miembro no está disponible para mensajes directos porque sus preferencias de salvaguarda requieren que el contacto sea gestionado por un coordinador. Puedes pedir a un coordinador que ayude a organizar el contacto.',
        'contact_restricted_action' => 'Abrir ayuda',
        'coordination_not_required' => 'El contacto directo con este miembro está disponible en este momento — no necesitas un coordinador para gestionarlo. Por favor, actualiza la página e intenta enviar un mensaje de nuevo.',
        'coordination_request_failed' => 'No pudimos enviar tu solicitud al coordinador en este momento. Por favor, inténtalo de nuevo en breve.',
        'vetting_check_failed' => 'No pudimos comprobar tu estado de verificación en este momento. Por favor, inténtalo de nuevo en breve.',
        'statement_required' => 'Se requiere un PDF de Declaración de protección infantil antes de poder declarar que esta comunidad trabaja con niños o adultos vulnerables. Sube uno para continuar.',
        'invalid_file' => 'El archivo cargado no se pudo leer. Inténtelo de nuevo con un PDF válido.',
        'pdf_required' => 'La declaración de salvaguardia debe ser un archivo PDF.',
        'file_too_large' => 'El archivo de declaración de salvaguardia es demasiado grande. El tamaño máximo es 10 MB.',
        'storage_failed' => 'No pudimos guardar el archivo cargado. Por favor inténtalo de nuevo.',
        'statement_missing' => 'No existe ninguna declaración de protección archivada para esta comunidad.',
        'file_missing' => 'El archivo de declaración de protección no se pudo encontrar en el servidor. Por favor súbelo de nuevo.',
        'revoke_failed' => 'No podíamos revocar esa preferencia. Es posible que ya haya sido revocado.',
        'policy_unavailable' => 'No podemos confirmar la política de salvaguardia de la comunidad en este momento. No se ha enviado ningún mensaje. Inténtelo de nuevo en breve.',
        'interaction_not_allowed' => 'La política de salvaguardia de la comunidad del destinatario no permite esta interacción directa. Pide ayuda a un coordinador.',
        'policy_unavailable_title' => 'Control de protección no disponible temporalmente',
        'policy_unavailable_detail' => 'El Proyecto NEXUS no pudo evaluar de manera segura la política de contacto, por lo que esta interacción se suspendió.',
        'policy_unavailable_action' => 'comprobar de nuevo',
        'listing_role_confirmation_required' => 'Esta lista requiere una decisión de DBS mejorada confirmada por la comunidad por separado para esta función. Una confirmación de contacto de Messenger no cumple con los requisitos de protección específicos de la función.',
        'listing_role_feature_unavailable' => 'Aquí todavía no se puede habilitar la investigación de antecedentes penales para funciones específicas. La confirmación de contacto de Messenger no se reutiliza deliberadamente como autorización de roles.',
        'compliance_policy_unavailable' => 'No podemos confirmar con seguridad los requisitos de protección para este listado en este momento. Inténtelo de nuevo más tarde o comuníquese con su corredor.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'ECP básica',
        'dbs_standard' => 'Estándar DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'investigación de antecedentes de la garda',
        'access_ni' => 'AccesoNI',
        'pvg_scotland' => 'PVG Escocia',
        'international' => 'Verificación de antecedentes internacionales',
        'other' => 'Otro control de investigación',
        'uk_safeguarding_clearance' => 'Autorización de salvaguardia del Reino Unido',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Jurisdicción de salvaguardia no configurada',
        'united_kingdom' => 'United Kingdom ? national policy package',
        'england_wales' => 'Inglaterra y Gales',
        'scotland' => 'Escocia',
        'northern_ireland' => 'Irlanda del Norte',
        'ireland' => 'República de Irlanda',
        'custom' => 'Jurisdicción aduanera',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS mejorado confirmado para contacto de miembro protegido',
        'pvg_scotland' => 'Estado PVG confirmado para contacto de miembro protegido',
        'access_ni' => 'Estado de AccessNI confirmado para contacto de miembro protegido',
        'garda_vetting' => 'Garda Vetting confirmado para contacto con miembros protegidos',
        'uk_safeguarding_clearance' => 'Autorización de salvaguardia del Reino Unido confirmada para contacto de miembro protegido',
    ],
    'confirmation' => [
        'title' => 'Se han guardado tus preferencias de protección',
        'intro' => 'Gracias por compartir esto. Aquí hay un resumen de lo que eligió, quién puede verlo y qué se activa como resultado.',
        'your_selections' => 'Tus selecciones',
        'no_selections' => 'No seleccionó ninguna opción de protección.',
        'who_can_see_heading' => '¿Quién puede ver esto?',
        'who_can_see_body' => 'Sólo los coordinadores y administradores de la comunidad pueden ver estas preferencias. Otros miembros no pueden. Todo el acceso está registrado.',
        'what_activates_heading' => 'Lo que se activa como resultado',
        'activation_broker_review' => 'Un coordinador revisará y aprobará coincidencias o intercambios protegidos cuando la preferencia seleccionada lo requiera. Esto no les da acceso al contenido del mensaje.',
        'activation_match_approval' => 'Un coordinador aprobará las coincidencias que te involucren antes de que se las sugieran al otro miembro.',
        'activation_discovery_hidden' => 'Quedará oculto para que no lo descubran los miembros que no hayan completado la investigación de antecedentes requerida.',
        'activation_notification' => 'Un coordinador ha sido notificado y se pondrá en contacto para discutir cómo podemos ayudar.',
        'activation_none' => 'No se activan protecciones automáticas a partir de estas selecciones. Sus preferencias se registran para que el coordinador las conozca.',
        'revoke_heading' => 'Cómo cambiarlos o revocarlos en cualquier momento',
        'revoke_body' => 'Puede revisar o revocar cualquiera de estas preferencias en cualquier momento desde la configuración de su perfil. No es necesario pedirle a un administrador que haga esto.',
        'revoke_cta' => 'Ir a la configuración de protección',
        'continue_cta' => 'Continuar',
    ],
    'settings' => [
        'page_title' => 'Preferencias de protección',
        'intro' => 'Revise o revoque las preferencias de protección que estableció durante la incorporación. Sus coordinadores pueden verlos pero otros miembros no.',
        'no_preferences' => 'No tienes preferencias de protección activas. Puede configurarlos en cualquier momento desde la página de ayuda de protección.',
        'selected_on' => 'Seleccionado el :date',
        'revoke_button' => 'Revocar',
        'revoke_confirm_title' => '¿Revocar esta preferencia?',
        'revoke_confirm_body' => 'Esta preferencia ya no se aplicará a su cuenta. Sus coordinadores serán notificados del cambio.',
        'revoke_confirm_yes' => 'Sí, revocar',
        'revoke_confirm_no' => 'Guárdalo',
        'revoked_toast' => 'Preferencia revocada.',
        'revoke_error_toast' => 'Algo salió mal. Por favor inténtalo de nuevo.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Esta comunidad se toma en serio la protección. Si se considera una persona adulta vulnerable o necesita apoyo adicional, háganoslo saber para que nuestro equipo de coordinación pueda ayudarle a organizar intercambios seguros.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Me considero una persona adulta vulnerable y podría necesitar apoyo adicional de protección',
                    'description' => 'Esto permite que nuestro equipo de coordinación sepa que quizá necesite apoyo adicional al organizar intercambios. Una persona coordinadora se pondrá en contacto para hablar de cómo podemos ayudarle. Esta información es confidencial.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Preferiría interactuar únicamente con miembros que hayan sido evaluados adecuadamente',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Quisiera que una persona coordinadora me ayudara a organizar mis intercambios en lugar de recibir contacto directo',
                    'description' => 'Una persona coordinadora mediará en todo contacto y ayudará a organizar los intercambios en su nombre. Los demás miembros no podrán enviarle mensajes directamente.',
                ],
                'no_home_visits' => [
                    'label' => 'No quiero que miembros visiten mi domicilio sin que lo organice una persona coordinadora',
                    'description' => 'Todas las visitas a domicilio se organizarán mediante una persona coordinadora que pueda garantizar que existan medidas de protección adecuadas.',
                ],
                'works_with_children' => [
                    'label' => 'Tengo previsto ofrecer servicios que puedan implicar a niños, niñas o jóvenes (menores de 18 años)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Tengo previsto ofrecer servicios que puedan implicar a personas adultas vulnerables',
                ],
                'none_apply' => [
                    'label' => 'Ninguna de estas opciones se aplica a mí',
                    'description' => 'He revisado las opciones anteriores y ninguna se aplica a mi situación. Esto queda registrado para que el equipo de coordinación sepa que he visto y considerado este paso.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Irlanda',
            'vetting_authority' => 'Oficina Nacional de Evaluación',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Irlanda, esto significa miembros con Garda Vetting. Nuestro equipo de coordinación garantizará que solo se le empareje con miembros evaluados.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Una persona coordinadora (intermediaria) mediará en todo contacto y ayudará a organizar los intercambios en su nombre. Los demás miembros no podrán enviarle mensajes directamente.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre los requisitos de Garda Vetting. En Irlanda, determinadas actividades con menores requieren evaluación conforme a la Ley de la Oficina Nacional de Evaluación de 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre los requisitos de Garda Vetting. Las actividades con personas adultas vulnerables pueden requerir evaluación.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Reino Unido',
            'vetting_authority' => 'DBS, Divulgación Escocia y AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En todo el Reino Unido, los coordinadores confirman la base Enhanced DBS, PVG y/o AccessNI adecuada para el contacto protegido.',
                ],
                'works_with_children' => [
                    'description' => 'Un coordinador evaluará la función y la jurisdicción aplicable del Reino Unido antes de decidir qué control de salvaguardia es legalmente apropiado.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Un coordinador evaluará el papel, los adultos involucrados y la jurisdicción aplicable del Reino Unido antes de decidir qué control de protección es legalmente apropiado.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Inglaterra y Gales',
            'vetting_authority' => 'Servicio de Divulgación y Restricción',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Inglaterra y Gales, esto significa miembros con comprobación DBS. Nuestro equipo de coordinación garantizará que solo se le empareje con miembros evaluados.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre los requisitos de comprobación DBS.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Escocia',
            'vetting_authority' => 'Disclosure Scotland (programa PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Me considero una persona adulta vulnerable o protegida y podría necesitar apoyo adicional de protección',
                ],
                'requires_vetted_partners' => [
                    'description' => 'En Escocia, esto significa miembros del programa PVG. Nuestro equipo de coordinación garantizará que solo se le empareje con miembros evaluados.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre la pertenencia al programa PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Tengo previsto ofrecer servicios que puedan implicar a personas adultas protegidas',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlanda del Norte',
            'vetting_authority' => 'AccesoNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Irlanda del Norte, esto significa miembros con comprobación AccessNI. Nuestro equipo de coordinación garantizará que solo se le empareje con miembros evaluados.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre la comprobación AccessNI.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Personalizado',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'Su comunidad cambió su jurisdicción de salvaguardia. Su protección existente permanece activa, pero revise la redacción actualizada en Configuración.',
        'jurisdiction_changed_staff' => 'La jurisdicción de salvaguardia cambió. Las protecciones de los miembros afectados permanecen activas y ahora requieren la revisión de los miembros.',
        'attestation_policy_rotated_member' => 'Su comunidad ha iniciado una revisión de la política de protección. Su corredor debe reconfirmar su estado de contacto privado; esto no es un vencimiento de certificado.',
        'reminder_subject' => 'Revise sus preferencias de protección',
        'reminder_title' => 'Es hora de revisar sus preferencias de protección',
        'reminder_body' => 'Ha pasado más de un año desde que estableciste tus preferencias de protección para :community. Tómese un momento para revisarlos y confirmar que aún se aplican, o revocar aquellos que ya no lo sean.',
        'reminder_cta' => 'Revisar preferencias',
        'escalation_subject' => 'Revisión de protección de miembros pendiente',
        'escalation_title' => 'Revisión anual de salvaguardia pendiente',
        'escalation_body' => ':name no ha respondido a una solicitud para revisar sus preferencias de protección en 30 días. Sus preferencias permanecen activas: el miembro tiene derecho a conservarlas. Comuníquese directamente si desea registrarse.',
        'escalation_cta' => 'Ver miembro en el panel de protección',
    ],
];
