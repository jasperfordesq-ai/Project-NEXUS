<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Group exchange messages shown to members (hour splits, the community fund).
return [
    'problem' => [
        'split_type_invalid' => 'Roghnaigh ceann de na cúig chineál malartú grúpa.',
        'no_givers' => 'Cuir duine amháin ar a laghad leis atá ag tabhairt ama.',
        'no_receivers' => 'Cuir duine amháin ar a laghad leis atá ag fáil ama.',
        'hours_missing' => 'Tabhair líon uaireanta níos mó ná nialas do gach duine.',
        'earned_exceeds_paid' => 'Thuillfeadh na daoine atá ag tabhairt ama :earned uair an chloig, ach ní íocfadh na daoine atá ag freastal ach :paid. I gceardlann nó i rang, íocann gach duine a fhreastalaíonn as an am a fhaigheann siad, mar sin caithfidh siad an méid a thuilltear ar a laghad a íoc. Má tá roinnt daoine ag tabhairt a gcuid ama do dhuine amháin, roghnaigh “Foireann ag cabhrú le duine” ina ionad.',
        'unbalanced' => 'Caithfidh na huaireanta a thuilltear (:earned) a bheith mar an gcéanna leis na huaireanta a íoctar (:paid). Athraigh cuid de na huimhreacha ionas go mbeidh siad cothrom.',
        'too_many_participants' => 'Ní féidir níos mó ná :max duine a bheith i malartú grúpa.',
    ],
    'ledger' => [
        'to_fund' => 'Malartú grúpa “:title” — uaireanta fágtha chuig an gCiste Pobail',
    ],
    'fund' => [
        'description' => 'Uaireanta fágtha ón malartú grúpa “:title”',
    ],
];
