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
    'provider_notice_title' => 'Aviso do Fornecedor da Plataforma',
    'provider_notice_body' => 'Este documento rege a relação entre si e o Project NEXUS (o fornecedor da plataforma). É distinto de quaisquer termos estabelecidos por :tenant (o operador da sua comunidade).',
    'authoritative_notice_title' => 'Versão inglesa oficial',
    'authoritative_notice_body' => 'O texto jurídico substantivo desta página é a versão inglesa oficial. Este aviso é traduzido por conveniência; em caso de divergência, prevalece o texto inglês.',
    'view_tenant_legal' => 'Ver documentos legais de :tenant',
    'contents' => 'Índice',
    'related_documents' => 'Documentos da Plataforma Relacionados',
    'cta_title' => 'Questões Sobre Este Documento?',
    'cta_body' => 'Se tiver questões sobre este documento da plataforma, contacte a equipe do Project NEXUS. Para questões sobre as políticas da sua comunidade, contacte :tenant diretamente.',
    'nexus_website' => 'Website do Project NEXUS',
    'contact_tenant' => 'Contactar :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Termos de Serviço da Plataforma',
            'title' => 'Termos de Serviço da Plataforma',
            'subtitle' => 'Os termos que regem a infraestrutura da plataforma Project NEXUS',
            'meta_title' => 'Termos de Serviço da Plataforma',
            'meta_description' => 'Termos de serviço que regem o uso da plataforma comunitária de timebanking NEXUS.',
            'link_label' => 'Termos de Serviço da Plataforma',
            'sections' => [
                'introduction' => 'Introdução e aceitação',
                'provider' => 'Identidade do fornecedor da plataforma',
                'definitions' => 'Definições',
                'operator-responsibilities' => 'Responsabilidades do operador',
                'acceptable-use' => 'Utilização aceitável',
                'intellectual-property' => 'Propriedade intelectual',
                'limitation-of-liability' => 'Limitação de responsabilidade',
                'indemnification' => 'Indemnização',
                'data-processing' => 'Tratamento de dados',
                'termination' => 'Cessação',
                'changes' => 'Alterações aos termos',
                'governing-law' => 'Lei aplicável',
            ],
        ],
        'privacy' => [
            'page_title' => 'Política de Privacidade da Plataforma',
            'title' => 'Política de Privacidade da Plataforma',
            'subtitle' => 'Como o Project NEXUS trata dados ao nível da infraestrutura da plataforma',
            'meta_title' => 'Política de Privacidade da Plataforma',
            'meta_description' => 'Como a plataforma NEXUS coleta, processa e protege seus dados pessoais.',
            'link_label' => 'Política de Privacidade da Plataforma',
            'sections' => [
                'introduction' => 'Introdução',
                'controller-processor' => 'Responsável pelo tratamento vs. subcontratante',
                'data-collected' => 'Dados recolhidos ao nível da plataforma',
                'legal-basis' => 'Fundamento jurídico do tratamento',
                'data-sharing' => 'Compartilhamento de dados',
                'international-transfers' => 'Transferências internacionais de dados',
                'retention' => 'Conservação dos dados',
                'your-rights' => 'Os seus direitos ao abrigo do RGPD',
                'security' => 'Medidas de segurança',
                'contact' => 'Contacto',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Aviso Legal da Plataforma',
            'title' => 'Aviso Legal da Plataforma',
            'subtitle' => 'Avisos legais e limitações de responsabilidade importantes para a plataforma Project NEXUS',
            'meta_title' => 'Isenção de Responsabilidade da Plataforma',
            'meta_description' => 'Isenções de responsabilidade importantes sobre o uso da plataforma comunitária de timebanking NEXUS.',
            'link_label' => 'Aviso Legal da Plataforma',
            'sections' => [
                'no-warranty' => 'Sem garantia',
                'no-advice' => 'Sem aconselhamento jurídico, financeiro ou regulamentar',
                'operator-independence' => 'Independência dos operadores da comunidade',
                'member-interactions' => 'Interações entre membros',
                'content-uploads' => 'Conteúdos e carregamentos',
                'identity-verification' => 'Verificação de identidade',
                'third-party' => 'Serviços de terceiros',
                'limitation-of-liability' => 'Limitação de responsabilidade',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Jurídico do provedor de plataforma',
        'section_desc' => 'Estes documentos regem a infraestrutura da plataforma do Projeto NEXUS e são separados das políticas da sua comunidade.',
        'terms' => 'Termos da plataforma',
        'privacy' => 'Privacidade da plataforma',
        'disclaimer' => 'Isenção de responsabilidade',
    ],
];
