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
    'caption' => 'Project NEXUS Platform',
    'effective_date' => 'Effective :date',
    'provider_notice_title' => 'Platform Provider Notice',
    'provider_notice_body' => 'This document governs the relationship between you and Project NEXUS (the platform provider). It is separate from any terms established by :tenant (your community operator).',
    'authoritative_notice_title' => 'Authoritative English version',
    'authoritative_notice_body' => 'The substantive legal text on this page is the authoritative English version. This notice is translated for convenience; if a translation differs, the English text controls.',
    'view_tenant_legal' => 'View :tenant\'s legal documents',
    'contents' => 'Contents',
    'related_documents' => 'Related Platform Documents',
    'cta_title' => 'Questions About This Document?',
    'cta_body' => 'If you have questions about this platform-level document, contact the Project NEXUS team. For questions about your community\'s policies, contact :tenant directly.',
    'nexus_website' => 'Project NEXUS Website',
    'contact_tenant' => 'Contact :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'Platform Terms of Service',
            'title' => 'Platform Terms of Service',
            'subtitle' => 'The terms governing the Project NEXUS platform infrastructure',
            'meta_title' => 'Platform Terms of Service',
            'meta_description' => 'Terms of service governing use of the NEXUS community timebanking platform.',
            'link_label' => 'Platform Terms of Service',
            'sections' => [
                'introduction' => 'Introduction & Acceptance',
                'provider' => 'Platform Provider Identity',
                'definitions' => 'Definitions',
                'operator-responsibilities' => 'Operator Responsibilities',
                'acceptable-use' => 'Acceptable Use',
                'intellectual-property' => 'Intellectual Property',
                'limitation-of-liability' => 'Limitation of Liability',
                'indemnification' => 'Indemnification',
                'data-processing' => 'Data Processing',
                'termination' => 'Termination',
                'changes' => 'Changes to Terms',
                'governing-law' => 'Governing Law',
            ],
        ],
        'privacy' => [
            'page_title' => 'Platform Privacy Policy',
            'title' => 'Platform Privacy Policy',
            'subtitle' => 'How Project NEXUS handles data at the platform infrastructure level',
            'meta_title' => 'Platform Privacy Policy',
            'meta_description' => 'How the NEXUS platform collects, processes, and protects your personal data.',
            'link_label' => 'Platform Privacy Policy',
            'sections' => [
                'introduction' => 'Introduction',
                'controller-processor' => 'Data Controller vs Data Processor',
                'data-collected' => 'Data We Collect at Platform Level',
                'legal-basis' => 'Legal Basis for Processing',
                'data-sharing' => 'Data Sharing',
                'international-transfers' => 'International Data Transfers',
                'retention' => 'Data Retention',
                'your-rights' => 'Your Rights Under GDPR',
                'security' => 'Security Measures',
                'contact' => 'Contact',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'Platform Disclaimer',
            'title' => 'Platform Disclaimer',
            'subtitle' => 'Important disclaimers and liability limitations for the Project NEXUS platform',
            'meta_title' => 'Platform Disclaimer',
            'meta_description' => 'Important disclaimers about the use of the NEXUS community timebanking platform.',
            'link_label' => 'Platform Disclaimer',
            'sections' => [
                'no-warranty' => 'No Warranty',
                'no-advice' => 'No Legal, Financial, or Regulatory Advice',
                'operator-independence' => 'Community Operator Independence',
                'member-interactions' => 'Member Interactions',
                'content-uploads' => 'Content and Uploads',
                'identity-verification' => 'Identity Verification',
                'third-party' => 'Third-Party Services',
                'limitation-of-liability' => 'Limitation of Liability',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'Platform Provider Legal',
        'section_desc' => 'These documents govern the Project NEXUS platform infrastructure and are separate from your community\'s policies.',
        'terms' => 'Platform Terms',
        'privacy' => 'Platform Privacy',
        'disclaimer' => 'Disclaimer',
    ],
];
