<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'لا يمكن مراجعة بيانات التسجيل لحذفها إلا بعد انتهاء الفعالية. اختر تاريخًا بعد نهاية الفعالية.',
        'settings_required' => 'احفظ إعدادات التسجيل لهذه الفعالية أولًا. فهي تحدد مدة الاحتفاظ ببيانات التسجيل.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'لقد مضى وقت الإرسال هذا بالفعل. اختر وقتًا في المستقبل أو أرسل الرسالة الآن.',
        'post_event_too_early' => 'لا يمكن إرسال رسالة ما بعد الفعالية إلا بعد انتهائها. اختر وقتًا بعد نهاية الفعالية.',
        'audience_empty' => 'لن يتلقى أحد هذه الرسالة. اختر جمهورًا يضم شخصًا واحدًا على الأقل.',
        'channel_empty' => 'اختر طريقة واحدة على الأقل لإرسال هذه الرسالة.',
        'body_invalid' => 'اكتب رسالة لا تتجاوز :max حرفًا.',
    ],
];
