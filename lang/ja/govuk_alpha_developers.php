<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

// Developer documentation for the Partner API on the accessible frontend
// (web-uk /developers, /developers/auth, /developers/endpoints,
// /developers/webhooks). Copied from React's `developers.*` keys in
// react-frontend/public/locales/ja/common.json (DevelopersHomePage,
// DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage).
// Code samples, HTTP methods, endpoint paths and scope names are literal
// technical text and live in web-uk/src/routes/developers.js, not here.
return [
    'page_title' => '開発者',
    'meta_description' => 'OAuth2認証、スコープ付きエンドポイント、署名付きWebhook、統合アクセスのためのProject NEXUSパートナーAPIをご紹介します。',
    'hero_title' => 'NEXUSで構築',
    'hero_subtitle' => '銀行、決済、自治体管理パートナー向けの厳選REST API。OAuth2 Client Credentials、署名付きWebhook、5分でアクセスできるサンドボックス。',
    'feature_oauth_title' => 'OAuth2 Client Credentials',
    'feature_oauth_body' => 'サーバー間認証。短命のベアラートークン、パートナーごとのスコープ。',
    'feature_curated_title' => '厳選されたエンドポイントセット',
    'feature_curated_body' => '銀行や管理システムが本当に必要とするものだけ：ユーザー、掲載、ウォレット、集計。',
    'feature_webhooks_title' => '署名付きWebhook',
    'feature_webhooks_body' => 'HMAC-SHA256署名、自動リトライ、ダッシュボードでの配信状況。',
    'feature_rate_limit_title' => 'パートナーごとのレート制限',
    'feature_rate_limit_body' => '分単位の設定可能なクォータ。429応答にはRetry-Afterが含まれます。',
    'request_access_cta' => 'アクセスをリクエスト',
    'request_access_body' => 'Partner APIアクセスはコミュニティ管理者が発行します。client_id / client_secretのペアを取得するにはご連絡ください。',
    'nav' => [
        'overview' => '概要',
        'auth' => '認証',
        'endpoints' => 'エンドポイント',
        'webhooks' => 'Webhook',
    ],
    'auth_meta_title' => 'API認証',
    'auth_intro' => 'クライアント認証情報を短命のベアラートークンと交換し、各リクエストにAuthorization: Bearer <token>として付与します。',
    'auth_step1_title' => '1. クライアント認証情報を取得',
    'auth_step1_body' => 'コミュニティ管理者が管理コンソールでclient_idとclient_secretを発行します。シークレットは作成時のみ一度だけ表示されます。',
    'auth_step2_title' => '2. トークンと交換',
    'auth_step2_body' => '認証情報を/api/partner/v1/oauth/tokenにPOSTします。応答にはaccess_token、expires_in（3600秒）、付与されたスコープが含まれます。',
    'auth_step3_title' => '3. APIを呼び出す',
    'auth_step3_body' => 'トークンをAuthorizationヘッダーに付与します。トークンにはスコープがあり、権限を超えると403 insufficient_scopeが返ります。',
    'tabs' => [
        'code_examples' => 'コード例',
        'verification_examples' => '検証例',
    ],
    'curl_example' => 'curlの例',
    'js_example' => 'JavaScriptの例',
    'endpoints_meta_title' => 'APIエンドポイント',
    'endpoints_intro' => '厳選されたRESTエンドポイント。すべてのパスは/api/partner/v1の接頭辞付き。応答はすべてJSONでAPI-Version: 2.0ヘッダー付き。',
    'endpoints_table_aria' => 'パートナーAPIエンドポイント',
    'method_label' => 'メソッド',
    'path_label' => 'パス',
    'scope_label' => 'スコープ',
    'description_label' => '説明',
    'endpoint_descriptions' => [
        'oauth_token' => 'クライアント認証情報をベアラートークンと交換します（client_credentialsグラント）。',
        'oauth_revoke' => '発行済みベアラートークンを失効させます（RFC 7009）。',
        'users_list' => 'アクティブなメンバーを一覧表示します。メールを受信するにはusers.piiスコープを追加してください。',
        'users_detail' => 'IDで1人のメンバーを取得します。',
        'listings_list' => '有効なリスティング（サービスとリクエスト）を一覧表示します。',
        'wallet_balance' => 'メンバーのタイムクレジット残高を時間単位で読み取ります。',
        'wallet_credit' => '決済済みの銀行振込から時間をクレジットします。ボディ: user_id, hours, reference, note?',
        'aggregates_community' => 'バケット化されたコミュニティ合計（PIIなし）。パートナーダッシュボードに有用。',
        'webhooks_list' => 'Webhookサブスクリプションを一覧表示します。',
        'webhooks_create' => 'イベントをサブスクライブします。ボディ: event_types[], target_url (https://)。',
    ],
    'webhooks_meta_title' => 'API Webhook',
    'webhooks_intro' => 'HTTPSコールバックURLでイベントを購読します。各配信にはX-Partner-Signatureヘッダー — 作成時に返されるサブスクリプションシークレットで署名された生本体のHMAC-SHA256 — が含まれます。',
    'webhook_events_title' => '利用可能なイベント',
    'webhook_event_wallet_credited' => 'wallet.credited — パートナーが/wallet/credit経由で時間を入金したときに発火',
    'webhook_create_title' => 'サブスクリプションを作成',
    'webhook_create_body' => '/api/partner/v1/webhooks/subscriptionsにevent_types（配列）とtarget_url（httpsのみ）を付けてPOST。応答にはワンタイムのシークレットが含まれます — 保管してください。',
    'webhook_signing_title' => '署名の検証',
    'webhook_signing_body' => 'サブスクリプションシークレットを鍵に、リクエスト本体のHMAC-SHA256を計算します。X-Partner-Signatureヘッダーと定数時間で比較します。',
];
