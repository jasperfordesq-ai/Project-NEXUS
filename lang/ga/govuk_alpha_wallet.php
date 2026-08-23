<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'manage' => [
        'title' => 'Bainistigh do chreidmheasanna',
        'caption' => 'Creidmheasanna ama',
        'description' => 'Féach sracfhéachaint ar do chreidmheasanna ar feitheamh, seol creidmheasanna chuig ball, nó tabhair don chiste pobail.',
        'back_to_wallet' => 'Ar ais go dtí do sparán',
    ],
    'balance' => [
        'heading' => 'Do chothromaíocht',
        'label' => 'Iarmhéid ar fáil',
        'pending_badge_in' => '{0} Gan aon chreidmheas ar feitheamh|{1} Ar feitheamh i gceann: :count uair|[2,*] Ar feitheamh i gceann: :count uair an chloig',
        'no_pending' => 'Uimh creidmheasanna ar feitheamh',
    ],
    'stats' => [
        'heading' => 'Achoimre',
        'earned' => 'Tuillte',
        'spent' => 'Chaith',
        'pending' => 'Ar feitheamh',
        'earned_value' => '+ :value uair an chloig',
        'spent_value' => '-:value uair an chloig',
        'pending_value' => ':value uair an chloig',

        'pending_in' => 'Ar feitheamh — isteach',

        'pending_out' => 'Ar feitheamh — amach',
        'pending_hint' => 'Creidmheasanna isteach agus amach nach bhfuil críochnaithe go fóill.',
    ],
    'hours_value' => ':value uair an chloig',
    'member_since' => 'Ball ó :date',
    'transfer' => [
        'heading' => 'Seol creidmheasanna chuig comhalta',
        'description' => 'Déan cuardach do bhall de réir ainm, ansin roghnaigh cé mhéad uair an chloig le seoladh.',
        'prefill_notice' => 'Tá faighteoir réamhroghnaithe ó do nasc. Seiceáil na sonraí roimh sheoladh.',
        'search_label' => 'Cuardaigh ball',
        'search_hint' => 'Clóscríobh ainm agus roghnaigh Cuardaigh.',
        'search_button' => 'Cuardach',
        'search_empty' => 'Níor mheaitseáil aon bhall le do chuardach.',
        'recipient_heading' => 'Baill mheaitseála',
        'amount_label' => 'Méid in uaireanta',
        'amount_hint' => 'Mar shampla, 1 nó 2.5. Is féidir leat suas le 1000 uair a sheoladh.',
        'note_label' => 'Cuir nóta leis (roghnach)',
        'note_hint' => 'Feicfidh an faighteoir é seo leis an aistriú.',
        'send_button' => 'Seol creidmheasanna chuig :name',
    ],
    'donate' => [
        'heading' => 'Deonaigh creidmheasanna',
        'description' => 'Tabhair cuid de do chreidmheasanna ama don chiste pobail, nó go díreach do bhall eile.',
        'credits_not_money' => 'Deonaíonn sé seo do chreidmheasanna ama ar chomhthiomsú pobail. Ní síntiús airgid é.',
        'warning' => 'Bogann síntiúis creidmheasanna bealach amháin agus ní féidir iad a chealú.',
        'target_legend' => 'Cé dó ar mhaith leat a bhronnadh?',
        'target_fund' => 'An ciste pobail',
        'target_fund_hint' => 'Comhthiomsú ar féidir le ball ar bith tarraingt air.',
        'target_member' => 'Ball ar leith',
        'target_member_hint' => 'Déan cuardach don bhall thíos roimh bhronnadh.',
        'fund_balance_label' => 'Iarmhéid ciste pobail',
        'fund_donated_label' => 'Iomlán tugtha ag baill',
        'recipient_required' => 'Déan cuardach agus roghnaigh ball le síntiús a thabhairt dó ar dtús.',
        'amount_label' => 'Méid in uaireanta',
        'amount_hint' => 'Uaireanta iomlána amháin, suas le 1000.',
        'message_label' => 'Cuir teachtaireacht leis (roghnach)',
        'message_hint' => 'Nóta gearr le dul le do síntiús.',
        'button_fund' => 'Deonaigh don chiste pobail',
        'button_member' => 'Deonaigh do :name',
    ],
    'states' => [
        'success_title' => 'Rath',
        'error_title' => 'Tá fadhb ann',
        'warning' => 'Rabhadh',
        'transfer_sent' => 'Tá do chreidmheasanna seolta.',
        'donate_sent' => 'Go raibh maith agat. Tá do dheontas tugtha.',
    ],
    'errors' => [
        'invalid' => 'Cuir isteach méid bailí agus faighteoir.',
        'insufficient' => 'Níl go leor creidmheasanna agat as sin.',
        'not_found' => 'Níorbh fhéidir an ball sin a fháil.',
        'self' => 'Ní féidir leat creidmheasanna a sheoladh chugat féin.',
        'inactive' => 'Ní féidir leis an gcomhalta sin creidmheasanna a fháil faoi láthair.',
        'too_large' => 'Tá an méid sin ró-mhór.',
        'decimals' => 'Caithfidh síntiúis a bheith ina n-uaireanta iomlána.',
        'failed' => 'Chuaigh rud éigin mícheart. Bain triail eile as.',
    ],
    'footer' => [
        'wallet_link' => 'Féach ar do sparán iomlán agus stair idirbheart',
    ],
    'nav' => [
        'manage' => 'Bainistigh do chreidmheasanna',
    ],
];
