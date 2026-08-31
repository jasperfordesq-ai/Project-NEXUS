<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    */

    'pusher' => [
        'app_id' => env('PUSHER_APP_ID'),
        'key' => env('PUSHER_KEY', env('PUSHER_APP_KEY')),
        'secret' => env('PUSHER_SECRET', env('PUSHER_APP_SECRET')),
        'cluster' => env('PUSHER_CLUSTER', env('PUSHER_APP_CLUSTER', 'eu')),
        'debug' => (bool) env('PUSHER_DEBUG', false),
    ],

    'sentry' => [
        'dsn' => env('SENTRY_DSN_PHP', env('SENTRY_LARAVEL_DSN')),
        'environment' => env('SENTRY_ENVIRONMENT', env('APP_ENV', 'production')),
        'traces_sample_rate' => (float) env('SENTRY_TRACES_SAMPLE_RATE', 0.1),
    ],

    'openai' => [
        'api_key' => env('OPENAI_API_KEY'),
        'model' => env('OPENAI_MODEL', 'gpt-4'),
    ],

    'gemini' => [
        'api_key' => env('GEMINI_API_KEY'),
        'model' => env('GEMINI_MODEL', 'gemini-2.0-flash'),
    ],

    'anthropic' => [
        'api_key' => env('ANTHROPIC_API_KEY'),
        'model' => env('ANTHROPIC_MODEL', 'claude-3-sonnet-20240229'),
    ],

    'google' => [
        'client_id' => env('GOOGLE_CLIENT_ID'),
        'client_secret' => env('GOOGLE_CLIENT_SECRET'),
        'redirect' => env('GOOGLE_REDIRECT_URI'),
    ],

    'facebook' => [
        'client_id' => env('FACEBOOK_CLIENT_ID', env('FACEBOOK_APP_ID')),
        'client_secret' => env('FACEBOOK_CLIENT_SECRET', env('FACEBOOK_APP_SECRET')),
        'redirect' => env('FACEBOOK_REDIRECT_URI'),
    ],

    'apple' => [
        'client_id' => env('APPLE_CLIENT_ID'),
        'client_secret' => env('APPLE_CLIENT_SECRET'),
        'redirect' => env('APPLE_REDIRECT_URI'),
    ],

    'mailchimp' => [
        'api_key' => env('MAILCHIMP_API_KEY'),
        'list_id' => env('MAILCHIMP_LIST_ID'),
    ],

    'vapid' => [
        'public_key' => env('VAPID_PUBLIC_KEY'),
        'private_key' => env('VAPID_PRIVATE_KEY'),
        'subject' => env('VAPID_SUBJECT', 'mailto:admin@project-nexus.ie'),
    ],

    'stripe' => [
        'secret' => env('STRIPE_SECRET_KEY'),
        'publishable' => env('STRIPE_PUBLISHABLE_KEY'),
        'webhook_secret' => env('STRIPE_WEBHOOK_SECRET'),
        'marketplace_webhook_secret' => env('STRIPE_MARKETPLACE_WEBHOOK_SECRET'),
        'default_currency' => env('STRIPE_DEFAULT_CURRENCY', 'eur'),
    ],

    'fcm' => [
        'server_key' => env('FCM_SERVER_KEY'),
        'project_id' => env('FIREBASE_PROJECT_ID'),
        'service_account_path' => env('FIREBASE_SERVICE_ACCOUNT_PATH', base_path('firebase-service-account.json')),
    ],

    'expo' => [
        // Optional enhanced-security token for Expo Push Service.
        'access_token' => env('EXPO_PUSH_ACCESS_TOKEN'),
    ],

    'sso' => [
        // Base URL identity providers redirect back to; defaults to
        // app.url. Override when the API is served from another host.
        'redirect_base' => env('SSO_REDIRECT_BASE'),
        // Explicit ACR allow-list for upstream assertions accepted in place
        // of local MFA. Validated `amr` MFA evidence is preferred.
        'mfa_acr_values' => env(
            'SSO_MFA_ACR_VALUES',
            'urn:nist:ac:classes:aal2,urn:nist:ac:classes:aal3'
        ),
    ],

    'slack' => [
        // Incoming-webhook URL used by `email:health-alert` to page the
        // operator when email deliverability degrades. When empty the command
        // logs only (safe no-op) — email is deliberately NOT used as the alert
        // channel because email problems are exactly what it watches for.
        'email_alerts_webhook' => env('SLACK_EMAIL_ALERTS_WEBHOOK'),
        // Incoming-webhook URL used by `slo:check` to page the operator when an
        // SLO (exchange-completion success rate) is breached. When empty the
        // command logs/Sentry-captures only (safe no-op).
        'slo_alerts_webhook' => env('SLACK_SLO_ALERTS_WEBHOOK'),
        // Base URL of the React app, used to deep-link Slack alerts to the
        // /admin/email-deliverability dashboard.
        'dashboard_url' => env('ADMIN_DASHBOARD_URL', 'https://app.project-nexus.ie'),
    ],

    'clamav' => [
        // Optional clamd daemon for scanning uploaded podcast audio
        // (e.g. tcp://127.0.0.1:3310). Empty = scanning reported as
        // unavailable; uploads are never blocked by a missing scanner.
        'address' => env('CLAMAV_ADDRESS', ''),
    ],

];
