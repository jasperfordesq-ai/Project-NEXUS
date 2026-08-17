<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Tá an comhrá seo curtha ar sos ag riail chosanta pobail. Ní mór do do phobal deimhniú reatha ar stádas :types a thaifeadadh duit sular féidir leat teachtaireacht a chur chuig an gcomhalta seo. Iarr ar do bhróicéir nó ar riarthóir an phobail an stádas seo a thaifeadadh mar mheiteashonraí amháin. Ná seol ná uaslódáil aon doiciméad grinnfhiosrúcháin.',
        'vetting_required_title' => 'Ta seiceail chosanta de dhith',
        'vetting_required_detail' => 'Ní féidir teagmháil a dhéanamh leis an gcomhalta seo maidir leis an gcineál idirghníomhaíochta seo ach ag daoine a bhfuil stádas reatha :types taifeadta ag a bpobal dóibh. Is meiteashonraí amháin atá sa taifead; níor cheart aon doiciméad a sheoladh ná a uaslódáil.',
        'vetting_required_action' => 'Oscail cabhair',
        'contact_restricted' => 'D iarr an comhalta seo go socroidh comhordaitheoir teagmhail thar a cheann. Nior seoladh do theachtaireacht. Dean teagmhail le do bhroiceir no riarthoir pobail chun an chead cheim shabhailte eile a shocru.',
        'contact_restricted_title' => 'Ta socru comhordaitheora ag teastail',
        'contact_restricted_detail' => 'Níl an comhalta seo ar fáil do theachtaireachtaí díreacha toisc go n-éilíonn a gcuid sainroghanna coimirce teagmháil trí chomhordaitheoir. Is féidir leat iarraidh ar chomhordaitheoir cabhrú leis an teagmháil a eagrú.',
        'contact_restricted_action' => 'Oscail cabhair',
        'coordination_not_required' => 'Tá teagmháil dhíreach leis an gcomhalta seo ar fáil faoi láthair — ní gá comhordaitheoir a bheith agat chun é a eagrú. Athnuaigh an leathanach agus bain triail as teachtaireacht a sheoladh arís.',
        'coordination_request_failed' => 'Níorbh fhéidir do iarratas a sheoladh chuig an gcomhordaitheoir faoi láthair. Bain triail eile as ar ball.',
        'vetting_check_failed' => 'Níorbh fhéidir linn do stádas grinnfhiosrúcháin a dheimhniú faoi láthair. Bain triail eile as i gceann tamaill.',
        'statement_required' => 'Teastaíonn Ráiteas Cosanta Leanaí (PDF) sula bhféadfaidh tú a dhearbhú go n-oibríonn an pobal seo le leanaí nó le daoine fásta leochaileacha. Uaslódáil ceann chun leanúint ar aghaidh.',
        'invalid_file' => 'Níorbh fhéidir an comhad uaslódáilte a léamh. Bain triail as comhad PDF bailí.',
        'pdf_required' => 'Caithfidh an ráiteas cosanta a bheith ina chomhad PDF.',
        'file_too_large' => 'Tá an comhad ráitis cosanta ró-mhór. 10MB an uasmhéid.',
        'storage_failed' => 'Níorbh fhéidir linn an comhad a shábháil. Bain triail eile as.',
        'statement_missing' => 'Níl aon ráiteas cosanta ar comhad don phobal seo.',
        'file_missing' => 'Níorbh fhéidir an comhad ráitis cosanta a aimsiú ar an bhfreastalaí. Uaslódáil arís é.',
        'revoke_failed' => 'Níorbh fhéidir an rogha sin a chúlghairm. B’fhéidir go raibh sí cúlghairthe cheana.',
        'policy_unavailable' => 'Ní féidir linn an polasaí cosanta pobail a dhearbhú faoi láthair. Níor seoladh aon teachtaireacht. Bain triail eile as gan mhoill.',
        'interaction_not_allowed' => 'Ní cheadaíonn beartas cosanta pobail an fhaighteora an t-idirghníomhú díreach seo. Iarr cabhair ar chomhordaitheoir.',
        'policy_unavailable_title' => 'Níl seiceáil cosanta ar fáil go sealadach',
        'policy_unavailable_detail' => 'Níorbh fhéidir le Tionscadal NEXUS an beartas teagmhála a mheas go sábháilte, mar sin cuireadh an t-idirghníomhú seo ar sos.',
        'policy_unavailable_action' => 'Seiceáil arís',
        'listing_role_confirmation_required' => 'Éilíonn an liostú seo cinneadh DBS feabhsaithe ar leithligh arna dhaingniú ag an bpobal don ról seo. Ní shásaíonn deimhniú teagmhála teachtaire ceanglais chosanta a bhaineann go sonrach leis an ról.',
        'listing_role_feature_unavailable' => 'Ní féidir seiceáil ar thaifid choiriúla a bhaineann go sonrach le róil a chumasú anseo go fóill. Ní dhéantar dearbhú teagmhála Messenger a athúsáid d\'aon ghnó mar imréiteach róil.',
        'compliance_policy_unavailable' => 'Ní féidir linn na ceanglais chosanta don liostú seo a dhearbhú go sábháilte faoi láthair. Bain triail eile as ar ball le do thoil nó déan teagmháil le do bhróicéir.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Bunúsach',
        'dbs_standard' => 'Caighdeán DBS',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Grinnfhiosrúchán an Gharda Síochána',
        'access_ni' => 'AccessNI',
        'pvg_scotland' => 'PVG Albain',
        'international' => 'Seiceáil cúlra idirnáisiúnta',
        'other' => 'Seiceáil ghrinnfhiosrúcháin eile',
        'uk_safeguarding_clearance' => 'Imréiteach cosanta na RA',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Níl an dlínse cosanta cumraithe',
        'united_kingdom' => 'An Ríocht Aontaithe — pacáiste beartais náisiúnta',
        'england_wales' => 'Sasana agus an Bhreatain Bheag',
        'scotland' => 'Albain',
        'northern_ireland' => 'Tuaisceart Éireann',
        'ireland' => 'Poblacht na hÉireann',
        'custom' => 'Dlínse chustaim',
    ],
    'attestations' => [
        'dbs_enhanced' => 'DBS feabhsaithe deimhnithe le haghaidh teagmhála le comhaltaí cosanta',
        'pvg_scotland' => 'Deimhníodh stádas PVG do theagmháil le comhaltaí cosanta',
        'access_ni' => 'Deimhníodh stádas AccessNI do theagmháil le comhaltaí cosanta',
        'garda_vetting' => 'Deimhníodh Grinnfhiosrúchán an Gharda Síochána maidir le teagmháil le comhaltaí cosanta',
        'uk_safeguarding_clearance' => 'Deimhníodh imréiteach cosanta na RA do theagmháil le comhaltaí cosanta',
    ],
    'confirmation' => [
        'title' => 'Sábháladh do shainroghanna cosanta',
        'intro' => 'Go raibh maith agat as an eolas seo a roinnt. Seo achoimre ar do rogha, cé a fheiceann é, agus cad a thosaíonn mar thoradh air.',
        'your_selections' => 'Do roghanna',
        'no_selections' => 'Níor roghnaigh tú aon rogha cosanta.',
        'who_can_see_heading' => 'Cé a fheiceann é',
        'who_can_see_body' => 'Ní fheiceann ach comhordaitheoirí agus riarthóirí an phobail na sainroghanna seo. Ní fheiceann baill eile iad. Déantar gach rochtain a logáil.',
        'what_activates_heading' => 'Cad a thosaíonn mar thoradh air',
        'activation_broker_review' => 'Déanfaidh comhordaitheoir meaitseálacha nó malartuithe cosanta a athbhreithniú agus a cheadú nuair a éilíonn do rogha é. Ní thugann sé seo rochtain dóibh ar ábhar teachtaireachtaí.',
        'activation_match_approval' => 'Ceadóidh comhordaitheoir meaitseálacha a bhaineann leat sula moltar don bhall eile iad.',
        'activation_discovery_hidden' => 'Beidh tú i bhfolach ó fhionnachtain ag baill nach bhfuil an grinnfhiosrúchán riachtanach acu.',
        'activation_notification' => 'Cuireadh comhordaitheoir ar an eolas agus rachaidh sé/sí i dteagmháil leat chun plé a dhéanamh ar conas is féidir linn cabhrú.',
        'activation_none' => 'Ní thosaíonn aon chosaint uathoibríoch ó na roghanna seo. Cuirtear do shainroghanna ar taifead d’fheasacht an chomhordaitheora.',
        'revoke_heading' => 'Conas iad seo a athrú nó a chúlghairm aon uair',
        'revoke_body' => 'Is féidir leat aon cheann de na sainroghanna seo a athbhreithniú nó a chúlghairm aon uair ó do shocruithe próifíle. Ní gá duit iarraidh ar riarthóir é seo a dhéanamh.',
        'revoke_cta' => 'Téigh go socruithe cosanta',
        'continue_cta' => 'Lean ar aghaidh',
    ],
    'settings' => [
        'page_title' => 'Sainroghanna cosanta',
        'intro' => 'Athbhreithnigh nó cúlghair na sainroghanna cosanta a shocraigh tú le linn an dul isteach. Feiceann na comhordaitheoirí iad seo ach ní fheiceann baill eile iad.',
        'no_preferences' => 'Níl aon sainroghanna cosanta gníomhacha agat. Is féidir leat iad seo a shocrú aon uair ó leathanach cabhrach na cosanta.',
        'selected_on' => 'Roghnaithe ar :date',
        'revoke_button' => 'Cúlghair',
        'revoke_confirm_title' => 'Cúlghair an rogha seo?',
        'revoke_confirm_body' => 'Ní bheidh feidhm ag an rogha seo a thuilleadh ar do chuntas. Cuirfear do chomhordaitheoirí ar an eolas faoin athrú.',
        'revoke_confirm_yes' => 'Tá, cúlghair',
        'revoke_confirm_no' => 'Coinnigh í',
        'revoked_toast' => 'Cúlghaireadh an rogha.',
        'revoke_error_toast' => 'Chuaigh rud éigin amú. Bain triail eile as.',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Glacann an pobal seo cosaint daoine go dáiríre. Má mheasann tú gur duine fásta leochaileach thú nó má tá tacaíocht bhreise uait, cuir in iúl dúinn é ionas gur féidir lenár gcomhordaitheoirí malartuithe sábháilte a eagrú duit.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Measaim gur duine fásta leochaileach mé agus d’fhéadfadh tacaíocht bhreise chosanta a bheith ag teastáil uaim',
                    'description' => 'Cuireann sé seo in iúl dár gcomhordaitheoirí go bhféadfadh tacaíocht bhreise a bheith uait agus malartuithe á n-eagrú. Rachaidh comhordaitheoir i dteagmháil leat chun plé a dhéanamh ar an gcaoi ar féidir linn cabhrú leat. Tá an fhaisnéis seo faoi rún.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'B’fhearr liom gan idirghníomhú ach le baill a ndearnadh grinnfhiosrúchán cuí orthu',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Ba mhaith liom go gcabhródh comhordaitheoir liom mo mhalartuithe a eagrú seachas teagmháil dhíreach a dhéanamh liom',
                    'description' => 'Déanfaidh comhordaitheoir idirghabháil i ngach teagmháil agus cabhróidh sé nó sí le malartuithe a eagrú ar do shon. Ní bheidh baill eile in ann teachtaireacht a chur chugat go díreach.',
                ],
                'no_home_visits' => [
                    'label' => 'Ní theastaíonn uaim go dtabharfadh baill cuairt ar mo theach gan socrú ó chomhordaitheoir',
                    'description' => 'Socrófar gach cuairt baile trí chomhordaitheoir ar féidir leis nó léi a chinntiú go bhfuil cosaintí cuí i bhfeidhm.',
                ],
                'works_with_children' => [
                    'label' => 'Tá sé beartaithe agam seirbhísí a thairiscint a bhféadfadh leanaí nó daoine óga (faoi 18) a bheith bainteach leo',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Tá sé beartaithe agam seirbhísí a thairiscint a bhféadfadh daoine fásta leochaileacha a bheith bainteach leo',
                ],
                'none_apply' => [
                    'label' => 'Ní bhaineann aon cheann díobh seo liom',
                    'description' => 'Tá na roghanna thuas athbhreithnithe agam agus ní bhaineann aon cheann díobh le mo chás. Déantar é seo a thaifeadadh ionas go mbeidh a fhios ag comhordaitheoirí go bhfaca mé an chéim seo agus gur smaoinigh mé uirthi.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Éire',
            'vetting_authority' => 'An Biúró Náisiúnta Grinnfhiosrúcháin',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Éirinn, ciallaíonn sé seo baill a bhfuil Grinnfhiosrúchán an Gharda Síochána déanta orthu. Cinnteoidh ár gcomhordaitheoirí nach ndéanfar tú a mheaitseáil ach le baill a ndearnadh grinnfhiosrúchán orthu.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Déanfaidh comhordaitheoir (bróicéir) idirghabháil i ngach teagmháil agus cabhróidh sé nó sí le malartuithe a eagrú ar do shon. Ní bheidh baill eile in ann teachtaireacht a chur chugat go díreach.',
                ],
                'works_with_children' => [
                    'description' => 'D’fhéadfadh comhordaitheoir riachtanais Ghrinnfhiosrúchán an Gharda Síochána a phlé leat. In Éirinn, tá grinnfhiosrúchán de dhíth le haghaidh gníomhaíochtaí áirithe a bhaineann le leanaí faoin Acht um an mBiúró Náisiúnta Grinnfhiosrúcháin, 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'D’fhéadfadh comhordaitheoir riachtanais Ghrinnfhiosrúchán an Gharda Síochána a phlé leat. D’fhéadfadh grinnfhiosrúchán a bheith de dhíth le haghaidh gníomhaíochtaí a bhaineann le daoine fásta leochaileacha.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'An Ríocht Aontaithe',
            'vetting_authority' => 'DBS, Disclosure Scotland agus AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'Ar fud na Ríochta Aontaithe, deimhníonn comhordaitheoirí an bunús cuí Feabhsaithe DBS, PVG agus/nó AccessNI le haghaidh teagmhála faoi chosaint.',
                ],
                'works_with_children' => [
                    'description' => 'Déanfaidh comhordaitheoir measúnú ar an ról agus ar dhlínse na RA is infheidhme sula gcinnfidh sé cén tseiceáil cosanta is iomchuí ó thaobh an dlí de.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Déanfaidh comhordaitheoir measúnú ar an ról, ar na daoine fásta atá i gceist agus ar an dlínse is infheidhme sa RA sula gcinnfidh sé cén seiceáil cosanta is iomchuí ó thaobh an dlí de.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Sasana agus an Bhreatain Bheag',
            'vetting_authority' => 'An tSeirbhís um Nochtadh agus Urchosc',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'I Sasana agus sa Bhreatain Bheag, ciallaíonn sé seo baill a bhfuil seiceáil DBS déanta orthu. Cinnteoidh ár gcomhordaitheoirí nach ndéanfar tú a mheaitseáil ach le baill a ndearnadh grinnfhiosrúchán orthu.',
                ],
                'works_with_children' => [
                    'description' => 'D’fhéadfadh comhordaitheoir riachtanais seiceála DBS a phlé leat.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Albain',
            'vetting_authority' => 'Disclosure Scotland (Scéim PVG)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Measaim gur duine fásta leochaileach nó cosanta mé agus d’fhéadfadh tacaíocht bhreise chosanta a bheith ag teastáil uaim',
                ],
                'requires_vetted_partners' => [
                    'description' => 'In Albain, ciallaíonn sé seo baill den scéim PVG. Cinnteoidh ár gcomhordaitheoirí nach ndéanfar tú a mheaitseáil ach le baill a ndearnadh grinnfhiosrúchán orthu.',
                ],
                'works_with_children' => [
                    'description' => 'D’fhéadfadh comhordaitheoir ballraíocht sa scéim PVG a phlé leat.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Tá sé beartaithe agam seirbhísí a thairiscint a bhféadfadh daoine fásta cosanta a bheith bainteach leo',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Tuaisceart Éireann',
            'vetting_authority' => 'AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'I dTuaisceart Éireann, ciallaíonn sé seo baill a bhfuil seiceáil AccessNI déanta orthu. Cinnteoidh ár gcomhordaitheoirí nach ndéanfar tú a mheaitseáil ach le baill a ndearnadh grinnfhiosrúchán orthu.',
                ],
                'works_with_children' => [
                    'description' => 'D’fhéadfadh comhordaitheoir seiceáil AccessNI a phlé leat.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Saincheaptha',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'D’athraigh do phobal a dhlínse cosanta. Fanann do chosaint reatha gníomhach, ach athbhreithnigh an fhoclaíocht nuashonraithe sna Socruithe.',
        'jurisdiction_changed_staff' => 'D’athraigh an dlínse cosanta. Fanann cosaintí na mball lena mbaineann gníomhach agus teastaíonn athbhreithniú ón mball anois.',
        'attestation_policy_rotated_member' => 'Tá athbhreithniú polasaí cosanta tosaithe ag do phobal. Caithfidh do bhróicéir do stádas teagmhála príobháideach a athdheimhniú; ní dul in éag teastais é seo.',
        'reminder_subject' => 'Déan athbhreithniú ar do shainroghanna cosanta',
        'reminder_title' => 'Am chun athbhreithniú a dhéanamh ar do shainroghanna cosanta',
        'reminder_body' => 'Tá níos mó ná bliain caite ó shocraigh tú do shainroghanna cosanta le haghaidh :community. Tóg nóiméad chun athbhreithniú a dhéanamh agus a dheimhniú go bhfuil siad fós i bhfeidhm, nó cúlghair aon cheann nach bhfuil.',
        'reminder_cta' => 'Athbhreithniú a dhéanamh ar shainroghanna',
        'escalation_subject' => 'Athbhreithniú cosanta baill gan freagairt',
        'escalation_title' => 'Athbhreithniú bliantúil cosanta gan freagairt',
        'escalation_body' => 'Níor fhreagair :name iarratas chun athbhreithniú a dhéanamh ar a shainroghanna cosanta i 30 lá. Fanann a shainroghanna gníomhach — tá an ceart ag an mball iad a choinneáil. Téigh i dteagmháil go díreach más maith leat labhairt leo.',
        'escalation_cta' => 'Féach ar bhall sa deais cosanta',
    ],
];
