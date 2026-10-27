<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Page chrome for the PLATFORM's own legal documents (Project NEXUS, not a
// community) on the accessible frontend: /platform/terms, /platform/privacy and
// /platform/disclaimer. Ported from react-frontend/public/locales/<locale>/legal.json
// (platform, platform_terms, platform_privacy, platform_disclaimer, page_meta, hub).
// The documents' substantive text is canonically English and is NOT translated
// here — see web-uk/scripts/build-platform-legal-text.js.

return [
    'caption' => 'Plataforma Project NEXUS',
    'effective_date' => 'Vigente desde :date',
    'provider_notice_title' => 'Aviso del Proveedor de la Plataforma',
    'provider_notice_body' => 'Este documento rige la relación entre usted y Project NEXUS (el proveedor de la plataforma). Es independiente de cualquier término establecido por :tenant (el operador de su comunidad).',
    'authoritative_notice_title' => 'Versión inglesa de referencia',
    'authoritative_notice_body' => 'El texto jurídico sustantivo de esta página es la versión inglesa de referencia. Este aviso se traduce para facilitar su consulta; si existe alguna diferencia, prevalece el texto inglés.',
    'view_tenant_legal' => 'Ver documentos legales de :tenant',
    'contents' => 'Contenido',
    'related_documents' => 'Documentos de Plataforma Relacionados',
    'cta_title' => '¿Preguntas Sobre Este Documento?',
    'cta_body' => 'Si tiene preguntas sobre este documento a nivel de plataforma, contacte al equipo de Project NEXUS. Para preguntas sobre las políticas de su comunidad, contacte directamente con :tenant.',
    'nexus_website' => 'Sitio Web de Project NEXUS',
    'contact_tenant' => 'Contactar a :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Términos de Servicio de la Plataforma',
            'title' => 'Términos de Servicio de la Plataforma',
            'subtitle' => 'Los términos que rigen la infraestructura de la plataforma Project NEXUS',
            'meta_title' => 'Términos de Servicio de la Plataforma',
            'meta_description' => 'Términos de servicio que rigen el uso de la plataforma comunitaria de intercambio de tiempo NEXUS.',
            'link_label' => 'Términos de Servicio de la Plataforma',
            'sections' => [
                'introduction' => 'Introducción y aceptación',
                'provider' => 'Identidad del proveedor de la plataforma',
                'definitions' => 'Definiciones',
                'operator-responsibilities' => 'Responsabilidades del operador',
                'acceptable-use' => 'Uso aceptable',
                'intellectual-property' => 'Propiedad intelectual',
                'limitation-of-liability' => 'Limitación de responsabilidad',
                'indemnification' => 'Indemnización',
                'data-processing' => 'Tratamiento de datos',
                'termination' => 'Terminación',
                'changes' => 'Cambios en las condiciones',
                'governing-law' => 'Ley aplicable',
            ],
        ],
        'privacy' => [
            'page_title' => 'Política de Privacidad de la Plataforma',
            'title' => 'Política de Privacidad de la Plataforma',
            'subtitle' => 'Cómo Project NEXUS gestiona los datos a nivel de infraestructura de la plataforma',
            'meta_title' => 'Política de Privacidad de la Plataforma',
            'meta_description' => 'Cómo la plataforma NEXUS recopila, procesa y protege tus datos personales.',
            'link_label' => 'Política de Privacidad de la Plataforma',
            'sections' => [
                'introduction' => 'Introducción',
                'controller-processor' => 'Responsable del tratamiento frente a encargado del tratamiento',
                'data-collected' => 'Datos que recopilamos a nivel de plataforma',
                'legal-basis' => 'Base jurídica del tratamiento',
                'data-sharing' => 'Comunicación de datos',
                'international-transfers' => 'Transferencias internacionales de datos',
                'retention' => 'Conservación de los datos',
                'your-rights' => 'Sus derechos conforme al RGPD',
                'security' => 'Medidas de seguridad',
                'contact' => 'Contacto',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Descargo de Responsabilidad de la Plataforma',
            'title' => 'Descargo de Responsabilidad de la Plataforma',
            'subtitle' => 'Descargos de responsabilidad y limitaciones de responsabilidad importantes para la plataforma Project NEXUS',
            'meta_title' => 'Descargo de Responsabilidad de la Plataforma',
            'meta_description' => 'Importantes descargos de responsabilidad sobre el uso de la plataforma comunitaria de intercambio de tiempo NEXUS.',
            'link_label' => 'Descargo de Responsabilidad de la Plataforma',
            'sections' => [
                'no-warranty' => 'Sin garantía',
                'no-advice' => 'Sin asesoramiento jurídico, financiero ni regulatorio',
                'operator-independence' => 'Independencia de los operadores de la comunidad',
                'member-interactions' => 'Interacciones entre miembros',
                'content-uploads' => 'Contenido y archivos cargados',
                'identity-verification' => 'Verificación de identidad',
                'third-party' => 'Servicios de terceros',
                'limitation-of-liability' => 'Limitación de responsabilidad',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Proveedor de plataforma Legal',
        'section_desc' => 'Estos documentos rigen la infraestructura de la plataforma del Proyecto NEXUS y están separados de las políticas de su comunidad.',
        'terms' => 'Términos de la plataforma',
        'privacy' => 'Privacidad de la plataforma',
        'disclaimer' => 'Descargo de responsabilidad',
    ],
];
