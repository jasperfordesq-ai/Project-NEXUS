<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/it/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Sviluppatori',
    'meta_description' => 'Esplora l\'API partner di Project NEXUS per autenticazione OAuth2, endpoint con ambito, webhook firmati e accesso all\'integrazione.',
    'hero_title' => 'Costruisci con NEXUS',
    'hero_subtitle' => 'Un\'API REST selezionata per partner bancari, di pagamento e amministrativi municipali. OAuth2 Client Credentials, webhook firmati e una sandbox accessibile in cinque minuti.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Autenticazione server-to-server. Bearer token di breve durata, scope per partner.',
    'feature_curated_title' => 'Set di endpoint selezionato',
    'feature_curated_body' => 'Solo ciò di cui banche e sistemi amministrativi hanno veramente bisogno: utenti, annunci, wallet, aggregati.',
    'feature_webhooks_title' => 'Webhook firmati',
    'feature_webhooks_body' => 'Firme HMAC-SHA256, retry automatici, stato delle consegne nella dashboard.',
    'feature_rate_limit_title' => 'Limiti di frequenza per partner',
    'feature_rate_limit_body' => 'Quote per minuto configurabili. Le risposte 429 includono Retry-After.',
    'request_access_cta' => 'Richiedi accesso',
    'request_access_body' => 'L\'accesso all\'API partner è fornito dall\'amministratore della tua comunità. Contattalo per ottenere una coppia client_id / client_secret.',
    'nav' => [
        'overview' => 'Panoramica',
        'auth' => 'Autenticazione',
        'endpoints' => 'Endpoint',
        'webhooks' => 'Webhook',
    ],
    'auth_meta_title' => 'Autenticazione API',
    'auth_intro' => 'Scambia le tue credenziali client con un bearer token di breve durata, poi allegalo a ogni richiesta come Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Ottieni le credenziali client',
    'auth_step1_body' => 'L\'amministratore della tua comunità fornisce un client_id e un client_secret nella console di amministrazione. Il secret viene mostrato solo una volta alla creazione.',
    'auth_step2_title' => '2. Scambia per un token',
    'auth_step2_body' => 'Invia le credenziali in POST a /api/partner/v1/oauth/token. La risposta include access_token, expires_in (3600s) e lo scope concesso.',
    'auth_step3_title' => '3. Chiama l\'API',
    'auth_step3_body' => 'Allega il token all\'header Authorization. I token hanno uno scope — l\'API restituirà 403 insufficient_scope se superi i permessi.',
    'tabs' => [
        'code_examples' => 'Esempi di codice',
        'verification_examples' => 'Esempi di verifica',
    ],
    'curl_example' => 'Esempio curl',
    'js_example' => 'Esempio JavaScript',
    'endpoints_meta_title' => 'Endpoint API',
    'endpoints_intro' => 'Endpoint REST selezionati. Tutti i percorsi hanno il prefisso /api/partner/v1. Tutte le risposte sono JSON con header API-Version: 2.0.',
    'endpoints_table_aria' => 'Endpoint API partner',
    'method_label' => 'Metodo',
    'path_label' => 'Percorso',
    'scope_label' => 'Ambito',
    'description_label' => 'Descrizione',
    'endpoint_descriptions' => [
        'oauth_token' => 'Scambia le credenziali del client per un token bearer (concessione client_credentials).',
        'oauth_revoke' => 'Revoca un token bearer emesso (RFC 7009).',
        'users_list' => 'Elenca i membri attivi. Aggiungi lo scope users.pii per ricevere l\'email.',
        'users_detail' => 'Recupera un singolo membro tramite ID.',
        'listings_list' => 'Elenca gli annunci attivi (servizi e richieste).',
        'wallet_balance' => 'Leggi il saldo di credito-tempo di un membro in ore.',
        'wallet_credit' => 'Accredita ore di tempo da un bonifico bancario regolato. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Totali della community raggruppati (senza PII). Utile per dashboard partner.',
        'webhooks_list' => 'Elenca le tue sottoscrizioni webhook.',
        'webhooks_create' => 'Iscriviti agli eventi. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'Webhook API',
    'webhooks_intro' => 'Iscriviti agli eventi con URL di callback HTTPS. Ogni consegna include un header X-Partner-Signature — un HMAC-SHA256 del corpo grezzo, firmato con il secret della sottoscrizione restituito alla creazione.',
    'webhook_events_title' => 'Eventi disponibili',
    'webhook_event_wallet_credited' => 'wallet.credited — si attiva quando un partner accredita ore tempo via /wallet/credit',
    'webhook_create_title' => 'Crea una sottoscrizione',
    'webhook_create_body' => 'POST a /api/partner/v1/webhooks/subscriptions con event_types (array) e target_url (solo https). La risposta include un secret monouso — conservalo.',
    'webhook_signing_title' => 'Verifica le firme',
    'webhook_signing_body' => 'Calcola HMAC-SHA256 del corpo grezzo della richiesta usando il secret della sottoscrizione. Confrontalo con l\'header X-Partner-Signature in tempo costante.',
];
