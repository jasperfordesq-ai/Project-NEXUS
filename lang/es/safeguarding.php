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
        'contact_restricted' => 'Este miembro sólo puede ser contactado a través de un coordinador. No se ha enviado nada. Puedes pedirle a un coordinador que te ponga en contacto.',
        'contact_restricted_title' => 'Contactar a través de un coordinador',
        'contact_restricted_detail' => 'El contacto con este miembro se organiza a través de un coordinador. Puedes pedirle a un coordinador que te ponga en contacto.',
        'contact_via_coordinator' => 'Debido a la elección de seguridad que tomó, solo puede comunicarse con los coordinadores y miembros cuya investigación de antecedentes haya registrado esta comunidad. No se ha enviado nada. Un coordinador puede ayudarle a ponerse en contacto.',
        'contact_via_coordinator_title' => 'Puede ponerse en contacto con coordinadores y miembros examinados.',
        'contact_via_coordinator_detail' => 'Debido a la elección de seguridad que tomó, puede comunicarse con los coordinadores y miembros cuya investigación de antecedentes ha registrado esta comunidad. Pregúntele a un coordinador si desea ayuda para ponerse en contacto con este miembro.',
        'contact_restricted_action' => 'Abrir ayuda',
        'coordination_not_required' => 'El contacto directo con este miembro está disponible en este momento — no necesitas un coordinador para gestionarlo. Por favor, actualiza la página e intenta enviar un mensaje de nuevo.',
        'coordination_request_failed' => 'No pudimos enviar tu solicitud al coordinador en este momento. Por favor, inténtalo de nuevo en breve.',
        'vetting_check_failed' => 'No pudimos comprobar tu estado de verificación en este momento. Por favor, inténtalo de nuevo en breve.',
        'policy_unavailable' => 'No podemos confirmar la política de salvaguardia de la comunidad en este momento. No se ha enviado ningún mensaje. Inténtelo de nuevo en breve.',
        'blocked_interaction' => 'No puedes interactuar con este miembro.',
        'interaction_not_allowed' => 'La política de salvaguardia de la comunidad del destinatario no permite esta interacción directa. Pide ayuda a un coordinador.',
        'policy_unavailable_title' => 'Control de protección no disponible temporalmente',
        'policy_unavailable_detail' => 'El Proyecto NEXUS no pudo evaluar de manera segura la política de contacto, por lo que esta interacción se suspendió.',
        'policy_unavailable_action' => 'comprobar de nuevo',
        'listing_role_confirmation_required' => 'Esta lista requiere una decisión de DBS mejorada confirmada por la comunidad por separado para esta función. Una confirmación de contacto de Messenger no cumple con los requisitos de protección específicos de la función.',
        'listing_role_feature_unavailable' => 'Aquí todavía no se puede habilitar la investigación de antecedentes penales para funciones específicas. La confirmación de contacto de Messenger no se reutiliza deliberadamente como autorización de roles.',
        'compliance_policy_unavailable' => 'No podemos confirmar con seguridad los requisitos de protección para este listado en este momento. Inténtelo de nuevo más tarde o comuníquese con su corredor.',
        'statement_required' => 'Se requiere un PDF de Declaración de protección infantil antes de poder declarar que esta comunidad trabaja con niños o adultos vulnerables. Sube uno para continuar.',
        'invalid_file' => 'El archivo cargado no se pudo leer. Inténtelo de nuevo con un PDF válido.',
        'pdf_required' => 'La declaración de salvaguardia debe ser un archivo PDF.',
        'file_too_large' => 'El archivo de declaración de salvaguardia es demasiado grande. El tamaño máximo es 10 MB.',
        'storage_failed' => 'No pudimos guardar el archivo cargado. Por favor inténtalo de nuevo.',
        'statement_missing' => 'No existe ninguna declaración de protección archivada para esta comunidad.',
        'file_missing' => 'El archivo de declaración de protección no se pudo encontrar en el servidor. Por favor súbelo de nuevo.',
        'revoke_failed' => 'No podíamos revocar esa preferencia. Es posible que ya haya sido revocado.',
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
        'united_kingdom' => 'Reino Unido — paquete de políticas nacionales',
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
        'activation_discovery_hidden' => 'Los miembros sin verificación registrados por esta comunidad no pueden enviarle mensajes, responderle, enviarle créditos de tiempo ni iniciar un intercambio con usted.',
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
        'switch_heading' => 'Hay una opción más suave disponible.',
        'switch_body' => 'Usted eligió que solo lo contacten los miembros cuya investigación de antecedentes haya registrado esta comunidad. Eso impide que casi todos se comuniquen contigo. Puedes pasar a que un coordinador vigile tus intercambios y te presente a los miembros, y otros miembros podrán enviarte mensajes nuevamente.',
        'switch_button' => 'Cambiar a presentaciones de coordinadores',
        'switched_toast' => 'Hecho. Un coordinador vigilará sus intercambios y los miembros podrán enviarle mensajes nuevamente.',
        'switch_not_held' => 'No tiene la configuración exclusiva para miembros examinados, por lo que no hay nada que cambiar.',
        'switch_unavailable' => 'Las presentaciones de coordinadores aún no están disponibles en esta comunidad. Por favor contacte a un coordinador.',
    ],
    'effects' => [
        'broker_approval' => 'Un coordinador supervisa cualquier intercambio que usted organice antes de que se lleve a cabo. No pueden leer sus mensajes.',
        'restricts_messaging' => 'Otros miembros no pueden enviarte mensajes, iniciar un intercambio contigo ni mencionarte. Los coordinadores siempre pueden comunicarse con usted y usted puede comunicarse con ellos. Los grupos a los que pertenece funcionan normalmente.',
        'restricts_matching' => 'Un coordinador primero verifica las coincidencias sugeridas entre usted y otros miembros.',
        'vetted_only' => 'Solo los coordinadores y miembros cuyos :vetting esta comunidad haya grabado pueden enviarte mensajes, responderte, enviarte créditos de tiempo o iniciar un intercambio contigo, y solo puedes contactarlos. Todos los demás están bloqueados. Los grupos a los que pertenece funcionan normalmente.',
        'vetted_count' => '{0} Ningún miembro ha grabado :vetting aquí en este momento, por lo que por ahora solo los coordinadores pueden comunicarse contigo.|{1} Solo 1 miembro ha grabado aquí :vetting en este momento.|[2,*] Los miembros :count han grabado aquí :vetting en este momento.',
        'notify_coordinator' => 'Se informa a un coordinador sobre tu elección, para que pueda ponerse en contacto si necesitas algo.',
        'no_home_visits' => 'Los coordinadores saben que usted no desea visitas domiciliarias a menos que ellas las organicen.',
        'check_before_helping' => 'Se informa a un coordinador, que confirmará si es necesaria una investigación de antecedentes (:vetting). Hasta que lo hayan hecho, no organice ayuda que involucre a niños o adultos vulnerables a través del banco de tiempo.',
        'informational' => 'Nada cambia para los demás miembros. Su respuesta ayuda a que los coordinadores lo apoyen.',
        'declined' => 'Nada cambia. Los coordinadores pueden ver que usted ha observado este paso.',
        'vetting_fallback' => 'investigación de antecedentes',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Esta comunidad se toma en serio la salvaguardia. Si desea tener más cuidado mientras utiliza el banco de tiempo, háganoslo saber a continuación y nuestros coordinadores le ayudarán. Cada opción te dice exactamente qué hace antes de elegirla.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Me considero un adulto vulnerable y me gustaría recibir apoyo adicional.',
                    'description' => 'Para mantenerlo seguro, solo los coordinadores y miembros cuya investigación de antecedentes haya registrado esta comunidad podrán comunicarse con usted, y usted solo podrá comunicarse con ellos. Un coordinador se pondrá en contacto.',
                ],
                'coordinator_introductions' => [
                    'label' => 'Me gustaría que un coordinador vigilara mis intercambios y me ayudara a presentarme a los miembros.',
                    'description' => 'Es bueno si quieres un poco de tranquilidad sin que te corten. Otros miembros aún pueden enviarte mensajes.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Sólo los miembros cuya investigación de antecedentes haya registrado esta comunidad pueden contactarme.',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Me gustaría que un coordinador organizara todos los contactos por mí en lugar de que los miembros me envíen mensajes directamente',
                    'description' => 'Un coordinador organizará el contacto y los intercambios en su nombre y puede aprobar que miembros concretos se pongan en contacto con usted. Otros miembros no podrán contactarlo directamente.',
                ],
                'no_home_visits' => [
                    'label' => 'No quiero que los miembros visiten mi casa a menos que un coordinador lo haya arreglado.',
                    'description' => 'Se informa a los coordinadores, para que puedan ayudar a organizar cualquier visita a su hogar y asegurarse de que se implementen las medidas de seguridad adecuadas.',
                ],
                'works_with_children' => [
                    'label' => 'Tengo previsto ofrecer servicios que puedan implicar a niños, niñas o jóvenes (menores de 18 años)',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planeo ofrecer ayuda que involucre a niños o adultos vulnerables (por ejemplo, tutoría para el hijo de un miembro o cuidado personal).',
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
                    'description' => 'En Irlanda, Garda Vetting se organiza a través de una organización para una función determinada. Aquí solo cuenta la investigación de lo que esta comunidad ha registrado, no la investigación de alguien a través de su trabajo u otro grupo.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Un coordinador organizará el contacto y los intercambios en su nombre y puede aprobar que miembros concretos se pongan en contacto con usted. Otros miembros no podrán contactarlo directamente.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre los requisitos de Garda Vetting. En Irlanda, determinadas actividades con menores requieren evaluación conforme a la Ley de la Oficina Nacional de Evaluación de 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Se le informará a un coordinador. En Irlanda, algunos trabajos regulares con niños o personas vulnerables necesitan Garda Vetting, que sólo una organización registrada puede organizar, y que siempre es necesario enseñar, entrenar o asesorar a niños. Por favor, no organice este tipo de ayuda a través del banco de tiempo hasta que un coordinador haya confirmado lo que se necesita.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Reino Unido',
            'vetting_authority' => 'DBS, Divulgación Escocia y AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En todo el Reino Unido, esto significa una verificación mejorada de DBS, PVG o AccessNI que esta comunidad ha registrado. Un cheque que alguien tiene a través de su trabajo o de otro grupo no cuenta aquí.',
                ],
                'works_with_children' => [
                    'description' => 'Un coordinador evaluará la función y la jurisdicción aplicable del Reino Unido antes de decidir qué control de salvaguardia es legalmente apropiado.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Se le informará a un coordinador, quien le confirmará si se necesita una verificación de DBS mejorado, PVG o AccessNI para lo que planea hacer. Por favor, no organice este tipo de ayuda a través del banco de tiempo hasta que lo hayan hecho.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Inglaterra y Gales',
            'vetting_authority' => 'Servicio de Divulgación y Restricción',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Inglaterra y Gales, esto significa una verificación de DBS mejorada que esta comunidad ha registrado. Un cheque que alguien tiene a través de su trabajo o de otro grupo no cuenta aquí.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre los requisitos de comprobación DBS.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Se le informará a un coordinador y éste le confirmará si es necesaria una verificación DBS para lo que planea hacer. Por favor, no organice este tipo de ayuda a través del banco de tiempo hasta que lo hayan hecho.',
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
                    'description' => 'En Escocia, esto significa la membresía en el esquema PVG que esta comunidad ha registrado. La membresía que alguien tiene a través de su trabajo u otro grupo no cuenta aquí.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre la pertenencia al programa PVG.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Planeo ofrecer ayuda que involucre a niños o adultos protegidos (por ejemplo, tutoría para el hijo de un miembro o cuidado personal).',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Irlanda del Norte',
            'vetting_authority' => 'AccesoNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'En Irlanda del Norte, esto significa una verificación de AccessNI que esta comunidad ha registrado. Un cheque que alguien tiene a través de su trabajo o de otro grupo no cuenta aquí.',
                ],
                'works_with_children' => [
                    'description' => 'Una persona coordinadora puede hablar con usted sobre la comprobación AccessNI.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Se le informará a un coordinador y éste le confirmará si es necesaria una verificación de AccessNI para lo que planea hacer. Por favor, no organice este tipo de ayuda a través del banco de tiempo hasta que lo hayan hecho.',
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
