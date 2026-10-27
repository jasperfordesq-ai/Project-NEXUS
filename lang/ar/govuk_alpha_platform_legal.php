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
    'caption' => 'منصة مشروع نكسس',
    'effective_date' => 'ساري المفعول :date',
    'provider_notice_title' => 'إشعار مزود المنصة',
    'provider_notice_body' => 'تتحكم هذه الوثيقة في العلاقة بينك وبين مشروع نكسس (مزود المنصة). وهي منفصلة عن أي شروط وضعتها :tenant (مشغل مجتمعك).',
    'authoritative_notice_title' => 'النسخة الإنجليزية المعتمدة',
    'authoritative_notice_body' => 'النص القانوني الموضوعي في هذه الصفحة هو النسخة الإنجليزية المعتمدة. تُرجمت هذه الملاحظة للتيسير؛ وعند وجود اختلاف، تكون الأولوية للنص الإنجليزي.',
    'view_tenant_legal' => 'عرض الوثائق القانونية لـ :tenant',
    'contents' => 'محتويات',
    'related_documents' => 'وثائق المنصة ذات الصلة',
    'cta_title' => 'أسئلة حول هذه الوثيقة؟',
    'cta_body' => 'إذا كانت لديك أسئلة حول هذه الوثيقة على مستوى المنصة، يرجى الاتصال بفريق مشروع نكسس. وللأسئلة حول سياسات مجتمعك، اتصل بـ :tenant مباشرة.',
    'nexus_website' => 'موقع مشروع نكسس',
    'contact_tenant' => 'اتصل بـ :tenant',
    'documents' => [
        'terms' => [
            'page_title' => 'شروط خدمة المنصة',
            'title' => 'شروط خدمة المنصة',
            'subtitle' => 'الشروط التي تحكم بنية منصة مشروع نكسس',
            'meta_title' => 'شروط خدمة المنصة',
            'meta_description' => 'شروط الخدمة التي تحكم استخدام منصة NEXUS لتبادل الوقت.',
            'link_label' => 'شروط خدمة المنصة',
            'sections' => [
                'introduction' => 'المقدمة والقبول',
                'provider' => 'هوية مزوّد المنصة',
                'definitions' => 'التعريفات',
                'operator-responsibilities' => 'مسؤوليات المشغّل',
                'acceptable-use' => 'الاستخدام المقبول',
                'intellectual-property' => 'الملكية الفكرية',
                'limitation-of-liability' => 'تحديد المسؤولية',
                'indemnification' => 'التعويض',
                'data-processing' => 'معالجة البيانات',
                'termination' => 'الإنهاء',
                'changes' => 'التعديلات على الشروط',
                'governing-law' => 'القانون الحاكم',
            ],
        ],
        'privacy' => [
            'page_title' => 'سياسة الخصوصية للمنصة',
            'title' => 'سياسة الخصوصية للمنصة',
            'subtitle' => 'كيف يتعامل مشروع نكسس مع البيانات على مستوى بنية المنصة',
            'meta_title' => 'سياسة خصوصية المنصة',
            'meta_description' => 'كيف تجمع منصة NEXUS وتعالج وتحمي بياناتك الشخصية.',
            'link_label' => 'سياسة الخصوصية للمنصة',
            'sections' => [
                'introduction' => 'مقدمة',
                'controller-processor' => 'المتحكم في البيانات مقابل المعالج',
                'data-collected' => 'البيانات التي نجمعها على مستوى المنصة',
                'legal-basis' => 'الأساس القانوني للمعالجة',
                'data-sharing' => 'مشاركة البيانات',
                'international-transfers' => 'نقل البيانات دوليًا',
                'retention' => 'الاحتفاظ بالبيانات',
                'your-rights' => 'حقوقك بموجب اللائحة العامة لحماية البيانات (GDPR)',
                'security' => 'إجراءات الأمان',
                'contact' => 'التواصل',
            ],
        ],
        'disclaimer' => [
            'page_title' => 'إخلاء مسؤولية المنصة',
            'title' => 'إخلاء مسؤولية المنصة',
            'subtitle' => 'إخلاءات المسؤولية الهامة وقيود المسؤولية لمنصة مشروع نكسس',
            'meta_title' => 'إخلاء مسؤولية المنصة',
            'meta_description' => 'إخلاءات مسؤولية مهمة حول استخدام منصة NEXUS لتبادل الوقت.',
            'link_label' => 'إخلاء مسؤولية المنصة',
            'sections' => [
                'no-warranty' => 'إخلاء من الضمانات',
                'no-advice' => 'لا تقدَّم أي مشورة قانونية أو مالية أو تنظيمية',
                'operator-independence' => 'استقلالية مشغّلي المجتمع',
                'member-interactions' => 'التفاعلات بين الأعضاء',
                'content-uploads' => 'المحتوى والملفات المرفوعة',
                'identity-verification' => 'التحقق من الهوية',
                'third-party' => 'خدمات الأطراف الثالثة',
                'limitation-of-liability' => 'تحديد المسؤولية',
            ],
        ],
    ],
    'hub' => [
        'section_title' => 'موفر المنصة قانوني',
        'section_desc' => 'تحكم هذه المستندات البنية الأساسية لمنصة Project NEXUS وهي منفصلة عن سياسات مجتمعك.',
        'terms' => 'شروط المنصة',
        'privacy' => 'خصوصية المنصة',
        'disclaimer' => 'إخلاء المسؤولية',
    ],
];
