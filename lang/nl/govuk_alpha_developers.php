<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/nl/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Ontwikkelaars',
    'meta_description' => 'Ontdek de Project NEXUS partner-API voor OAuth2-authenticatie, scoped endpoints, ondertekende webhooks en integratietoegang.',
    'hero_title' => 'Bouw met NEXUS',
    'hero_subtitle' => 'Een gecureerde REST API voor bank-, betalings- en gemeentelijke administratiepartners. OAuth2 Client Credentials, ondertekende webhooks en een sandbox die je binnen vijf minuten kunt aanspreken.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Server-naar-server authenticatie. Kortlevende bearer-tokens, scope per partner.',
    'feature_curated_title' => 'Gecureerde endpoint-set',
    'feature_curated_body' => 'Alleen wat banken en administratieve systemen echt nodig hebben: gebruikers, advertenties, wallet, aggregaten.',
    'feature_webhooks_title' => 'Ondertekende webhooks',
    'feature_webhooks_body' => 'HMAC-SHA256-handtekeningen, automatische retries, bezorgingsstatus in je dashboard.',
    'feature_rate_limit_title' => 'Rate limits per partner',
    'feature_rate_limit_body' => 'Configureerbare per-minuut quota\'s. 429-antwoorden bevatten Retry-After.',
    'request_access_cta' => 'Toegang aanvragen',
    'request_access_body' => 'Toegang tot de Partner-API wordt verstrekt door je community-beheerder. Neem contact op om een client_id / client_secret-paar te krijgen.',
    'nav' => [
        'overview' => 'Overzicht',
        'auth' => 'Authenticatie',
        'endpoints' => 'Eindpunten',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'API-authenticatie',
    'auth_intro' => 'Wissel je client-credentials in voor een kortlevend bearer-token en voeg het aan elk verzoek toe als Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Verkrijg client-credentials',
    'auth_step1_body' => 'Je community-beheerder maakt een client_id en client_secret aan in de admin-console. Het secret wordt slechts één keer getoond bij aanmaak.',
    'auth_step2_title' => '2. Inwisselen voor een token',
    'auth_step2_body' => 'POST je credentials naar /api/partner/v1/oauth/token. Het antwoord bevat access_token, expires_in (3600s) en de toegekende scope.',
    'auth_step3_title' => '3. Roep de API aan',
    'auth_step3_body' => 'Voeg het token toe aan de Authorization-header. Tokens hebben een scope — de API geeft 403 insufficient_scope terug bij overschrijding.',
    'tabs' => [
        'code_examples' => 'Codevoorbeelden',
        'verification_examples' => 'Verificatie voorbeelden',
    ],
    'curl_example' => 'curl-voorbeeld',
    'js_example' => 'JavaScript-voorbeeld',
    'endpoints_meta_title' => 'API-endpoints',
    'endpoints_intro' => 'Geselecteerde REST-endpoints. Alle paden hebben het prefix /api/partner/v1. Alle antwoorden zijn JSON met API-Version: 2.0 header.',
    'endpoints_table_aria' => 'Partner-API-endpoints',
    'method_label' => 'Methode',
    'path_label' => 'Pad',
    'scope_label' => 'Domein',
    'description_label' => 'Beschrijving',
    'endpoint_descriptions' => [
        'oauth_token' => 'Wissel clientgegevens in voor een bearer-token (client_credentials grant).',
        'oauth_revoke' => 'Trek een uitgegeven bearer-token in (RFC 7009).',
        'users_list' => 'Lijst actieve leden. Voeg scope users.pii toe om e-mail te ontvangen.',
        'users_detail' => 'Haal een enkel lid op via ID.',
        'listings_list' => 'Lijst actieve advertenties (diensten en aanvragen).',
        'wallet_balance' => 'Lees het tijdcredit-saldo van een lid in uren.',
        'wallet_credit' => 'Credit tijduren vanuit een verwerkte bankoverschrijving. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Gebucketeerde community-totalen (geen PII). Handig voor partnerdashboards.',
        'webhooks_list' => 'Lijst je webhook-abonnementen.',
        'webhooks_create' => 'Abonneer je op events. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'API-webhooks',
    'webhooks_intro' => 'Abonneer je op events met HTTPS-callback-URL\'s. Elke bezorging bevat een X-Partner-Signature-header — een HMAC-SHA256 van de ruwe body, ondertekend met het abonnement-secret dat bij aanmaak werd geretourneerd.',
    'webhook_events_title' => 'Beschikbare events',
    'webhook_event_wallet_credited' => 'wallet.credited — geactiveerd wanneer een partner tijduren crediteert via /wallet/credit',
    'webhook_create_title' => 'Een abonnement aanmaken',
    'webhook_create_body' => 'POST naar /api/partner/v1/webhooks/subscriptions met event_types (array) en target_url (alleen https). Het antwoord bevat een eenmalig secret — bewaar het.',
    'webhook_signing_title' => 'Handtekeningen verifiëren',
    'webhook_signing_body' => 'Bereken HMAC-SHA256 van de ruwe request body met je abonnement-secret. Vergelijk in constante tijd met de X-Partner-Signature-header.',
];
