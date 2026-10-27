<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Accessible Explore page (web-uk) — parity with React's ExplorePage.
// Most strings reuse react-frontend/public/locales/<locale>/explore.json.

return [
    'tabs_label' => 'Cluaisíní ábhair Aimsigh',
    'tabs' => [
        'all' => 'Gach rud',
        'for_you' => 'Duit Féin',
        'listings' => 'Liostuithe',
        'people' => 'Daoine',
        'events' => 'Imeachtaí',
        'groups' => 'Grúpaí',
    ],
    'search_label' => 'Aimsigh scileanna, imeachtaí, grúpaí',
    'search_button' => 'Cuardaigh',
    'categories_heading' => 'Brabhsáil liostuithe de réir catagóire',
    'see_all' => 'Féach ar fad',
    'stats' => [
        'heading' => 'Do phobal i bhfigiúirí',
        'members' => 'Baill',
        'exchanges_this_month' => 'Malartuithe an Mhí seo',
        'hours_exchanged' => 'Uaireanta Malartaithe',
        'active_listings' => 'Liostuithe Gníomhacha',
    ],
    'sections' => [
        'trending_posts' => [
            'title' => 'Postálacha Treochtúla',
            'subtitle' => 'Na postálacha is mó rannpháirtíochta an tseachtain seo',
        ],
        'popular_listings' => [
            'title' => 'Liostuithe Coitianta',
            'subtitle' => 'Na tairiscintí agus iarratais is mó amharc',
        ],
        'upcoming_events' => [
            'title' => 'Imeachtaí Le Teacht',
            'subtitle' => 'Bí páirteach i do phobal',
        ],
        'active_groups' => [
            'title' => 'Grúpaí Gníomhacha',
            'subtitle' => 'Ceangail le baill den tuairim chéanna',
        ],
        'top_contributors' => [
            'title' => 'Barrannpháirtithe',
            'subtitle' => 'Ceannairí pobail de réir taithí',
        ],
        'trending_hashtags' => [
            'title' => 'Haischlibeanna Treochtúla',
            'subtitle' => 'Topaicí coitianta i do phobal',
        ],
        'recommended' => [
            'title' => 'Molta Duit',
            'subtitle' => 'Bunaithe ar do spéiseanna agus do ghníomhaíocht',
        ],
        'near_you' => [
            'title' => 'In Aice Leat',
            'subtitle' => 'Liostuithe gar do do shuíomh',
        ],
        'suggested_connections' => [
            'title' => 'Daoine a d\'Fhéadfá Aithne a Chur Orthu',
            'subtitle' => 'Ceangail le baill a roinneann do spéiseanna',
        ],
        'blog_posts' => [
            'title' => 'Ón mBlag',
            'subtitle' => 'Na scéalta is déanaí ó do phobal',
        ],
        'volunteering' => [
            'title' => 'Deiseanna Oibre Deonaí',
            'subtitle' => 'Déan difríocht i do phobal',
        ],
        'polls' => [
            'title' => 'Pobalbhreitheanna Gníomhacha',
            'subtitle' => 'Abair do thuairim ar ábhair phobail',
        ],
        'in_demand_skills' => [
            'title' => 'Scileanna atá ag Teastáil',
            'subtitle' => 'Na scileanna is mó éileamh i do phobal',
        ],
        'organisations' => [
            'title' => 'Eagraíochtaí',
            'subtitle' => 'Comhpháirtithe pobail ag déanamh tionchar',
        ],
        'jobs' => [
            'title' => 'Deiseanna Fostaíochta',
            'subtitle' => 'Na folúntais is déanaí ó chomhpháirtithe pobail',
        ],
        'resources' => [
            'title' => 'Acmhainní Roghnaithe',
            'subtitle' => 'Treoracha agus ábhair do do phobal',
        ],
        'new_members' => [
            'title' => 'Fáilte roimh ár mBaill is Nuaí',
            'subtitle' => 'Abair dia le baill nua',
        ],
        'featured_challenges' => [
            'title' => 'Dúshláin Mholta',
            'subtitle' => 'Roinn do smaointe agus déan tionchar',
        ],
    ],
    'meta' => [
        'attending' => ':count ag freastal',
        'members' => ':count ball',
        'level' => 'Leibhéal :level',
        'match' => ':score% meaitseáil',
        'by_author' => 'le :name',
        'distance' => ':distance km ar shiúl',
        'read_time' => ':count nóim léitheoireachta',
        'applications' => ':count iarratas',
        'votes' => ':count vóta',
        'closes' => 'Ag dúnadh :date',
        'requesting' => ':count ag iarraidh',
        'offering' => ':count ag tairiscint',
        'opportunities' => ':count deis',
        'deadline' => 'Spriocdháta: :date',
        'ideas' => ':count smaoineamh',
        'ends' => 'Ag críochnú :date',
    ],
    'content_types' => [
        'listing' => 'Liostú',
        'post' => 'Postáil',
        'event' => 'Imeacht',
        'group' => 'Grúpa',
        'member' => 'Ball',
        'blog' => 'Alt blag',
    ],
    'dismiss' => 'Níl spéis agam',
    'dismissed' => 'Ní mholfaimid an liostú sin duit arís.',
    'dismiss_failed' => 'Níorbh fhéidir an moladh sin a fholú. Bain triail eile as ar ball.',
    'for_you' => [
        'empty' => 'Idirghníomhaigh le liostuithe, postálacha, agus imeachtaí chun moltaí pearsantaithe a fháil.',
        'end_of_feed' => 'Tá tú suas chun dáta!',
        'load_more' => 'Taispeáin tuilleadh moltaí',
        'load_error' => 'Níorbh fhéidir do mholtaí pearsanta a luchtú. Bain triail eile as ar ball.',
    ],
    'load_error' => 'Níorbh fhéidir na rannóga aimsithe a luchtú. D’fhéadfadh gur fadhb shealadach í seo. Bain triail eile as ar ball.',
    'empty' => [
        'listings' => 'Níl aon liostuithe le taispeáint fós. Bí ar an gcéad duine ceann a chruthú!',
        'people' => 'Níl aon bhaill le taispeáint fós. Tabhair cuireadh do dhuine éigin!',
        'events' => 'Níl aon imeachtaí le teacht. Cruthaigh ceann chun do phobal a thabhairt le chéile!',
        'groups' => 'Níl aon ghrúpaí gníomhacha fós. Tosaigh grúpa bunaithe ar do spéiseanna!',
    ],
    'create_listing' => 'Cruthaigh Liostú',
    'create_group' => 'Cruthaigh Grúpa',
];
