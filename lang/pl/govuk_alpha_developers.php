<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/pl/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Programiści',
    'meta_description' => 'Poznaj partnerskie API Project NEXUS dla uwierzytelniania OAuth2, endpointów z zakresem, podpisanych webhooków i dostępu integracyjnego.',
    'hero_title' => 'Buduj z NEXUS',
    'hero_subtitle' => 'Wyselekcjonowane REST API dla partnerów bankowych, płatniczych i administracji gminnej. OAuth2 Client Credentials, podpisane webhooki i sandbox, do którego dotrzesz w pięć minut.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Uwierzytelnianie serwer-serwer. Krótkotrwałe tokeny bearer, scope na partnera.',
    'feature_curated_title' => 'Wyselekcjonowany zestaw endpointów',
    'feature_curated_body' => 'Tylko to, czego naprawdę potrzebują banki i systemy administracyjne: użytkownicy, ogłoszenia, portfel, agregaty.',
    'feature_webhooks_title' => 'Podpisane webhooki',
    'feature_webhooks_body' => 'Podpisy HMAC-SHA256, automatyczne ponowienia, status dostarczania w panelu.',
    'feature_rate_limit_title' => 'Limity szybkości na partnera',
    'feature_rate_limit_body' => 'Konfigurowalne limity na minutę. Odpowiedzi 429 zawierają Retry-After.',
    'request_access_cta' => 'Poproś o dostęp',
    'request_access_body' => 'Dostęp do Partner API udostępnia administrator Twojej społeczności. Skontaktuj się z nim, aby uzyskać parę client_id / client_secret.',
    'nav' => [
        'overview' => 'Przegląd',
        'auth' => 'Uwierzytelnianie',
        'endpoints' => 'Endpointy',
        'webhooks' => 'Webhooki',
    ],
    'auth_meta_title' => 'Uwierzytelnianie API',
    'auth_intro' => 'Wymień dane uwierzytelniające klienta na krótkotrwały token bearer i dodawaj go do każdego żądania jako Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Uzyskaj dane uwierzytelniające klienta',
    'auth_step1_body' => 'Administrator Twojej społeczności udostępnia client_id i client_secret w konsoli admina. Secret jest pokazywany tylko raz przy tworzeniu.',
    'auth_step2_title' => '2. Wymień na token',
    'auth_step2_body' => 'Wyślij dane uwierzytelniające metodą POST na /api/partner/v1/oauth/token. Odpowiedź zawiera access_token, expires_in (3600s) i przyznany scope.',
    'auth_step3_title' => '3. Wywołaj API',
    'auth_step3_body' => 'Dodaj token w nagłówku Authorization. Tokeny mają zakres (scope) — API zwróci 403 insufficient_scope przy przekroczeniu uprawnień.',
    'tabs' => [
        'code_examples' => 'Przykłady kodu',
        'verification_examples' => 'Przykłady weryfikacji',
    ],
    'curl_example' => 'Przykład curl',
    'js_example' => 'Przykład JavaScript',
    'endpoints_meta_title' => 'Endpointy API',
    'endpoints_intro' => 'Wyselekcjonowane endpointy REST. Wszystkie ścieżki mają prefiks /api/partner/v1. Wszystkie odpowiedzi są w JSON z nagłówkiem API-Version: 2.0.',
    'endpoints_table_aria' => 'Endpointy partnerskiego API',
    'method_label' => 'Metoda',
    'path_label' => 'Ścieżka',
    'scope_label' => 'Zakres',
    'description_label' => 'Opis',
    'endpoint_descriptions' => [
        'oauth_token' => 'Wymień poświadczenia klienta na token bearer (grant client_credentials).',
        'oauth_revoke' => 'Unieważnij wydany token bearer (RFC 7009).',
        'users_list' => 'Wyświetl listę aktywnych członków. Dodaj zakres users.pii, aby otrzymywać e-mail.',
        'users_detail' => 'Pobierz pojedynczego członka według ID.',
        'listings_list' => 'Wyświetl listę aktywnych ogłoszeń (usługi i prośby).',
        'wallet_balance' => 'Odczytaj saldo kredytu czasowego członka w godzinach.',
        'wallet_credit' => 'Zaksięguj godziny czasu z rozliczonego przelewu bankowego. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Pogrupowane sumy społeczności (bez PII). Przydatne dla pulpitów partnerów.',
        'webhooks_list' => 'Wyświetl swoje subskrypcje webhooków.',
        'webhooks_create' => 'Subskrybuj zdarzenia. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'Webhooki API',
    'webhooks_intro' => 'Subskrybuj zdarzenia z adresami callback HTTPS. Każda dostawa zawiera nagłówek X-Partner-Signature — HMAC-SHA256 surowego ciała podpisany secretem subskrypcji zwróconym przy tworzeniu.',
    'webhook_events_title' => 'Dostępne zdarzenia',
    'webhook_event_wallet_credited' => 'wallet.credited — wywoływane, gdy partner zasili godziny przez /wallet/credit',
    'webhook_create_title' => 'Utwórz subskrypcję',
    'webhook_create_body' => 'POST na /api/partner/v1/webhooks/subscriptions z event_types (tablica) i target_url (tylko https). Odpowiedź zawiera jednorazowy secret — zapisz go.',
    'webhook_signing_title' => 'Weryfikacja podpisów',
    'webhook_signing_body' => 'Oblicz HMAC-SHA256 surowego ciała żądania używając secretu subskrypcji. Porównaj z nagłówkiem X-Partner-Signature w czasie stałym.',
];
