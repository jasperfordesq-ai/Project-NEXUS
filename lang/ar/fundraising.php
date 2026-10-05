<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'campaign_not_found' => 'تعذّر العثور على حملة جمع التبرعات هذه.',
    'organisation_locked' => 'تلقّت هذه الحملة تبرعات بالفعل، لذا لم يعد من الممكن تغيير المنظمة التي تجمع لها الأموال.',
    'organisation_not_eligible' => 'لا يمكن إلا للمنظمات المعتمدة تنظيم حملات لجمع التبرعات.',
    'not_your_campaign' => 'يمكنك إدارة حملات منظمتك فقط.',
    'handover_not_found' => 'تعذّر العثور على عملية التسليم هذه.',
    'handover_amount_positive' => 'أدخل مبلغًا أكبر من صفر.',
    'handover_exceeds_held' => 'هذا أكثر مما لا تزال هذه الحملة تحتفظ به (:held).',
    'handover_method_invalid' => 'اختر طريقة تسليم المال.',
    'handover_reference_required' => 'أدخل مرجع الدفع حتى يمكن تتبّع التحويل.',
    'handover_date_invalid' => 'أدخل تاريخ تسليم المال. لا يمكن أن يكون في المستقبل.',
    'handover_campaign_has_no_organisation' => 'هذه الحملة للمجتمع بأكمله، لذا لا توجد منظمة يُسلَّم إليها المال.',
    'handover_already_closed' => 'تم تأكيد عملية التسليم هذه أو إلغاؤها بالفعل.',
    'cancel_reason_required' => 'اذكر سبب إلغاء عملية التسليم هذه.',
    'email' => [
        'handover_subject' => 'سلّم :community مبلغ :amount من حملة :campaign',
        'handover_title' => 'تم تسليم المال إلى :organisation',
        'handover_body' => 'سجّل :community تسليم مبلغ :amount الذي جمعته حملة ":campaign" بتاريخ :date (المرجع :reference). يُرجى التحقق من وصوله وتأكيد ذلك في لوحة تحكم منظمتك.',
        'handover_cta' => 'تأكيد الاستلام',
        'handover_bell' => 'سلّم :community مبلغ :amount من حملة :campaign. يُرجى تأكيد وصوله.',
    ],
];
