<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [
    'errors' => [
        'vetting_required' => 'Dit gesprek is gepauzeerd door een beschermingsregel van de community. Je community moet een actuele :types-status voor je hebben vastgelegd voordat je dit lid een bericht kunt sturen. Vraag je bemiddelaar of communitybeheerder om deze status uitsluitend als metadata vast te leggen. Stuur of upload geen screeningsdocument.',
        'vetting_required_title' => 'Veiligheidscontrole nodig',
        'vetting_required_detail' => 'Dit lid kan voor dit type interactie alleen worden benaderd door mensen van wie de community een actuele :types-status heeft vastgelegd. De registratie bevat uitsluitend metadata; er mag geen document worden verstuurd of geüpload.',
        'vetting_required_action' => 'Help openen',
        'contact_restricted' => 'Dit lid wil dat een coordinator het contact namens hen regelt. Je bericht is niet verzonden. Neem contact op met je broker of communitybeheerder zodat zij de volgende veilige stap kunnen regelen.',
        'contact_restricted_title' => 'Coordinatorafspraak nodig',
        'contact_restricted_detail' => 'Dit lid is niet beschikbaar voor directe berichten, omdat hun beveiligingsvoorkeuren vereisen dat contact via een coördinator verloopt. U kunt een coördinator vragen om het contact te helpen regelen.',
        'contact_restricted_action' => 'Help openen',
        'coordination_not_required' => 'Direct contact met dit lid is momenteel mogelijk — u heeft geen coördinator nodig om dat te regelen. Vernieuw de pagina en probeer opnieuw een bericht te sturen.',
        'coordination_request_failed' => 'We konden uw verzoek op dit moment niet naar de coördinator sturen. Probeer het binnenkort opnieuw.',
        'vetting_check_failed' => 'We konden uw screeningstatus op dit moment niet verifiëren. Probeer het binnenkort opnieuw.',
        'policy_unavailable' => 'We kunnen het gemeenschapsbeschermingsbeleid op dit moment niet bevestigen. Er is geen bericht verzonden. Probeer het binnenkort opnieuw.',
        'blocked_interaction' => 'Je kunt geen interactie hebben met dit lid.',
        'interaction_not_allowed' => 'Het gemeenschapsbeschermingsbeleid van de ontvanger staat deze directe interactie niet toe. Vraag een coördinator om hulp.',
        'policy_unavailable_title' => 'Waarborgcheque tijdelijk niet beschikbaar',
        'policy_unavailable_detail' => 'Project NEXUS kon het contactbeleid niet veilig evalueren, daarom is deze interactie onderbroken.',
        'policy_unavailable_action' => 'Controleer opnieuw',
        'listing_role_confirmation_required' => 'Voor deze vermelding is voor deze rol een afzonderlijk, door de gemeenschap bevestigd, Enhanced DBS-besluit vereist. Een contactbevestiging via Messenger voldoet niet aan rolspecifieke beveiligingsvereisten.',
        'listing_role_feature_unavailable' => 'Rolspecifieke screening van strafregisters kan hier nog niet worden ingeschakeld. Contactbevestiging via Messenger wordt bewust niet hergebruikt als rolmachtiging.',
        'compliance_policy_unavailable' => 'We kunnen de beveiligingsvereisten voor deze vermelding op dit moment niet veilig bevestigen. Probeer het later opnieuw of neem contact op met uw makelaar.',
        'statement_required' => 'Voordat u kunt verklaren dat deze gemeenschap met kinderen of kwetsbare volwassenen werkt, is een PDF-verklaring over de bescherming van kinderen vereist. Upload er een om door te gaan.',
        'invalid_file' => 'Het geüploade bestand kon niet worden gelezen. Probeer het opnieuw met een geldige pdf.',
        'pdf_required' => 'De vrijwaringsverklaring moet een pdf-bestand zijn.',
        'file_too_large' => 'Het vrijwaringsverklaringbestand is te groot. De maximale grootte is 10 MB.',
        'storage_failed' => 'We konden het geüploade bestand niet opslaan. Probeer het opnieuw.',
        'statement_missing' => 'Er is geen beschermingsverklaring geregistreerd voor deze gemeenschap.',
        'file_missing' => 'Het beveiligingsverklaringbestand kon niet op de server worden gevonden. Upload het alstublieft opnieuw.',
        'revoke_failed' => 'Wij konden die voorkeur niet intrekken. Mogelijk is deze al ingetrokken.',
    ],
    'vetting_types' => [
        'dbs_basic' => 'DBS Basis',
        'dbs_standard' => 'DBS-standaard',
        'dbs_enhanced' => 'DBS Enhanced',
        'garda_vetting' => 'Garda-keuring',
        'access_ni' => 'ToegangNI',
        'pvg_scotland' => 'PVG Schotland',
        'international' => 'Internationaal antecedentenonderzoek',
        'other' => 'Andere doorlichtingscontrole',
        'uk_safeguarding_clearance' => 'Britse vrijwaring',
    ],
    'jurisdictions' => [
        'unconfigured' => 'Bescherming van jurisdictie niet geconfigureerd',
        'united_kingdom' => 'Verenigd Koninkrijk — nationaal beleidspakket',
        'england_wales' => 'Engeland en Wales',
        'scotland' => 'Schotland',
        'northern_ireland' => 'Noord-Ierland',
        'ireland' => 'Republiek Ierland',
        'custom' => 'Aangepaste jurisdictie',
    ],
    'attestations' => [
        'dbs_enhanced' => 'Verbeterde DBS bevestigd voor beveiligd ledencontact',
        'pvg_scotland' => 'PVG-status bevestigd voor beveiligd ledencontact',
        'access_ni' => 'AccessNI-status bevestigd voor beveiligd ledencontact',
        'garda_vetting' => 'Garda Vetting bevestigd voor beveiligd ledencontact',
        'uk_safeguarding_clearance' => 'Britse vrijwaringsvergunning bevestigd voor beschermd ledencontact',
    ],
    'confirmation' => [
        'title' => 'Uw beveiligingsvoorkeuren zijn opgeslagen',
        'intro' => 'Bedankt dat je dit deelt. Hier vindt u een samenvatting van wat u heeft gekozen, wie het kan zien en wat er als gevolg daarvan wordt geactiveerd.',
        'your_selections' => 'Jouw selecties',
        'no_selections' => 'U heeft geen beveiligingsopties geselecteerd.',
        'who_can_see_heading' => 'Wie kan dit zien',
        'who_can_see_body' => 'Alleen de communitycoördinatoren en -beheerders kunnen deze voorkeuren zien. Andere leden kunnen dat niet. Alle toegang wordt geregistreerd.',
        'what_activates_heading' => 'Wat daardoor wordt geactiveerd',
        'activation_broker_review' => 'Een coördinator zal beveiligde wedstrijden of uitwisselingen beoordelen en goedkeuren wanneer uw geselecteerde voorkeur dit vereist. Hierdoor hebben ze geen toegang tot de inhoud van het bericht.',
        'activation_match_approval' => 'Een coördinator keurt wedstrijden waarbij u betrokken bent goed voordat deze aan het andere lid worden voorgesteld.',
        'activation_discovery_hidden' => 'Leden zonder door deze community geregistreerde controles kunnen u geen berichten sturen, antwoorden, u tijdskredieten sturen of een uitwisseling met u starten.',
        'activation_notification' => 'Er is een coördinator op de hoogte gebracht die contact met u opneemt om te bespreken hoe we kunnen helpen.',
        'activation_none' => 'Er worden geen automatische beveiligingen geactiveerd vanuit deze selecties. Uw voorkeuren worden vastgelegd zodat de coördinator hiervan op de hoogte is.',
        'revoke_heading' => 'Hoe u deze op elk moment kunt wijzigen of intrekken',
        'revoke_body' => 'U kunt al deze voorkeuren op elk gewenst moment bekijken of intrekken via uw profielinstellingen. U hoeft hiervoor geen beheerder te vragen.',
        'revoke_cta' => 'Ga naar de beveiligingsinstellingen',
        'continue_cta' => 'Doorgaan',
    ],
    'settings' => [
        'page_title' => 'Bewaken van voorkeuren',
        'intro' => 'Controleer of trek de beveiligingsvoorkeuren in die u tijdens de onboarding heeft ingesteld. Jouw coördinatoren kunnen deze zien, maar andere leden niet.',
        'no_preferences' => 'U heeft geen actieve beschermingsvoorkeuren. U kunt deze op elk gewenst moment instellen via de hulppagina voor beveiliging.',
        'selected_on' => 'Geselecteerd op :date',
        'revoke_button' => 'Herroepen',
        'revoke_confirm_title' => 'Deze voorkeur intrekken?',
        'revoke_confirm_body' => 'Deze voorkeur is niet langer van toepassing op uw account. Uw coördinatoren worden op de hoogte gebracht van de wijziging.',
        'revoke_confirm_yes' => 'Ja, intrekken',
        'revoke_confirm_no' => 'Bewaar het',
        'revoked_toast' => 'Voorkeur ingetrokken.',
        'revoke_error_toast' => 'Er is iets misgegaan. Probeer het opnieuw.',
        'switch_heading' => 'Er is een zachtere optie beschikbaar',
        'switch_body' => 'Je hebt ervoor gekozen om alleen gecontacteerd te worden door leden wier controle deze community heeft geregistreerd. Dat weerhoudt bijna iedereen ervan je te bereiken. U kunt overschakelen naar een coördinator die uw uitwisselingen in de gaten houdt en u in plaats daarvan aan leden voorstelt, zodat andere leden u opnieuw een bericht kunnen sturen.',
        'switch_button' => 'Schakel over naar coördinatorintroducties',
        'switched_toast' => 'Klaar. Een coördinator houdt uw uitwisselingen in de gaten en leden kunnen u opnieuw berichten sturen.',
        'switch_not_held' => 'U beschikt niet over de instelling \'Alleen doorgelichte leden\', dus u hoeft niets te wijzigen.',
        'switch_unavailable' => 'Coördinatorintroducties zijn nog niet beschikbaar in deze community. Neem dan contact op met een coördinator.',
    ],
    'effects' => [
        'broker_approval' => 'Een coördinator controleert elke uitwisseling die u regelt voordat deze doorgaat. Ze kunnen uw berichten niet lezen.',
        'restricts_messaging' => 'Andere leden kunnen u niet rechtstreeks een bericht sturen. Een coördinator regelt het contact voor u.',
        'restricts_matching' => 'Voorgestelde matches tussen jou en andere leden worden eerst door een coördinator gecontroleerd.',
        'vetted_only' => 'Alleen leden van wie :vetting deze community heeft opgenomen, kunnen u een bericht sturen, antwoorden, u tijdskredieten sturen of een uitwisseling met u starten. Alle anderen zijn geblokkeerd.',
        'vetted_count' => '{0} Er zijn momenteel geen leden die hier :vetting hebben opgenomen, dus niemand kan contact met je opnemen terwijl dit actief is.|{1} Slechts één lid heeft hier momenteel :vetting opgenomen.|[2,*] :count leden hebben hier momenteel :vetting opgenomen.',
        'notify_coordinator' => 'Een coördinator wordt op de hoogte gesteld van uw keuze, zodat zij contact met u kunnen opnemen als u iets nodig heeft.',
        'no_home_visits' => 'Coördinatoren weten dat u geen huisbezoeken wilt, tenzij zij deze regelen.',
        'informational' => 'Voor de overige leden verandert er niets. Uw antwoord helpt coördinatoren u te ondersteunen.',
        'declined' => 'Er verandert niets. Coördinatoren kunnen zien dat u naar deze stap heeft gekeken.',
        'vetting_fallback' => 'doorlichting',
    ],
    'presets' => [
        'common' => [
            'help_text' => 'Deze gemeenschap neemt bescherming serieus. Wilt u extra zorg bij het gebruik van de tijdbank, laat het ons hieronder weten, dan helpen onze coördinatoren u verder. Elke keuze vertelt u precies wat hij doet voordat u hem kiest.',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Ik beschouw mezelf als een kwetsbare volwassene en zou graag extra ondersteuning willen',
                    'description' => 'Een coördinator zal contact met u opnemen om te bespreken hoe we u kunnen helpen, en zal uw uitwisselingen en wedstrijden bekijken. Andere leden kunnen u nog steeds berichten sturen.',
                ],
                'coordinator_introductions' => [
                    'label' => 'Ik wil graag dat een coördinator mijn uitwisselingen in de gaten houdt en mij helpt kennis te maken met de leden',
                    'description' => 'Goed als je wat geruststelling wilt, zonder dat je wordt afgesneden. Andere leden kunnen u nog steeds berichten sturen.',
                ],
                'requires_vetted_partners' => [
                    'label' => 'Alleen leden wier controle door deze community is vastgelegd, mogen contact met mij opnemen',
                ],
                'requires_coordinator_contact' => [
                    'label' => 'Ik wil graag dat een coördinator al het contact voor mij regelt, in plaats van dat leden mij rechtstreeks berichten sturen',
                    'description' => 'Een coördinator regelt namens u het contact en de uitwisseling. Andere leden kunnen u niet rechtstreeks een bericht sturen.',
                ],
                'no_home_visits' => [
                    'label' => 'Ik wil niet dat leden mijn huis bezoeken tenzij een coördinator dit heeft geregeld',
                    'description' => 'De coördinatoren worden op de hoogte gesteld, zodat zij u kunnen helpen bij het regelen van een bezoek aan uw huis en ervoor kunnen zorgen dat de juiste veiligheidsmaatregelen zijn getroffen.',
                ],
                'works_with_children' => [
                    'label' => 'Ik ben van plan diensten aan te bieden waarbij kinderen of jongeren (jonger dan 18 jaar) betrokken kunnen zijn',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ik ben van plan diensten aan te bieden waarbij kwetsbare volwassenen betrokken kunnen zijn',
                ],
                'none_apply' => [
                    'label' => 'Geen van deze situaties is op mij van toepassing',
                    'description' => 'Ik heb de bovenstaande opties bekeken en geen ervan is op mijn situatie van toepassing. Dit wordt vastgelegd zodat coördinatoren weten dat ik deze stap heb gezien en overwogen.',
                ],
            ],
        ],
        'ireland' => [
            'name' => 'Ierland',
            'vetting_authority' => 'Nationaal screeningsbureau',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Ierland wordt Garda Vetting geregeld via een organisatie voor een bepaalde rol. Alleen het doorlichten dat deze gemeenschap heeft geregistreerd telt hier, niet het doorlichten van iemand via zijn werk of een andere groep.',
                ],
                'requires_coordinator_contact' => [
                    'description' => 'Een coördinator regelt namens u het contact en de uitwisseling. Andere leden kunnen u niet rechtstreeks een bericht sturen.',
                ],
                'works_with_children' => [
                    'description' => 'Een coördinator kan de vereisten voor Garda Vetting met u bespreken. In Ierland is voor bepaalde activiteiten met kinderen screening vereist op grond van de National Vetting Bureau Act 2012.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Een coördinator kan met u bespreken of Garda Vetting nodig is voor wat u van plan bent te doen. Volgens de National Vetting Bureau Act 2012 werken sommigen voornamelijk met kwetsbare mensen die doorgelicht moeten worden via een geregistreerde organisatie.',
                ],
            ],
        ],
        'united_kingdom' => [
            'name' => 'Verenigd Koninkrijk',
            'vetting_authority' => 'DBS, Disclosure Schotland en AccessNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In het hele Verenigd Koninkrijk betekent dit een verbeterde DBS-, PVG- of AccessNI-controle die deze community heeft vastgelegd. Een cheque die iemand via zijn baan of een andere groep heeft, telt hier niet mee.',
                ],
                'works_with_children' => [
                    'description' => 'Een coördinator zal de rol en de toepasselijke Britse jurisdictie beoordelen alvorens te beslissen welke vrijwaringscontrole juridisch passend is.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Een coördinator zal de rol, de betrokken volwassenen en de toepasselijke Britse jurisdictie beoordelen alvorens te beslissen welke vrijwaringscontrole juridisch passend is.',
                ],
            ],
        ],
        'england_wales' => [
            'name' => 'Engeland en Wales',
            'vetting_authority' => 'Dienst voor openbaarmaking en uitsluiting',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Engeland en Wales betekent dit een verbeterde DBS-controle die deze gemeenschap heeft geregistreerd. Een cheque die iemand via zijn baan of een andere groep heeft, telt hier niet mee.',
                ],
                'works_with_children' => [
                    'description' => 'Een coördinator kan de vereisten voor een DBS-controle met u bespreken.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Een coördinator kan met u bespreken of een DBS-check nodig is voor wat u van plan bent te doen.',
                ],
            ],
        ],
        'scotland' => [
            'name' => 'Schotland',
            'vetting_authority' => 'Disclosure Scotland (PVG-regeling)',
            'options' => [
                'is_vulnerable_adult' => [
                    'label' => 'Ik beschouw mezelf als een kwetsbare of beschermde volwassene en heb mogelijk extra ondersteuning voor mijn bescherming nodig',
                ],
                'requires_vetted_partners' => [
                    'description' => 'In Schotland betekent dit lidmaatschap van het PVG-programma dat deze gemeenschap heeft geregistreerd. Het lidmaatschap dat iemand via zijn werk of een andere groep heeft, telt hier niet mee.',
                ],
                'works_with_children' => [
                    'description' => 'Een coördinator kan deelname aan de PVG-regeling met u bespreken.',
                ],
                'works_with_vulnerable_adults' => [
                    'label' => 'Ik ben van plan diensten aan te bieden waarbij beschermde volwassenen betrokken kunnen zijn',
                ],
            ],
        ],
        'northern_ireland' => [
            'name' => 'Noord-Ierland',
            'vetting_authority' => 'ToegangNI',
            'options' => [
                'requires_vetted_partners' => [
                    'description' => 'In Noord-Ierland betekent dit een AccessNI-controle die deze gemeenschap heeft geregistreerd. Een cheque die iemand via zijn baan of een andere groep heeft, telt hier niet mee.',
                ],
                'works_with_children' => [
                    'description' => 'Een coördinator kan een AccessNI-controle met u bespreken.',
                ],
                'works_with_vulnerable_adults' => [
                    'description' => 'Een coördinator kan met u bespreken of een AccessNI-check nodig is voor wat u van plan bent te doen.',
                ],
            ],
        ],
        'custom' => [
            'name' => 'Aangepast',
        ],
    ],
    'review' => [
        'jurisdiction_changed_member' => 'Uw gemeenschap heeft haar rechtsgebied ter bescherming gewijzigd. Uw bestaande bescherming blijft actief, maar bekijk de bijgewerkte tekst in Instellingen.',
        'jurisdiction_changed_staff' => 'De beschermende jurisdictie veranderde. De getroffen ledenbeschermingen blijven actief en vereisen nu een ledenbeoordeling.',
        'attestation_policy_rotated_member' => 'Uw community is begonnen met een herziening van het beveiligingsbeleid. Uw makelaar moet uw privécontactstatus opnieuw bevestigen; dit is geen certificaatvervaldatum.',
        'reminder_subject' => 'Controleer uw beveiligingsvoorkeuren',
        'reminder_title' => 'Tijd om uw beveiligingsvoorkeuren te herzien',
        'reminder_body' => 'Het is meer dan een jaar geleden dat u uw beveiligingsvoorkeuren voor :community heeft ingesteld. Neem even de tijd om ze te bekijken en te bevestigen dat ze nog steeds van toepassing zijn, of trek ze in als ze niet langer van toepassing zijn.',
        'reminder_cta' => 'Controleer voorkeuren',
        'escalation_subject' => 'Beoordeling van de bescherming van leden uitstaand',
        'escalation_title' => 'Jaarlijkse veiligheidsbeoordeling uitstaand',
        'escalation_body' => ':name heeft al 30 dagen niet gereageerd op een verzoek om hun beveiligingsvoorkeuren te beoordelen. Hun voorkeuren blijven actief; het lid heeft het recht deze te behouden. Neem rechtstreeks contact op als u wilt inchecken.',
        'escalation_cta' => 'Bekijk het lid in het beveiligingsdashboard',
    ],
];
