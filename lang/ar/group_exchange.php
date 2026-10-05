<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'اختر أحد الأنواع الخمسة للتبادل الجماعي.',
        'no_givers' => 'أضف شخصًا واحدًا على الأقل يقدّم الوقت.',
        'no_receivers' => 'أضف شخصًا واحدًا على الأقل يتلقّى الوقت.',
        'hours_missing' => 'أدخل لكل شخص عدد ساعات أكبر من الصفر.',
        'earned_exceeds_paid' => 'سيكسب مقدّمو الوقت :earned ساعة، لكن الحاضرين سيدفعون :paid فقط. في الورشة أو الدرس يدفع كل حاضر مقابل الوقت الذي يتلقّاه، لذا يجب أن يدفعوا على الأقل ما يُكسَب. إذا كان عدة أشخاص يقدّمون وقتهم لشخص واحد، فاختر «فريق يساعد شخصًا» بدلًا من ذلك.',
        'unbalanced' => 'يجب أن تساوي الساعات المكتسبة (:earned) الساعات المدفوعة (:paid). غيّر بعض الأرقام حتى تتطابق.',
        'too_many_participants' => 'يمكن أن يضم التبادل الجماعي :max شخصًا كحد أقصى.',
    ],
    'ledger' => [
        'to_fund' => 'التبادل الجماعي «:title» — الساعات المتبقية إلى صندوق المجتمع',
    ],
    'fund' => [
        'description' => 'الساعات المتبقية من التبادل الجماعي «:title»',
    ],
];
