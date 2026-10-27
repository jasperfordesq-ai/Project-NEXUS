<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/ga/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Forbróirí',
    'meta_description' => 'Déan iniúchadh ar API Comhpháirtí Project NEXUS le haghaidh fíordheimhniú OAuth2, críochphointí le raon feidhme, crúcaí gréasáin sínithe agus rochtain chomhtháthaithe.',
    'hero_title' => 'Tóg le NEXUS',
    'hero_subtitle' => 'API REST coimeádta do chomhpháirtithe baincéireachta, íocaíochta agus riaracháin bhardasaigh. Dintiúir cliaint OAuth2, crúcaí gréasáin sínithe agus timpeallacht tástála is féidir a úsáid laistigh de chúig nóiméad.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Fíordheimhniú idir freastalaithe. Comharthaí iompróra gearrshaolacha a bhfuil raon feidhme ar leith acu do gach comhpháirtí.',
    'feature_curated_title' => 'Sraith roghnaithe críochphointí',
    'feature_curated_body' => 'Na sonraí amháin a theastaíonn ó bhainc agus ó chórais riaracháin: úsáideoirí, liostuithe, sparán agus comhiomláin.',
    'feature_webhooks_title' => 'Crúcaí gréasáin sínithe',
    'feature_webhooks_body' => 'Sínithe HMAC-SHA256, athruithe uathoibríocha, sláinte seachadta i do dheais.',
    'feature_rate_limit_title' => 'Teorainneacha ráta in aghaidh an chomhpháirtí',
    'feature_rate_limit_body' => 'Cuótaí in aghaidh an nóiméid in-chumraithe. Áirítear Retry-After le freagraí 429.',
    'request_access_cta' => 'Iarr rochtain',
    'request_access_body' => 'Cuireann riarthóir do phobail rochtain Partner API ar fáil. Téigh i dteagmháil leis chun péire client_id / client_secret a fháil.',
    'nav' => [
        'overview' => 'Forbhreathnú',
        'auth' => 'Fíordheimhniú',
        'endpoints' => 'Críochphointí',
        'webhooks' => 'Crúcaí gréasáin',
    ],
    'auth_meta_title' => 'Fíordheimhniú API',
    'auth_intro' => 'Malartaigh do dhintiúir cliaint ar chomhartha iompróra gearrshaolach agus cuir le gach iarratas é mar Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Faigh dintiúir cliaint',
    'auth_step1_body' => 'Soláthraíonn riarthóir do phobail client_id agus client_secret sa chonsól riaracháin. Ní thaispeántar an rún ach uair amháin ag am cruthaithe.',
    'auth_step2_title' => '2. Malartaigh ar chomhartha',
    'auth_step2_body' => 'Cuir do dhintiúir le POST chuig /api/partner/v1/oauth/token. Áirítear access_token, expires_in (3600s) agus an scóp a deonaíodh san fhreagra.',
    'auth_step3_title' => '3. Glaoigh ar an API',
    'auth_step3_body' => 'Cuir an comhartha leis an gceanntásc Authorization. Tá scóp ag comharthaí — fillfidh an API 403 insufficient_scope má sháraíonn tú do dheonú.',
    'tabs' => [
        'code_examples' => 'Samplaí de chóid',
        'verification_examples' => 'Samplaí fíoraithe',
    ],
    'curl_example' => 'sampla curl',
    'js_example' => 'sampla JavaScript',
    'endpoints_meta_title' => 'Críochphointí API',
    'endpoints_intro' => 'Críochphointí REST roghnaithe. Tá an réimír /api/partner/v1 ar gach cosán. Tá freagraí ar fad mar JSON le ceanntásc API-Version: 2.0.',
    'endpoints_table_aria' => 'Críochphointí API Comhpháirtí',
    'method_label' => 'Modh',
    'path_label' => 'Cosán',
    'scope_label' => 'Scóp',
    'description_label' => 'Cur síos',
    'endpoint_descriptions' => [
        'oauth_token' => 'Malartaigh dintiúir cliaint ar chomhartha iompróra (deonú client_credentials).',
        'oauth_revoke' => 'Cúlghair comhartha iompróra eisithe (RFC 7009).',
        'users_list' => 'Liostaigh baill ghníomhacha. Cuir an raon feidhme users.pii leis chun seoltaí ríomhphoist a fháil.',
        'users_detail' => 'Faigh ball amháin de réir ID.',
        'listings_list' => 'Liostáil liostálacha gníomhacha (seirbhísí agus iarratais).',
        'wallet_balance' => 'Léigh iarmhéid creidmheasa ama ball in uaireanta.',
        'wallet_credit' => 'Cuir uaireanta ama chun sochair tar éis aistriú bainc a bheith glanta. Corp an iarratais: user_id, hours, reference, note?',
        'aggregates_community' => 'Iomláin phobail de réir raoin (gan PII). Úsáideach do dheaiseanna comhpháirtithe.',
        'webhooks_list' => 'Liostaigh do shíntiúis crúcaí gréasáin.',
        'webhooks_create' => 'Liostáil le himeachtaí. Corp an iarratais: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'API na gCrúcaí Gréasáin',
    'webhooks_intro' => 'Liostáil le himeachtaí trí URLanna aisghlaonna HTTPS. Áirítear ceanntásc X-Partner-Signature le gach seachadadh — HMAC-SHA256 den chorp amh, sínithe le rún an tsíntiúis a fhilltear ag am cruthaithe.',
    'webhook_events_title' => 'Imeachtaí ar fáil',
    'webhook_event_wallet_credited' => 'wallet.credited — gníomhaítear nuair a chuireann comhpháirtí uaireanta ama trí /wallet/credit',
    'webhook_create_title' => 'Cruthaigh síntiús',
    'webhook_create_body' => 'POST chuig /api/partner/v1/webhooks/subscriptions le event_types (eagar) agus target_url (https amháin). Áirítear rún aon uaire san fhreagra — stóráil é.',
    'webhook_signing_title' => 'Fíorú sínithe',
    'webhook_signing_body' => 'Ríomh HMAC-SHA256 chorp amh an iarratais le rún an tsíntiúis. Comparáid leis an gceanntásc X-Partner-Signature in am tairiseach.',
];
