<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Accessible Explore page (web-uk) — parity with React's ExplorePage.
// Most strings reuse react-frontend/public/locales/<locale>/explore.json.

return [
    'tabs_label' => 'استكشاف علامات المحتوى',
    'tabs' => [
        'all' => 'الكل',
        'for_you' => 'لك',
        'listings' => 'القوائم',
        'people' => 'الأشخاص',
        'events' => 'الفعاليات',
        'groups' => 'المجموعات',
    ],
    'search_label' => 'اكتشف المهارات، والفعاليات، والمجموعات',
    'search_button' => 'بحث',
    'categories_heading' => 'تصفّح القوائم حسب الفئة',
    'see_all' => 'عرض الكل',
    'stats' => [
        'heading' => 'مجتمعك بالأرقام',
        'members' => 'الأعضاء',
        'exchanges_this_month' => 'التبادلات هذا الشهر',
        'hours_exchanged' => 'الساعات المتبادلة',
        'active_listings' => 'القوائم النشطة',
    ],
    'sections' => [
        'trending_posts' => [
            'title' => 'المشاركات الرائجة',
            'subtitle' => 'أكثر المشاركات تفاعلاً هذا الأسبوع',
        ],
        'popular_listings' => [
            'title' => 'القوائم الشائعة',
            'subtitle' => 'أكثر العروض والطلبات مشاهدة',
        ],
        'upcoming_events' => [
            'title' => 'الفعاليات القادمة',
            'subtitle' => 'انضم إلى مجتمعك',
        ],
        'active_groups' => [
            'title' => 'المجموعات النشطة',
            'subtitle' => 'تواصل مع أعضاء ذوي اهتمامات مشابهة',
        ],
        'top_contributors' => [
            'title' => 'أفضل المساهمين',
            'subtitle' => 'قادة المجتمع حسب الخبرة',
        ],
        'trending_hashtags' => [
            'title' => 'الهاشتاجات الرائجة',
            'subtitle' => 'المواضيع الشائعة في مجتمعك',
        ],
        'recommended' => [
            'title' => 'موصى به لك',
            'subtitle' => 'استنادًا إلى اهتماماتك ونشاطك',
        ],
        'near_you' => [
            'title' => 'قريب منك',
            'subtitle' => 'قوائم قريبة من موقعك',
        ],
        'suggested_connections' => [
            'title' => 'أشخاص قد تعرفهم',
            'subtitle' => 'تواصل مع الأعضاء الذين يشاركونك اهتماماتك',
        ],
        'blog_posts' => [
            'title' => 'من المدونة',
            'subtitle' => 'أحدث القصص من مجتمعك',
        ],
        'volunteering' => [
            'title' => 'فرص التطوع',
            'subtitle' => 'أحدث فرقًا في مجتمعك',
        ],
        'polls' => [
            'title' => 'استطلاعات نشطة',
            'subtitle' => 'أدلي برأيك حول مواضيع المجتمع',
        ],
        'in_demand_skills' => [
            'title' => 'المهارات المطلوبة',
            'subtitle' => 'أكثر المهارات طلبًا في مجتمعك',
        ],
        'organisations' => [
            'title' => 'المنظمات',
            'subtitle' => 'شركاء المجتمع الذين يحدثون تأثيرًا',
        ],
        'jobs' => [
            'title' => 'فرص العمل',
            'subtitle' => 'أحدث الوظائف من شركاء المجتمع',
        ],
        'resources' => [
            'title' => 'الموارد المميزة',
            'subtitle' => 'أدلة ومواد لمجتمعك',
        ],
        'new_members' => [
            'title' => 'مرحبًا بأحدث أعضائنا',
            'subtitle' => 'قل مرحبًا للمنضمين الجدد',
        ],
        'featured_challenges' => [
            'title' => 'التحديات المميزة',
            'subtitle' => 'شارك أفكارك واصنع تأثيرًا',
        ],
    ],
    'meta' => [
        'attending' => ':count يحضر',
        'members' => ':count أعضاء',
        'level' => 'المستوى :level',
        'match' => ':score% تطابق',
        'by_author' => 'بواسطة :name',
        'distance' => ':distance كم بعيد',
        'read_time' => ':count دقيقة قراءة',
        'applications' => ':count تقدم',
        'votes' => ':count أصوات',
        'closes' => 'يغلق :date',
        'requesting' => ':count يطلب',
        'offering' => ':count يقدم',
        'opportunities' => ':count فرص',
        'deadline' => 'الموعد النهائي: :date',
        'ideas' => ':count أفكار',
        'ends' => 'ينتهي :date',
    ],
    'content_types' => [
        'listing' => 'قائمة',
        'post' => 'منشور',
        'event' => 'فعالية',
        'group' => 'مجموعة',
        'member' => 'عضو',
        'blog' => 'مقالة مدونة',
    ],
    'dismiss' => 'غير مهتم',
    'dismissed' => 'لن نوصي لك بهذه القائمة مرة أخرى.',
    'dismiss_failed' => 'تعذّر إخفاء هذه التوصية. حاول مرة أخرى لاحقًا.',
    'for_you' => [
        'empty' => 'تفاعل مع القوائم، المنشورات، والفعاليات للحصول على توصيات مخصصة.',
        'end_of_feed' => 'لقد انتهيت من كل شيء!',
        'load_more' => 'عرض المزيد من التوصيات',
        'load_error' => 'تعذّر تحميل توصياتك الشخصية. حاول مرة أخرى لاحقًا.',
    ],
    'load_error' => 'تعذّر تحميل أقسام الاستكشاف. قد تكون هذه مشكلة مؤقتة. حاول مرة أخرى لاحقًا.',
    'empty' => [
        'listings' => 'لا توجد قوائم لعرضها بعد. كن الأول في إنشاء واحدة!',
        'people' => 'لا توجد أعضاء لعرضهم بعد. ادعُ شخصًا للانضمام!',
        'events' => 'لا توجد فعاليات قادمة. أنشئ واحدة لجمع مجتمعك معًا!',
        'groups' => 'لا توجد مجموعات نشطة بعد. ابدأ مجموعة حول اهتماماتك!',
    ],
    'create_listing' => 'إنشاء قائمة',
    'create_group' => 'إنشاء مجموعة',
];
