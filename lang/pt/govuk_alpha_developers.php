<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/pt/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => 'Programadores',
    'meta_description' => 'Explore a API de parceiros Project NEXUS para autenticação OAuth2, endpoints com âmbito, webhooks assinados e acesso de integração.',
    'hero_title' => 'Constrói com NEXUS',
    'hero_subtitle' => 'Uma API REST curada para parceiros bancários, de pagamento e de administração municipal. OAuth2 Client Credentials, webhooks assinados e uma sandbox acessível em cinco minutos.',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'Autenticação servidor a servidor. Bearer tokens de curta duração, com scope por parceiro.',
    'feature_curated_title' => 'Conjunto de endpoints curado',
    'feature_curated_body' => 'Só o que bancos e sistemas de administração realmente precisam: usuários, anúncios, carteira, agregados.',
    'feature_webhooks_title' => 'Webhooks assinados',
    'feature_webhooks_body' => 'Assinaturas HMAC-SHA256, repetições automáticas, estado de entrega no teu painel.',
    'feature_rate_limit_title' => 'Limites de taxa por parceiro',
    'feature_rate_limit_body' => 'Quotas por minuto configuráveis. Respostas 429 incluem Retry-After.',
    'request_access_cta' => 'Pedir acesso',
    'request_access_body' => 'O acesso à API de parceiros é fornecido pelo administrador da tua comunidade. Contacta-o para obter um par client_id / client_secret.',
    'nav' => [
        'overview' => 'Visão geral',
        'auth' => 'Autenticação',
        'endpoints' => 'Pontos finais',
        'webhooks' => 'Webhooks',
    ],
    'auth_meta_title' => 'Autenticação da API',
    'auth_intro' => 'Troca as tuas credenciais de cliente por um bearer token de curta duração e anexa-o a cada pedido como Authorization: Bearer <token>.',
    'auth_step1_title' => '1. Obter credenciais de cliente',
    'auth_step1_body' => 'O administrador da tua comunidade fornece um client_id e um client_secret na consola de administração. O secret é mostrado apenas uma vez na criação.',
    'auth_step2_title' => '2. Trocar por um token',
    'auth_step2_body' => 'Envia as credenciais por POST para /api/partner/v1/oauth/token. A resposta inclui access_token, expires_in (3600s) e o scope concedido.',
    'auth_step3_title' => '3. Chamar a API',
    'auth_step3_body' => 'Anexa o token ao cabeçalho Authorization. Os tokens têm scope — a API devolve 403 insufficient_scope se excederes a tua permissão.',
    'tabs' => [
        'code_examples' => 'Exemplos de código',
        'verification_examples' => 'Exemplos de verificação',
    ],
    'curl_example' => 'Exemplo curl',
    'js_example' => 'Exemplo JavaScript',
    'endpoints_meta_title' => 'Endpoints da API',
    'endpoints_intro' => 'Endpoints REST selecionados. Todos os caminhos têm o prefixo /api/partner/v1. Todas as respostas são JSON com o cabeçalho API-Version: 2.0.',
    'endpoints_table_aria' => 'Endpoints da API de parceiros',
    'method_label' => 'Método',
    'path_label' => 'Caminho',
    'scope_label' => 'Escopo',
    'description_label' => 'Descrição',
    'endpoint_descriptions' => [
        'oauth_token' => 'Troque credenciais de cliente por um token bearer (concessão client_credentials).',
        'oauth_revoke' => 'Revogue um token bearer emitido (RFC 7009).',
        'users_list' => 'Liste os membros ativos. Adicione o âmbito users.pii para receber o e-mail.',
        'users_detail' => 'Obtenha um único membro pelo ID.',
        'listings_list' => 'Liste anúncios ativos (serviços e pedidos).',
        'wallet_balance' => 'Leia o saldo de crédito-tempo de um membro em horas.',
        'wallet_credit' => 'Credite horas de tempo a partir de uma transferência bancária liquidada. Body: user_id, hours, reference, note?',
        'aggregates_community' => 'Totais agregados da comunidade (sem PII). Útil para dashboards de parceiros.',
        'webhooks_list' => 'Liste as suas subscrições de webhooks.',
        'webhooks_create' => 'Subscreva eventos. Body: event_types[], target_url (https://).',
    ],
    'webhooks_meta_title' => 'Webhooks da API',
    'webhooks_intro' => 'Subscreve eventos com URLs de callback HTTPS. Cada entrega inclui um cabeçalho X-Partner-Signature — um HMAC-SHA256 do corpo bruto, assinado com o secret da subscrição devolvido na criação.',
    'webhook_events_title' => 'Eventos disponíveis',
    'webhook_event_wallet_credited' => 'wallet.credited — disparado quando um parceiro credita horas via /wallet/credit',
    'webhook_create_title' => 'Criar uma subscrição',
    'webhook_create_body' => 'POST para /api/partner/v1/webhooks/subscriptions com event_types (array) e target_url (apenas https). A resposta inclui um secret único — guarda-o.',
    'webhook_signing_title' => 'Verificar assinaturas',
    'webhook_signing_body' => 'Calcula o HMAC-SHA256 do corpo bruto do pedido usando o secret da tua subscrição. Compara-o com o cabeçalho X-Partner-Signature em tempo constante.',
];
