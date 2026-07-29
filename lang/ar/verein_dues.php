<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'invalid_fee_amount' => 'يجب أن يكون مبلغ الرسوم أكبر من الصفر.',
        'invalid_billing_cycle' => 'يجب أن تكون دورة الفوترة واحدة من: سنوية، كل سنتين، شهرية.',
        'fee_not_configured' => 'لم يتم تكوين أي رسوم عضوية نشطة لهذا Verein.',
        'organization_not_found' => 'لم يتم العثور على فيرين.',
        'organization_not_club' => 'هذه المنظمة ليست Verein.',
        'organization_required' => 'معرف_المنظمة مطلوب.',
        'dues_not_found' => 'لم يتم العثور على سجل مستحقات العضوية.',
        'cannot_waive_paid' => 'لا يمكن التنازل عن صف المستحقات التي تم دفعها بالفعل.',
        'cannot_remind_status' => 'لا يمكن إرسال التذكيرات إلا للمستحقات المعلقة أو المتأخرة.',
        'cannot_pay_status' => 'صف المستحقات هذا ليس في حالة مستحقة الدفع.',
        'payment_intent_failed' => 'لا يمكن بدء عملية الدفع. يرجى المحاولة مرة أخرى في وقت لاحق.',
        'waive_reason_required' => 'يشترط وجود سبب للتنازل.',
    ],
];
