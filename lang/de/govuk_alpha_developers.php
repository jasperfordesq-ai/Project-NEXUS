<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/de/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Entwickler',
    'meta_description' => 'Entdecken Sie die Project NEXUS Partner-API für OAuth2-Authentifizierung, scoped Endpoints, signierte Webhooks und Integrationszugriff.',
    'hero_title' => 'Mit NEXUS bauen',
    'hero_subtitle' => 'Eine kuratierte REST-API für Banking-, Zahlungs- und kommunale Verwaltungspartner. OAuth2 Client Credentials, signierte Webhooks und eine Sandbox, die Sie in fünf Minuten nutzen können.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Server-zu-Server-Authentifizierung. Kurzlebige Bearer-Tokens, partnerspezifischer Scope.',
    'feature_curated_title' => 'Kuratierter Endpunkt-Satz',
    'feature_curated_body' => 'Nur was Banken und Verwaltungssysteme tatsächlich brauchen: Nutzer, Inserate, Wallet, Aggregate.',
    'feature_webhooks_title' => 'Signierte Webhooks',
    'feature_webhooks_body' => 'HMAC-SHA256-Signaturen, automatische Wiederholungen, Auslieferungszustand in Ihrem Dashboard.',
    'feature_rate_limit_title' => 'Partnerspezifische Ratenbegrenzung',
    'feature_rate_limit_body' => 'Konfigurierbare Pro-Minute-Kontingente. 429-Antworten enthalten Retry-After.',
    'request_access_cta' => 'Zugang anfordern',
    'request_access_body' => 'Der Zugang zur Partner-API wird von Ihrem Community-Administrator bereitgestellt. Kontaktieren Sie ihn, um ein client_id / client_secret-Paar zu erhalten.',
    'nav' => [
        'overview' => 'Übersicht',
        'auth' => 'Authentifizierung',
        'endpoints' => 'Endpunkte',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'API-Authentifizierung',
    'auth_intro' => 'Tauschen Sie Ihre Client-Anmeldedaten gegen ein kurzlebiges Bearer-Token und hängen Sie es jeder Anfrage als Authorization: Bearer <token> an.',
    'auth_step1_title' => '1. Client-Anmeldedaten erhalten',
    'auth_step1_body' => 'Ihr Community-Administrator stellt eine client_id und ein client_secret in der Admin-Konsole bereit. Das Secret wird nur einmal bei der Erstellung angezeigt.',
    'auth_step2_title' => '2. Gegen Token tauschen',
    'auth_step2_body' => 'Senden Sie Ihre Anmeldedaten per POST an /api/partner/v1/oauth/token. Die Antwort enthält access_token, expires_in (3600s) und gewährten Scope.',
    'auth_step3_title' => '3. Die API aufrufen',
    'auth_step3_body' => 'Hängen Sie das Token dem Authorization-Header an. Tokens sind Scope-begrenzt — die API gibt 403 insufficient_scope zurück, wenn Sie Ihre Berechtigung überschreiten.',
    'tabs' => [
        'code_examples' => 'Codebeispiele',
        'verification_examples' => 'Verifizierungsbeispiele',
    ],
    'curl_example' => 'curl-Beispiel',
    'js_example' => 'JavaScript-Beispiel',
    'endpoints_meta_title' => 'API-Endpoints',
    'endpoints_intro' => 'Sorgfältig ausgewählte REST-Endpunkte. Alle Pfade beginnen mit /api/partner/v1. Alle Antworten sind JSON mit API-Version: 2.0 Header.',
    'endpoints_table_aria' => 'Partner-API-Endpoints',
    'method_label' => 'Methode',
    'path_label' => 'Pfad',
    'scope_label' => 'Umfang',
    'description_label' => 'Beschreibung',
    'endpoint_descriptions' => [
        'oauth_token' => 'Client-Anmeldedaten gegen ein Bearer-Token tauschen (client_credentials grant).',
        'oauth_revoke' => 'Ein ausgestelltes Bearer-Token widerrufen (RFC 7009).',
        'users_list' => 'Aktive Mitglieder auflisten. Fügen Sie den Scope users.pii hinzu, um die E-Mail zu erhalten.',
        'users_detail' => 'Ein einzelnes Mitglied per ID abrufen.',
        'listings_list' => 'Aktive Inserate auflisten (Angebote und Gesuche).',
        'wallet_balance' => 'Zeitguthaben eines Mitglieds in Stunden lesen.',
        'wallet_credit' => 'Zeitstunden aus einer abgeschlossenen Banküberweisung gutschreiben. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Gebündelte Community-Summen (ohne PII). Nützlich für Partner-Dashboards.',
        'webhooks_list' => 'Ihre Webhook-Abonnements auflisten.',
        'webhooks_create' => 'Events abonnieren. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'API-Webhooks',
    'webhooks_intro' => 'Abonnieren Sie Ereignisse mit HTTPS-Callback-URLs. Jede Auslieferung enthält einen X-Partner-Signature-Header — ein HMAC-SHA256 des Roh-Bodys, signiert mit dem bei der Erstellung zurückgegebenen Abonnement-Secret.',
    'webhook_events_title' => 'Verfügbare Ereignisse',
    'webhook_event_wallet_credited' => 'wallet.credited — wird ausgelöst, wenn ein Partner Zeitstunden über /wallet/credit gutschreibt',
    'webhook_create_title' => 'Ein Abonnement erstellen',
    'webhook_create_body' => 'POST an /api/partner/v1/webhooks/subscriptions mit event_types (Array) und target_url (nur https). Die Antwort enthält ein einmaliges Secret — speichern Sie es.',
    'webhook_signing_title' => 'Signaturen verifizieren',
    'webhook_signing_body' => 'Berechnen Sie den HMAC-SHA256 des Roh-Request-Bodys mit Ihrem Abonnement-Secret. Vergleichen Sie ihn in konstanter Zeit mit dem X-Partner-Signature-Header.',
];
