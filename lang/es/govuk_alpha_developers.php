<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/es/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Desarrolladores',
    'meta_description' => 'Explora la API de socios de Project NEXUS para autenticación OAuth2, endpoints con ámbito, webhooks firmados y acceso de integración.',
    'hero_title' => 'Construye con NEXUS',
    'hero_subtitle' => 'Una API REST curada para socios bancarios, de pagos y de administración municipal. OAuth2 Client Credentials, webhooks firmados y un sandbox al que puedes acceder en cinco minutos.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Autenticación servidor a servidor. Tokens bearer de corta duración, con scope por socio.',
    'feature_curated_title' => 'Conjunto de endpoints curado',
    'feature_curated_body' => 'Solo lo que bancos y sistemas de administración realmente necesitan: usuarios, anuncios, monedero, agregados.',
    'feature_webhooks_title' => 'Webhooks firmados',
    'feature_webhooks_body' => 'Firmas HMAC-SHA256, reintentos automáticos, estado de entrega en tu panel.',
    'feature_rate_limit_title' => 'Límites de tasa por socio',
    'feature_rate_limit_body' => 'Cuotas por minuto configurables. Las respuestas 429 incluyen Retry-After.',
    'request_access_cta' => 'Solicitar acceso',
    'request_access_body' => 'El acceso a la API de socios lo proporciona tu administrador de comunidad. Contáctalo para obtener un par client_id / client_secret.',
    'nav' => [
        'overview' => 'Visión general',
        'auth' => 'Autenticación',
        'endpoints' => 'Puntos finales',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'Autenticación de la API',
    'auth_intro' => 'Intercambia tus credenciales de cliente por un token bearer de corta duración y adjúntalo a cada solicitud como Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Obtén credenciales de cliente',
    'auth_step1_body' => 'Tu administrador de comunidad proporciona un client_id y un client_secret en la consola de administración. El secret se muestra solo una vez al crearlo.',
    'auth_step2_title' => '2. Intercámbialas por un token',
    'auth_step2_body' => 'Envía tus credenciales por POST a /api/partner/v1/oauth/token. La respuesta incluye access_token, expires_in (3600s) y el scope concedido.',
    'auth_step3_title' => '3. Llama a la API',
    'auth_step3_body' => 'Adjunta el token en la cabecera Authorization. Los tokens tienen scope — la API devolverá 403 insufficient_scope si excedes tu permiso.',
    'tabs' => [
        'code_examples' => 'Ejemplos de código',
        'verification_examples' => 'Ejemplos de verificación',
    ],
    'curl_example' => 'Ejemplo curl',
    'js_example' => 'Ejemplo JavaScript',
    'endpoints_meta_title' => 'Endpoints de la API',
    'endpoints_intro' => 'Endpoints REST seleccionados. Todas las rutas tienen el prefijo /api/partner/v1. Todas las respuestas son JSON con cabecera API-Version: 2.0.',
    'endpoints_table_aria' => 'Endpoints de la API de socios',
    'method_label' => 'Método',
    'path_label' => 'Ruta',
    'scope_label' => 'Alcance',
    'description_label' => 'Descripción',
    'endpoint_descriptions' => [
        'oauth_token' => 'Intercambia credenciales de cliente por un token bearer (concesión client_credentials).',
        'oauth_revoke' => 'Revoca un token bearer emitido (RFC 7009).',
        'users_list' => 'Lista los miembros activos. Añade el ámbito users.pii para recibir el correo.',
        'users_detail' => 'Obtén un miembro por ID.',
        'listings_list' => 'Lista los anuncios activos (servicios y solicitudes).',
        'wallet_balance' => 'Lee el saldo de tiempo de un miembro en horas.',
        'wallet_credit' => 'Acredita horas de tiempo desde una transferencia bancaria liquidada. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Totales agrupados de la comunidad (sin PII). Útil para paneles de socios.',
        'webhooks_list' => 'Lista tus suscripciones a webhooks.',
        'webhooks_create' => 'Suscríbete a eventos. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'Webhooks de la API',
    'webhooks_intro' => 'Suscríbete a eventos con URLs de callback HTTPS. Cada entrega incluye una cabecera X-Partner-Signature — un HMAC-SHA256 del cuerpo bruto, firmado con el secret de la suscripción devuelto en la creación.',
    'webhook_events_title' => 'Eventos disponibles',
    'webhook_event_wallet_credited' => 'wallet.credited — se dispara cuando un socio acredita horas de tiempo vía /wallet/credit',
    'webhook_create_title' => 'Crear una suscripción',
    'webhook_create_body' => 'POST a /api/partner/v1/webhooks/subscriptions con event_types (array) y target_url (solo https). La respuesta incluye un secret único — guárdalo.',
    'webhook_signing_title' => 'Verificar firmas',
    'webhook_signing_body' => 'Calcula HMAC-SHA256 del cuerpo bruto de la solicitud usando el secret de tu suscripción. Compáralo con la cabecera X-Partner-Signature en tiempo constante.',
];
