<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Caring Community — naisc chúramóra, comhéadan inrochtana.
 *
 * 🔴 AUTHORED DIRECTLY, NOT MACHINE-TRANSLATED, AND AWAITING NATIVE REVIEW.
 *
 * `scripts/translate-php-lang-gaps.mjs` is Google-only and always skips `ga`,
 * because Google's Irish output is not approved for release. The documented
 * workflow (.github/LOCALIZATION_WORKFLOW.md) is to "author and review PHP
 * Irish directly", and to report the gap rather than present machine Irish as
 * complete. These strings were authored directly and no native reviewer was
 * available, so they are a reviewed-pending draft: correct enough to ship the
 * journey, and flagged for a native speaker to confirm.
 *
 * Terminology is deliberately taken from the ALREADY-TRANSLATED Irish React
 * catalogue for this same journey
 * (react-frontend/public/locales/ga/caring_community.json), so a member does not
 * meet two different Irish words for one thing across the two frontends:
 *   caregiver link  → nasc cúramóra
 *   care recipient  → faighteoir cúraim
 *   consent         → toiliú
 *   consent evidence→ fianaise ar thoiliú
 *   safeguarding    → cosaint
 */

return [
    'shared' => [
        'service_name' => 'Pobal Cúraim',
        'back_to_caring' => 'Ar ais go dtí an Pobal Cúraim',
        'back_to_caregiver' => 'Ar ais go dtí do chaidrimh chúraim',
        'success_title' => 'D\'éirigh leis',
        'error_title' => 'Tá fadhb ann',
        'unknown_member' => 'Ball anaithnid',
        'optional' => '(roghnach)',
    ],

    'hub' => [
        'title' => 'Pobal Cúraim',
        'caption' => 'Cúram agus tacaíocht',
        'intro' => 'Socraigh cúram rialta do bhall eile, nó freagair iarratas ó dhuine a d\'iarr cúram a thabhairt duit.',
        'caregiver_card_title' => 'Do chaidrimh chúraim',
        'caregiver_card_description' => 'Féach ar na caidrimh a d\'iarr tú, freagair iarratais fút, agus bain úsáid as na huirlisí a osclaíonn caidreamh ceadaithe.',
        'become_title' => 'Bí i do chúramóir',
        'become_description' => 'Iarr cúram rialta a chur ar fáil do bhall eile den phobal seo. Ní thagann aon rud i bhfeidhm go dtí go n-aontaíonn siad agus go ndéanann an fhoireann seiceáil.',
    ],

    'caregiver' => [
        'title' => 'Do chaidrimh chúraim',
        'caption' => 'Pobal Cúraim',
        'intro' => 'Na caidrimh a d\'iarr tú, agus an chéim ina bhfuil siad faoi láthair.',
        'none' => 'Níor iarr tú cúram a thabhairt d\'aon duine go fóill.',
        'become_button' => 'Iarr cúram a thabhairt do dhuine',

        'incoming_title' => 'Iarratais fútsa',
        'incoming_intro' => 'D\'iarr na baill seo cúram a thabhairt duit. Ná haontaigh ach amháin má thuigeann tú agus má ghlacann tú lena bhfuil i gceist.',
        'incoming_explanation' => 'Má aontaíonn tú, déanfaidh an fhoireann seiceáil ar an iarratas sula dtosaíonn an caidreamh. Ní chuireann do thoiliú féin tús leis.',
        'incoming_none' => 'Níor iarr aon duine cúram a thabhairt duit.',
        'confirm_button' => 'Aontaím leis an gcaidreamh seo',
        'reject_button' => 'Ní aontaím',

        'status_heading' => 'Céim',
        'status_pending_recipient' => 'Ag fanacht leis an mball eile aontú',
        'status_pending_staff' => 'Ag fanacht le seiceáil chosanta ón bhfoireann',
        'status_active' => 'Ceadaithe agus gníomhach',
        'status_rejected' => 'Gan cheadú',
        'status_inactive' => 'Críochnaithe',

        'relationship_heading' => 'Caidreamh',
        'relationship_family' => 'Duine den teaghlach',
        'relationship_friend' => 'Cara',
        'relationship_neighbour' => 'Comharsa',
        'relationship_professional' => 'Cúramóir gairmiúil',

        'started_heading' => 'Thosaigh an cúram',
        'reason_heading' => 'An chúis a tugadh',
        'pending_no_tools' => 'Fad is atá iarratas ag fanacht, ní thugann sé aon rochtain duit ar shonraí cúraim an bhaill seo.',
        'active_tools_title' => 'Na rudaí is féidir leat a dhéanamh leis an gcaidreamh seo',
        'request_on_behalf_link' => 'Iarr cabhair thar ceann an bhaill seo',
    ],

    'link' => [
        'title' => 'Iarr cúram a thabhairt do dhuine',
        'caption' => 'Pobal Cúraim',
        'intro' => 'Iarr cúram rialta a chur ar fáil do bhall eile den phobal seo.',
        'consent_warning' => 'Fiafrófar den bhall a ainmneoidh tú an aontaíonn sé. Déanfaidh an fhoireann seiceáil ar an iarratas ansin. Ní thosaíonn an caidreamh, agus ní thugann sé aon rud duit, go dtí go mbeidh an dá rud sin déanta.',
        'search_label' => 'Aimsigh an ball ar mhaith leat cúram a thabhairt dó',
        'search_hint' => 'Cuir cuid dá ainm isteach, agus roghnaigh é ó na torthaí.',
        'search_button' => 'Cuardaigh',
        'results_title' => 'Roghnaigh ball',
        'results_none' => 'Níor aimsíodh aon bhall leis an ainm sin. Bain triail as litriú eile.',
        'choose_button' => 'Roghnaigh',
        'chosen_label' => 'An ball atá roghnaithe agat',
        'change_button' => 'Athraigh',
        'relationship_label' => 'Do chaidreamh leis',
        'start_date_label' => 'An dáta a thosaigh nó a thosóidh an cúram',
        'start_date_hint' => 'Mar shampla, 27 3 2026',
        'notes_label' => 'Aon rud ar cheart don fhoireann a bheith ar an eolas faoi',
        'notes_hint' => 'Roghnach. Taispeántar é seo don bhall foirne a dhéanann seiceáil ar an iarratas.',
        'submit_button' => 'Seol an t-iarratas',
        'error_no_member' => 'Roghnaigh an ball ar mhaith leat cúram a thabhairt dó',
        'error_no_relationship' => 'Roghnaigh do chaidreamh leis',
        'error_no_start_date' => 'Cuir isteach an dáta a thosaigh nó a thosóidh an cúram',
        'error_bad_start_date' => 'Cuir isteach fíordháta, mar shampla 27 3 2026',
        'error_search_too_short' => 'Cuir isteach dhá charachtar ar a laghad chun cuardach a dhéanamh',
    ],

    'on_behalf' => [
        'title' => 'Iarr cabhair thar ceann duine',
        'intro' => 'Iarr cabhair phraiticiúil ón bpobal don bhall a dtugann tú cúram dó. Taifeadtar an t-iarratas ina ainm, agus taispeántar gur tusa a rinne é.',
        'for_member' => 'Tá an t-iarratas seo do',
        'title_label' => 'Cén chabhair atá ag teastáil',
        'title_hint' => 'Mar shampla, síob chuig coinne ospidéil.',
        'description_label' => 'Tuilleadh sonraí',
        'when_label' => 'Cathain atá sé ag teastáil',
        'contact_label' => 'Conas ar cheart do chabhróirí teagmháil a dhéanamh',
        'contact_phone' => 'Ar an nguthán',
        'contact_message' => 'Le teachtaireacht',
        'contact_either' => 'Tá ceachtar acu ceart go leor',
        'submit_button' => 'Seol an t-iarratas',
        'error_no_title' => 'Cuir isteach cén chabhair atá ag teastáil',
        'error_not_active' => 'Ní féidir leat cabhair a iarraidh ach thar ceann baill a bhfuil a chaidreamh ceadaithe',
    ],

    'review' => [
        'title' => 'Iarratais chúramóra le seiceáil',
        'caption' => 'Pobal Cúraim',
        'intro' => 'Deimhnigh gur aontaigh an faighteoir cúraim, agus taifead conas a d\'fhíoraigh tú é, sula gceadaíonn tú caidreamh cúraim.',
        'none' => 'Níl aon iarratas cúramóra ag fanacht le seiceáil.',
        'requested_by' => 'Arna iarraidh ag',
        'requested_for' => 'Chun cúram a thabhairt do',
        'requested_on' => 'Iarrtha ar',
        'recipient_agreed' => 'Tá an ball tar éis aontú',
        'recipient_not_agreed' => 'Níl an ball tar éis aontú go fóill',
        'blocked_until_agreed' => 'Ní féidir leat an t-iarratas seo a cheadú go dtí go mbeidh an ball tar éis aontú leis.',
        'evidence_label' => 'Conas a d\'fhíoraigh tú a thoiliú',
        'evidence_hint' => 'Mar shampla, glao gutháin ar an 27 Márta 2026 leis an mball féin.',
        'attestation_label' => 'Deimhním gur fhíoraigh mé féin toiliú an bhaill seo',
        'approve_button' => 'Ceadaigh an caidreamh',
        'reject_label' => 'Cén fáth a bhfuil tú ag diúltú don iarratas seo',
        'reject_hint' => 'Taifeadtar é seo agus taispeántar don bhall a rinne an t-iarratas é.',
        'reject_button' => 'Diúltaigh don iarratas',
        'decided_approved' => 'Ceadaithe',
        'decided_rejected' => 'Diúltaithe',
        'error_no_evidence' => 'Cuir isteach conas a d\'fhíoraigh tú a thoiliú',
        'error_no_attestation' => 'Deimhnigh gur fhíoraigh tú féin toiliú an bhaill seo',
        'error_no_reason' => 'Cuir isteach cén fáth a bhfuil tú ag diúltú don iarratas seo',
    ],

    'status' => [
        'link_requested' => 'Seoladh d\'iarratas. Tá sé ag fanacht leis an mball eile aontú, agus ansin le seiceáil ón bhfoireann.',
        'link_failed' => 'Níorbh fhéidir d\'iarratas a sheoladh.',
        'link_duplicate' => 'Tá iarratas nó caidreamh ceadaithe agat leis an mball sin cheana féin.',
        'incoming_confirmed' => 'Tá tú tar éis aontú. Déanfaidh an fhoireann seiceáil ar an iarratas anois sula dtosaíonn an caidreamh.',
        'incoming_rejected' => 'Tá tú tar éis diúltú. Níor cruthaíodh aon chaidreamh.',
        'incoming_failed' => 'Níorbh fhéidir do fhreagra a shábháil.',
        'review_approved' => 'Tá an caidreamh cúraim ceadaithe.',
        'review_rejected' => 'Diúltaíodh don iarratas.',
        'review_not_agreed' => 'Ní féidir an t-iarratas sin a cheadú toisc nach bhfuil an ball tar éis aontú leis.',
        'review_failed' => 'Níorbh fhéidir an cinneadh sin a shábháil.',
        'review_not_found' => 'Níorbh fhéidir an t-iarratas sin a aimsiú sa phobal seo.',
        'on_behalf_sent' => 'Seoladh an t-iarratas ar chabhair.',
        'on_behalf_failed' => 'Níorbh fhéidir an t-iarratas ar chabhair a sheoladh.',
    ],
];
