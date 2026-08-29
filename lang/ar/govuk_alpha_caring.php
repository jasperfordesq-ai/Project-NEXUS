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
        'service_name' => 'مجتمع الرعاية',
        'back_to_caring' => 'العودة إلى مجتمع الرعاية',
        'back_to_caregiver' => 'العودة إلى علاقات الرعاية الخاصة بك',
        'success_title' => 'نجاح',
        'error_title' => 'هناك مشكلة',
        'unknown_member' => 'عضو غير معروف',
        'optional' => '(خياري)',
    ],
    'hub' => [
        'title' => 'مجتمع الرعاية',
        'caption' => 'الرعاية والدعم',
        'intro' => 'قم بترتيب رعاية منتظمة لعضو آخر، أو قم بالإجابة على طلب من شخص طلب العناية بك.',
        'caregiver_card_title' => 'علاقات الرعاية الخاصة بك',
        'caregiver_card_description' => 'اطلع على العلاقات التي طلبتها، وأجب عن الطلبات المتعلقة بك، واستخدم الأدوات التي تفتحها العلاقة المعتمدة.',
        'become_title' => 'كن مقدم رعاية',
        'become_description' => 'اطلب تقديم رعاية منتظمة لعضو آخر في هذا المجتمع. لا شيء يصبح ساري المفعول إلا بعد موافقتهم وفحص الموظفين.',
    ],
    'caregiver' => [
        'title' => 'علاقات الرعاية الخاصة بك',
        'caption' => 'مجتمع الرعاية',
        'intro' => 'العلاقات التي طلبتها، ومرحلتها الحالية.',
        'none' => 'لم تطلب رعاية أي شخص حتى الآن.',
        'become_button' => 'اطلب رعاية شخص ما',
        'incoming_title' => 'طلبات عنك',
        'incoming_intro' => 'لقد طلب هؤلاء الأعضاء الاعتناء بك. توافق فقط إذا فهمت وتقبلت ما يعنيه.',
        'incoming_explanation' => 'إذا وافقت، فسيقوم الموظفون بعد ذلك بفحص الطلب قبل بدء العلاقة. الموافقة لا تبدأ من تلقاء نفسها.',
        'incoming_none' => 'لم يطلب أحد أن يعتني بك.',
        'confirm_button' => 'أنا أوافق على هذه العلاقة',
        'reject_button' => 'أنا لا أوافق',
        'status_heading' => 'منصة',
        'status_pending_recipient' => 'في انتظار موافقة العضو الآخر',
        'status_pending_staff' => 'في انتظار فحص حماية الموظفين',
        'status_active' => 'تمت الموافقة عليه ونشط',
        'status_rejected' => 'غير معتمد',
        'status_inactive' => 'انتهى',
        'relationship_heading' => 'علاقة',
        'relationship_family' => 'عائلة',
        'relationship_friend' => 'صديق',
        'relationship_neighbour' => 'جار',
        'relationship_professional' => 'مقدم رعاية محترف',
        'started_heading' => 'بدأت الرعاية',
        'reason_heading' => 'السبب المعطى',
        'pending_no_tools' => 'أثناء انتظار الطلب، لا يتيح لك الوصول إلى تفاصيل رعاية هذا العضو.',
        'active_tools_title' => 'ما تتيح لك هذه العلاقة القيام به',
        'request_on_behalf_link' => 'اطلب المساعدة نيابة عن هذا العضو',
    ],
    'link' => [
        'title' => 'اطلب رعاية شخص ما',
        'caption' => 'مجتمع الرعاية',
        'intro' => 'اطلب تقديم رعاية منتظمة لعضو آخر في هذا المجتمع.',
        'consent_warning' => 'سيتم سؤال العضو الذي تسميه عما إذا كان موافقًا. سيقوم الموظفون بعد ذلك بالتحقق من الطلب. العلاقة لا تبدأ، ولا تعطيك شيئًا، حتى يحدث كلاهما.',
        'search_label' => 'ابحث عن العضو الذي تريد الاعتناء به',
        'search_hint' => 'أدخل جزءًا من أسمائهم، ثم اخترهم من النتائج.',
        'search_button' => 'يبحث',
        'results_title' => 'اختر عضوا',
        'results_none' => 'لم يطابق أي عضو هذا الاسم. حاول تهجئة مختلفة.',
        'choose_button' => 'يختار',
        'chosen_label' => 'العضو الذي اخترته',
        'change_button' => 'يتغير',
        'relationship_label' => 'علاقتك بهم',
        'start_date_label' => 'تاريخ بدء الرعاية أو تاريخ البدء فيها',
        'start_date_hint' => 'على سبيل المثال، 27 3 2026',
        'notes_label' => 'أي شيء يجب أن يعرفه الموظفون',
        'notes_hint' => 'خياري. ويظهر ذلك للموظف الذي يقوم بالتحقق من الطلب.',
        'submit_button' => 'إرسال الطلب',
        'error_no_member' => 'اختر العضو الذي تريد الاعتناء به',
        'error_no_relationship' => 'حدد علاقتك بهم',
        'error_no_start_date' => 'أدخل التاريخ الذي بدأت فيه الرعاية أو ستبدأ',
        'error_bad_start_date' => 'أدخل تاريخًا حقيقيًا، على سبيل المثال 27 3 2026',
        'error_search_too_short' => 'أدخل حرفين على الأقل للبحث',
    ],
    'on_behalf' => [
        'title' => 'اطلب المساعدة نيابة عن شخص ما',
        'intro' => 'اطلب من المجتمع المساعدة العملية للعضو الذي تهتم به. يتم تسجيل الطلب باسمهم، ويوضح أنك قمت بذلك.',
        'for_member' => 'هذا الطلب ل',
        'title_label' => 'ما هي المساعدة المطلوبة',
        'title_hint' => 'على سبيل المثال، المصعد إلى موعد في المستشفى.',
        'description_label' => 'مزيد من التفاصيل',
        'when_label' => 'عندما تكون هناك حاجة لذلك',
        'contact_label' => 'كيف يجب أن يتواصل المساعدون',
        'contact_phone' => 'عن طريق الهاتف',
        'contact_message' => 'بالرسالة',
        'contact_either' => 'إما على ما يرام',
        'submit_button' => 'إرسال الطلب',
        'error_no_title' => 'أدخل ما هي المساعدة المطلوبة',
        'error_not_active' => 'يمكنك فقط طلب المساعدة نيابة عن العضو الذي تمت الموافقة على علاقته',
    ],
    'review' => [
        'title' => 'يطلب مقدم الرعاية التحقق',
        'caption' => 'مجتمع الرعاية',
        'intro' => 'تحقق من موافقة متلقي الرعاية، وسجل كيفية التحقق من ذلك، قبل الموافقة على علاقة الرعاية.',
        'none' => 'لا توجد طلبات لمقدمي الرعاية في انتظار التحقق منها.',
        'requested_by' => 'طلب بواسطة',
        'requested_for' => 'لرعاية',
        'requested_on' => 'طلب على',
        'recipient_agreed' => 'وقد وافق العضو',
        'recipient_not_agreed' => 'ولم يوافق العضو بعد',
        'blocked_until_agreed' => 'لا يمكنك الموافقة على هذا الطلب إلا بعد موافقة العضو عليه.',
        'evidence_label' => 'كيف تأكدت من موافقتهم',
        'evidence_hint' => 'على سبيل المثال، مكالمة هاتفية بتاريخ 27 مارس 2026 مع الأعضاء أنفسهم.',
        'attestation_label' => 'أؤكد أنني تحققت من موافقة هذا العضو بنفسي',
        'approve_button' => 'الموافقة على العلاقة',
        'reject_label' => 'لماذا ترفض هذا الطلب',
        'reject_hint' => 'يتم تسجيل ذلك وعرضه على العضو الذي طلب ذلك.',
        'reject_button' => 'رفض الطلب',
        'decided_approved' => 'موافقة',
        'decided_rejected' => 'رفض',
        'error_no_evidence' => 'أدخل كيف قمت بالتحقق من موافقتهم',
        'error_no_attestation' => 'تأكد من أنك قمت بالتحقق من موافقة هذا العضو بنفسك',
        'error_no_reason' => 'أدخل سبب رفضك لهذا الطلب',
    ],
    'status' => [
        'link_requested' => 'لقد تم إرسال طلبك. إنه في انتظار موافقة العضو الآخر، ثم فحص الموظفين.',
        'link_failed' => 'لا يمكن إرسال طلبك.',
        'link_duplicate' => 'لديك بالفعل طلب أو علاقة معتمدة مع هذا العضو.',
        'incoming_confirmed' => 'لقد وافقت. سيقوم الموظفون الآن بفحص الطلب قبل بدء العلاقة.',
        'incoming_rejected' => 'لقد رفضت. لم يتم إنشاء أي علاقة.',
        'incoming_failed' => 'لا يمكن حفظ إجابتك.',
        'review_approved' => 'تمت الموافقة على علاقة الرعاية.',
        'review_rejected' => 'تم رفض الطلب.',
        'review_not_agreed' => 'لا يمكن الموافقة على هذا الطلب لأن العضو لم يوافق عليه.',
        'review_failed' => 'لا يمكن حفظ هذا القرار.',
        'review_not_found' => 'لا يمكن العثور على هذا الطلب في هذا المجتمع.',
        'on_behalf_sent' => 'تم إرسال طلب المساعدة.',
        'on_behalf_failed' => 'لا يمكن إرسال طلب المساعدة.',
    ],
];
