<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'retention' => [
        'post_event_only' => 'Ní féidir sonraí clárúcháin a athbhreithniú lena scriosadh go dtí go mbeidh an ócáid thart. Roghnaigh dáta tar éis dheireadh na hócáide.',
        'settings_required' => 'Sábháil socruithe clárúcháin na hócáide seo ar dtús. Socraíonn siad cá fhad a choinnítear sonraí clárúcháin.',
    ],
    'broadcast' => [
        'schedule_in_past' => 'Tá an t-am seolta sin caite cheana féin. Roghnaigh am amach anseo, nó seol an teachtaireacht anois.',
        'post_event_too_early' => 'Ní féidir teachtaireacht le haghaidh tar éis na hócáide a sheoladh go dtí go mbeidh an ócáid thart. Roghnaigh am tar éis dheireadh na hócáide.',
        'audience_empty' => 'Ní bhfaigheadh aon duine an teachtaireacht seo. Roghnaigh grúpa faighteoirí ina bhfuil duine amháin ar a laghad.',
        'channel_empty' => 'Roghnaigh bealach amháin ar a laghad chun an teachtaireacht seo a sheoladh.',
        'body_invalid' => 'Scríobh teachtaireacht nach mó ná :max carachtar í.',
        'version_conflict' => 'Athraíodh an teachtaireacht seo in áit eile tar éis don leathanach lódáil. Athnuaigh an leathanach, seiceáil í agus bain triail eile as.',
        'transition_invalid' => 'Tá an teachtaireacht seo bogtha ar aghaidh cheana: d\'fhéadfadh sí a bheith á seoladh nó seolta cheana. Athnuaigh an leathanach le feiceáil cá bhfuil sí.',
        'cancel_after_send_forbidden' => 'Tá tús curtha leis an seoladh cheana, mar sin ní féidir an teachtaireacht seo a chealú a thuilleadh.',
        'idempotency_conflict' => 'Is cosúil gur athdhéanamh é seo ar iarracht níos luaithe le sonraí difriúla. Athnuaigh an leathanach agus seiceáil an bhfuil an teachtaireacht ann cheana.',
        'authorization_denied' => 'Níl cead agat teachtaireachtaí a sheoladh don imeacht seo. Iarr ar eagraí an imeachta tú a chur le foireann an imeachta.',
    ],
];
