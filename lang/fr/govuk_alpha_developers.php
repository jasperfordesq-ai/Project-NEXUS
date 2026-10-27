<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/fr/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Développeurs',
    'meta_description' => 'Explorez l\'API partenaires de Project NEXUS pour l\'authentification OAuth2, les endpoints à portée définie, les webhooks signés et l\'accès à l\'intégration.',
    'hero_title' => 'Construisez avec NEXUS',
    'hero_subtitle' => 'Une API REST sélectionnée pour les partenaires bancaires, de paiement et d\'administration municipale. OAuth2 Client Credentials, webhooks signés et un bac à sable accessible en cinq minutes.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Authentification serveur à serveur. Jetons bearer à courte durée, scope par partenaire.',
    'feature_curated_title' => 'Ensemble d\'endpoints sélectionnés',
    'feature_curated_body' => 'Seulement ce dont les banques et les systèmes d\'administration ont vraiment besoin : utilisateurs, annonces, portefeuille, agrégats.',
    'feature_webhooks_title' => 'Webhooks signés',
    'feature_webhooks_body' => 'Signatures HMAC-SHA256, réessais automatiques, état de livraison dans votre tableau de bord.',
    'feature_rate_limit_title' => 'Limites de débit par partenaire',
    'feature_rate_limit_body' => 'Quotas par minute configurables. Les réponses 429 incluent Retry-After.',
    'request_access_cta' => 'Demander l\'accès',
    'request_access_body' => 'L\'accès à l\'API partenaires est fourni par votre administrateur de communauté. Contactez-le pour obtenir une paire client_id / client_secret.',
    'nav' => [
        'overview' => 'Aperçu',
        'auth' => 'Authentification',
        'endpoints' => 'Points de terminaison',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'Authentification de l\'API',
    'auth_intro' => 'Échangez vos identifiants client contre un jeton bearer à courte durée, puis attachez-le à chaque requête sous la forme Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Obtenez les identifiants client',
    'auth_step1_body' => 'Votre administrateur de communauté fournit un client_id et un client_secret dans la console d\'administration. Le secret n\'est affiché qu\'une seule fois à la création.',
    'auth_step2_title' => '2. Échangez contre un jeton',
    'auth_step2_body' => 'Envoyez vos identifiants en POST à /api/partner/v1/oauth/token. La réponse contient access_token, expires_in (3600s) et le scope accordé.',
    'auth_step3_title' => '3. Appelez l\'API',
    'auth_step3_body' => 'Attachez le jeton dans l\'en-tête Authorization. Les jetons sont restreints à un scope — l\'API renverra 403 insufficient_scope si vous dépassez vos droits.',
    'tabs' => [
        'code_examples' => 'Exemples de codes',
        'verification_examples' => 'Exemples de vérification',
    ],
    'curl_example' => 'Exemple curl',
    'js_example' => 'Exemple JavaScript',
    'endpoints_meta_title' => 'Endpoints de l\'API',
    'endpoints_intro' => 'Endpoints REST sélectionnés. Tous les chemins commencent par /api/partner/v1. Toutes les réponses sont en JSON avec l\'en-tête API-Version: 2.0.',
    'endpoints_table_aria' => 'Endpoints de l\'API partenaires',
    'method_label' => 'Méthode',
    'path_label' => 'Chemin',
    'scope_label' => 'Portée',
    'description_label' => 'Description',
    'endpoint_descriptions' => [
        'oauth_token' => 'Échangez les identifiants client contre un jeton bearer (octroi client_credentials).',
        'oauth_revoke' => 'Révoquez un jeton bearer émis (RFC 7009).',
        'users_list' => 'Lister les membres actifs. Ajoutez la portée users.pii pour recevoir l\'e-mail.',
        'users_detail' => 'Récupérer un membre par ID.',
        'listings_list' => 'Lister les annonces actives (services et demandes).',
        'wallet_balance' => 'Lire le solde de crédit-temps d\'un membre en heures.',
        'wallet_credit' => 'Créditer des heures à partir d\'un virement bancaire réglé. Corps : user_id, hours, reference, note ?',
        'aggregates_community' => 'Totaux de la communauté regroupés (sans PII). Utile pour les tableaux de bord partenaires.',
        'webhooks_list' => 'Lister vos abonnements aux webhooks.',
        'webhooks_create' => 'S\'abonner aux événements. Corps : event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'Webhooks de l\'API',
    'webhooks_intro' => 'Abonnez-vous à des événements avec des URL de callback HTTPS. Chaque livraison inclut un en-tête X-Partner-Signature — un HMAC-SHA256 du corps brut, signé avec le secret d\'abonnement retourné à la création.',
    'webhook_events_title' => 'Événements disponibles',
    'webhook_event_wallet_credited' => 'wallet.credited — déclenché quand un partenaire crédite des heures via /wallet/credit',
    'webhook_create_title' => 'Créer un abonnement',
    'webhook_create_body' => 'POST sur /api/partner/v1/webhooks/subscriptions avec event_types (tableau) et target_url (https uniquement). La réponse contient un secret unique — conservez-le.',
    'webhook_signing_title' => 'Vérifier les signatures',
    'webhook_signing_body' => 'Calculez le HMAC-SHA256 du corps brut de la requête avec le secret de votre abonnement. Comparez-le à l\'en-tête X-Partner-Signature en temps constant.',
];
