<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

declare(strict_types=1);

namespace App\Services\CaringCommunity;

/**
 * AG93 — Open-Standards and Integration Showcase service.
 *
 * Composes a language-neutral manifest of live integration surfaces. Section,
 * endpoint, sample, verification, and checklist codes are translated by the
 * React admin consumer; protocol paths and example payloads remain invariant.
 */
class IntegrationShowcaseService
{
    public function showcase(): array
    {
        return [
            'updated_at' => now()->toIso8601String(),
            'sections' => [
                $this->openApiSection(),
                $this->partnerApiSection(),
                $this->oauthSection(),
                $this->webhookSection(),
                $this->federationSection(),
                $this->signedPayloadSection(),
                $this->checklistSection(),
            ],
        ];
    }

    private function openApiSection(): array
    {
        return [
            'id' => 'openapi',
            'icon' => 'FileJson',
            'items' => [
                // No v2 segment — routes/api.php:3115-3116 register these as
                // api/docs/openapi.{json,yaml}. Confirmed against artisan
                // route:list on 2026-07-30; the v2 form returned 404.
                ['code' => 'openapi_json', 'path' => '/api/docs/openapi.json', 'method' => 'GET'],
                ['code' => 'openapi_yaml', 'path' => '/api/docs/openapi.yaml', 'method' => 'GET'],
            ],
            'docs_link' => 'https://github.com/jasperfordesq-ai/nexus-v1/tree/main/docs',
        ];
    }

    private function partnerApiSection(): array
    {
        return [
            'id' => 'partner_api',
            'icon' => 'Plug',
            'items' => [
                ['code' => 'list_users', 'path' => '/api/partner/v1/users', 'method' => 'GET'],
                ['code' => 'show_user', 'path' => '/api/partner/v1/users/{id}', 'method' => 'GET'],
                ['code' => 'list_listings', 'path' => '/api/partner/v1/listings', 'method' => 'GET'],
                ['code' => 'wallet_balance', 'path' => '/api/partner/v1/wallet/balance/{userId}', 'method' => 'GET'],
                ['code' => 'credit_wallet', 'path' => '/api/partner/v1/wallet/credit', 'method' => 'POST'],
                ['code' => 'community_aggregates', 'path' => '/api/partner/v1/aggregates/community', 'method' => 'GET'],
                ['code' => 'list_subscriptions', 'path' => '/api/partner/v1/webhooks/subscriptions', 'method' => 'GET'],
                ['code' => 'create_subscription', 'path' => '/api/partner/v1/webhooks/subscriptions', 'method' => 'POST'],
            ],
            'docs_link' => 'https://github.com/jasperfordesq-ai/nexus-v1/blob/main/docs/API.md',
        ];
    }

    private function oauthSection(): array
    {
        return [
            'id' => 'oauth',
            'icon' => 'KeyRound',
            'items' => [
                ['code' => 'token_endpoint', 'path' => '/api/partner/v1/oauth/token', 'method' => 'POST'],
                ['code' => 'revoke_endpoint', 'path' => '/api/partner/v1/oauth/revoke', 'method' => 'POST'],
            ],
            'sample_request' => [
                'curl' => "curl -X POST https://app.project-nexus.ie/api/partner/v1/oauth/token \\\n"
                    . "  -H 'Content-Type: application/x-www-form-urlencoded' \\\n"
                    . "  -d 'grant_type=client_credentials&client_id=<client-id>&client_secret=<client-secret>&scope=read:users read:listings'",
            ],
        ];
    }

    private function webhookSection(): array
    {
        return [
            'id' => 'webhooks',
            'icon' => 'Webhook',
            'items' => [
                // Only GET and POST exist — see routes/api.php:3915-3917. The
                // PUT and DELETE /webhooks/subscriptions/{id} entries listed here
                // until 2026-07-30 had no route at all, so a partner building
                // against this page got a 404 on both. Do not add an endpoint to
                // this showcase without a registered route behind it.
                ['code' => 'list_subscriptions', 'path' => '/api/partner/v1/webhooks/subscriptions', 'method' => 'GET'],
                ['code' => 'create_subscription', 'path' => '/api/partner/v1/webhooks/subscriptions', 'method' => 'POST'],
            ],
            'verification_note_code' => 'webhook_signature',
        ];
    }

    private function federationSection(): array
    {
        return [
            'id' => 'federation',
            'icon' => 'Network',
            'items' => [
                ['code' => 'tenant_aggregate', 'path' => '/api/v2/federation/aggregates', 'method' => 'GET'],
            ],
            'docs_link' => 'https://github.com/jasperfordesq-ai/nexus-v1/blob/main/docs/FEDERATION_API_MANUAL.md',
        ];
    }

    private function signedPayloadSection(): array
    {
        return [
            'id' => 'sample_payloads',
            'icon' => 'FileCode',
            'samples' => [
                [
                    'code' => 'federation_aggregate',
                    'kind' => 'json',
                    'body' => json_encode([
                        'tenant_id' => 42,
                        'period' => ['from' => '2026-01-01', 'to' => '2026-03-31'],
                        'schema_version' => 1,
                        'aggregates' => [
                            'total_approved_hours' => 1234.5,
                            'member_count_bracket' => '200-1000',
                            'top_categories' => [
                                ['name' => 'companionship', 'count' => 87],
                                ['name' => 'transport', 'count' => 64],
                            ],
                            'partner_org_count' => 12,
                            'supported_locales' => ['de', 'fr', 'it'],
                        ],
                        'signature' => 'ed25519:HASH_VERIFIED_OUT_OF_BAND',
                    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ],
                [
                    'code' => 'webhook_event',
                    'kind' => 'json',
                    'body' => json_encode([
                        'id' => 'evt_2YxK1bn7q3aQ',
                        'type' => 'listing.created',
                        'created' => '2026-04-30T12:34:56Z',
                        'tenant' => 'agoris',
                        'data' => [
                            'listing_id' => 9921,
                            'category' => 'transport',
                            'sub_region' => 'cham_quartier_eichmatt',
                        ],
                    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                    'headers' => [
                        'X-NEXUS-Signature: t=1714478096,v1=8a7e1c64...redacted...e2',
                        'X-NEXUS-Event-Id: evt_2YxK1bn7q3aQ',
                        'Content-Type: application/json',
                    ],
                ],
                [
                    'code' => 'partner_aggregates',
                    'kind' => 'json',
                    'body' => json_encode([
                        'tenant' => 'agoris',
                        'as_of' => '2026-04-30T00:00:00Z',
                        'active_members' => 248,
                        'approved_hours_90d' => 1421,
                        'recurring_relationships' => 73,
                        'cost_offset_chf_90d' => 99470,
                        'methodology' => [
                            'window_days' => 90,
                            'hourly_rate_chf' => 35,
                            'prevention_multiplier' => 2,
                        ],
                    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
                ],
            ],
        ];
    }

    private function checklistSection(): array
    {
        return [
            'id' => 'partner_checklist',
            'icon' => 'ClipboardList',
            'checklist_codes' => [
                'oauth_credentials',
                'allowed_scopes',
                'webhook_subscription',
                'openapi_spec',
                'sandbox_tenant',
                'federation_public_key',
                'rate_limit_headers',
                'data_sharing_agreement',
                'incident_runbook',
            ],
        ];
    }
}
