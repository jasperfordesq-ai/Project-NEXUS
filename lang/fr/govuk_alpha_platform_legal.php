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
    'caption' => 'Plateforme Project NEXUS',
    'effective_date' => 'En vigueur depuis le :date',
    'provider_notice_title' => 'Avis du fournisseur de la plateforme',
    'provider_notice_body' => 'Ce document régit la relation entre vous et Project NEXUS (le fournisseur de la plateforme). Il est distinct de tout accord établi par :tenant (l’opérateur de votre communauté).',
    'authoritative_notice_title' => 'Version anglaise faisant foi',
    'authoritative_notice_body' => 'Le texte juridique substantiel de cette page est la version anglaise faisant foi. Cet avis est traduit par commodité ; en cas de différence, le texte anglais prévaut.',
    'view_tenant_legal' => 'Voir les documents juridiques de :tenant',
    'contents' => 'Sommaire',
    'related_documents' => 'Documents de plateforme connexes',
    'cta_title' => 'Des questions sur ce document ?',
    'cta_body' => 'Si vous avez des questions sur ce document de plateforme, contactez l’équipe Project NEXUS. Pour les questions relatives aux politiques de votre communauté, contactez directement :tenant.',
    'nexus_website' => 'Site web Project NEXUS',
    'contact_tenant' => 'Contacter :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Conditions d’utilisation de la plateforme',
            'title' => 'Conditions d’utilisation de la plateforme',
            'subtitle' => 'Les conditions régissant l’infrastructure de la plateforme Project NEXUS',
            'meta_title' => 'Conditions de service de la plateforme',
            'meta_description' => 'Conditions de service régissant l\'utilisation de la plateforme communautaire de timebanking NEXUS.',
            'link_label' => 'Conditions d’utilisation de la plateforme',
            'sections' => [
                'introduction' => 'Introduction et acceptation',
                'provider' => 'Identité du fournisseur de la plateforme',
                'definitions' => 'Définitions',
                'operator-responsibilities' => 'Responsabilités de l\'opérateur',
                'acceptable-use' => 'Utilisation acceptable',
                'intellectual-property' => 'Propriété intellectuelle',
                'limitation-of-liability' => 'Limitation de responsabilité',
                'indemnification' => 'Indemnisation',
                'data-processing' => 'Traitement des données',
                'termination' => 'Résiliation',
                'changes' => 'Modifications des conditions',
                'governing-law' => 'Droit applicable',
            ],
        ],
        'privacy' => [
            'page_title' => 'Politique de confidentialité de la plateforme',
            'title' => 'Politique de confidentialité de la plateforme',
            'subtitle' => 'Comment Project NEXUS traite les données au niveau de l’infrastructure de la plateforme',
            'meta_title' => 'Politique de confidentialité de la plateforme',
            'meta_description' => 'Comment la plateforme NEXUS collecte, traite et protège vos données personnelles.',
            'link_label' => 'Politique de confidentialité de la plateforme',
            'sections' => [
                'introduction' => 'Introduction',
                'controller-processor' => 'Responsable du traitement et sous-traitant',
                'data-collected' => 'Données collectées au niveau de la plateforme',
                'legal-basis' => 'Base juridique du traitement',
                'data-sharing' => 'Partage des données',
                'international-transfers' => 'Transferts internationaux de données',
                'retention' => 'Conservation des données',
                'your-rights' => 'Vos droits au titre du RGPD',
                'security' => 'Mesures de sécurité',
                'contact' => 'Contact',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Avertissement de la plateforme',
            'title' => 'Avertissement de la plateforme',
            'subtitle' => 'Avertissements importants et limitations de responsabilité pour la plateforme Project NEXUS',
            'meta_title' => 'Avertissement de la plateforme',
            'meta_description' => 'Avertissements importants concernant l\'utilisation de la plateforme communautaire de timebanking NEXUS.',
            'link_label' => 'Avertissement de la plateforme',
            'sections' => [
                'no-warranty' => 'Absence de garantie',
                'no-advice' => 'Absence de conseil juridique, financier ou réglementaire',
                'operator-independence' => 'Indépendance des opérateurs de communauté',
                'member-interactions' => 'Interactions entre membres',
                'content-uploads' => 'Contenus et téléversements',
                'identity-verification' => 'Vérification d\'identité',
                'third-party' => 'Services tiers',
                'limitation-of-liability' => 'Limitation de responsabilité',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Mentions légales du fournisseur de plateforme',
        'section_desc' => 'Ces documents régissent l\'infrastructure de la plateforme du Projet NEXUS et sont distincts des politiques de votre communauté.',
        'terms' => 'Conditions de la plateforme',
        'privacy' => 'Confidentialité de la plateforme',
        'disclaimer' => 'Clause de non-responsabilité',
    ],
];
