<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/ar/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'المطورون',
    'meta_description' => 'استكشف واجهة برمجة تطبيقات شركاء NEXUS لمصادقة OAuth2، ونقاط النهاية المحددة النطاق، وخطافات الويب الموقعة، والوصول إلى التكامل.',
    'hero_title' => 'ابنِ مع NEXUS',
    'hero_subtitle' => 'واجهة REST API مختارة لشركاء البنوك والدفع والإدارة البلدية. OAuth2 Client Credentials وWebhooks موقّعة وبيئة اختبار يمكنك الوصول إليها خلال خمس دقائق.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'مصادقة من خادم إلى خادم. رموز bearer قصيرة العمر، نطاق لكل شريك.',
    'feature_curated_title' => 'مجموعة نقاط نهاية مختارة',
    'feature_curated_body' => 'فقط ما تحتاجه البنوك وأنظمة الإدارة فعلًا: المستخدمون، الإعلانات، المحفظة، التجميعات.',
    'feature_webhooks_title' => 'Webhooks موقّعة',
    'feature_webhooks_body' => 'توقيعات HMAC-SHA256، إعادة محاولة تلقائية، حالة التسليم في لوحة التحكم.',
    'feature_rate_limit_title' => 'حدود معدل لكل شريك',
    'feature_rate_limit_body' => 'حصص في الدقيقة قابلة للتهيئة. تتضمن استجابات 429 رأس Retry-After.',
    'request_access_cta' => 'طلب الوصول',
    'request_access_body' => 'يوفّر مسؤول المجتمع الوصول إلى Partner API. تواصل معه للحصول على زوج client_id / client_secret.',
    'nav' => [
        'overview' => 'نظرة عامة',
        'auth' => 'المصادقة',
        'endpoints' => 'نقاط النهاية',
        'webhooks' => 'خطافات الويب',
    ],
    'auth_meta_title' => 'مصادقة API',
    'auth_intro' => 'بدّل بيانات اعتماد العميل بـ bearer token قصير العمر، ثم ألحقه بكل طلب بصيغة Authorization: Bearer <token>.',
    'auth_step1_title' => '1. احصل على بيانات اعتماد العميل',
    'auth_step1_body' => 'يوفّر مسؤول مجتمعك client_id وclient_secret في وحدة تحكم الإدارة. يُعرض الـ secret مرة واحدة فقط عند الإنشاء.',
    'auth_step2_title' => '2. بدّلها برمز',
    'auth_step2_body' => 'أرسل بيانات الاعتماد عبر POST إلى /api/partner/v1/oauth/token. تتضمن الاستجابة access_token وexpires_in (3600 ثانية) والـ scope الممنوح.',
    'auth_step3_title' => '3. استدعِ الـ API',
    'auth_step3_body' => 'ألحق الرمز في رأس Authorization. الرموز محددة النطاق — ستُعيد الـ API الخطأ 403 insufficient_scope إذا تجاوزت صلاحيتك.',
    'tabs' => [
        'code_examples' => 'أمثلة على التعليمات البرمجية',
        'verification_examples' => 'أمثلة التحقق',
    ],
    'curl_example' => 'مثال curl',
    'js_example' => 'مثال JavaScript',
    'endpoints_meta_title' => 'نقاط نهاية API',
    'endpoints_intro' => 'نقاط نهاية REST مختارة. جميع المسارات تبدأ بـ /api/partner/v1. كل الاستجابات بصيغة JSON مع رأس API-Version: 2.0.',
    'endpoints_table_aria' => 'نقاط نهاية API الشريكة',
    'method_label' => 'الطريقة',
    'path_label' => 'المسار',
    'scope_label' => 'النطاق',
    'description_label' => 'الوصف',
    'endpoint_descriptions' => [
        'oauth_token' => 'تبادل بيانات اعتماد العميل برمز حامل (منح client_credentials).',
        'oauth_revoke' => 'إبطال رمز حامل صادر (RFC 7009).',
        'users_list' => 'عرض الأعضاء النشطين. أضف نطاق users.pii لتلقي البريد الإلكتروني.',
        'users_detail' => 'جلب عضو واحد بواسطة المعرّف.',
        'listings_list' => 'عرض القوائم النشطة (الخدمات والطلبات).',
        'wallet_balance' => 'قراءة رصيد ساعات الوقت للعضو.',
        'wallet_credit' => 'إضافة ساعات وقت من تحويل بنكي مسوّى. الجسم: user_id، hours، reference، note?',
        'aggregates_community' => 'إجماليات المجتمع المُجمَّعة (بدون معلومات شخصية). مفيدة للوحات الشركاء.',
        'webhooks_list' => 'عرض اشتراكات خطافات الويب الخاصة بك.',
        'webhooks_create' => 'الاشتراك في الأحداث. الجسم: event_types[]، target_url (https://).',
    ],
    'webhooks_meta_title' => 'خطافات ويب API',
    'webhooks_intro' => 'اشترك في الأحداث عبر روابط callback بصيغة HTTPS. يتضمن كل تسليم رأس X-Partner-Signature — وهو HMAC-SHA256 للجسم الخام موقّع بـ secret الاشتراك المُعاد عند الإنشاء.',
    'webhook_events_title' => 'الأحداث المتاحة',
    'webhook_event_wallet_credited' => 'wallet.credited — يُطلق عندما يضيف شريك ساعات وقت عبر /wallet/credit',
    'webhook_create_title' => 'إنشاء اشتراك',
    'webhook_create_body' => 'أرسل POST إلى /api/partner/v1/webhooks/subscriptions مع event_types (مصفوفة) وtarget_url (https فقط). تتضمن الاستجابة secret لمرة واحدة — احتفظ به.',
    'webhook_signing_title' => 'التحقق من التواقيع',
    'webhook_signing_body' => 'احسب HMAC-SHA256 لجسم الطلب الخام باستخدام secret الاشتراك. قارنه مع رأس X-Partner-Signature بزمن ثابت.',
];
