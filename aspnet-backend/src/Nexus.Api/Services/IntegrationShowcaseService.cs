// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;

namespace Nexus.Api.Services;

public sealed class IntegrationShowcaseService
{
    private static readonly JsonSerializerOptions PrettyJson = new()
    {
        WriteIndented = true,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private readonly NexusDbContext _db;

    public IntegrationShowcaseService(NexusDbContext db)
    {
        _db = db;
    }

    public async Task<bool> IsFeatureEnabledAsync(int tenantId, CancellationToken ct)
    {
        var raw = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && c.Key == "features.caring_community")
            .Select(c => c.Value)
            .FirstOrDefaultAsync(ct);

        return ParseBool(raw) == true;
    }

    public object Showcase()
    {
        return new
        {
            updated_at = DateTimeOffset.UtcNow.ToString("O"),
            sections = new object[]
            {
                OpenApiSection(),
                PartnerApiSection(),
                OAuthSection(),
                WebhookSection(),
                FederationSection(),
                SignedPayloadSection(),
                ChecklistSection()
            }
        };
    }

    private static object OpenApiSection()
    {
        return new
        {
            id = "openapi",
            title = "OpenAPI specification",
            icon = "FileJson",
            body = "Machine-readable spec for every public API surface. Generated from the same controllers that ship in this repo.",
            items = new[]
            {
                new { label = "JSON", path = "/api/v2/docs/openapi.json", method = "GET" },
                new { label = "YAML", path = "/api/v2/docs/openapi.yaml", method = "GET" }
            },
            docs_link = "https://github.com/jasperfordesq-ai/nexus-v1/tree/main/docs"
        };
    }

    private static object PartnerApiSection()
    {
        return new
        {
            id = "partner_api",
            title = "Partner API v1",
            icon = "Plug",
            body = "OAuth-secured external API for third-party integrators. Exposes users, listings, wallet credit, community aggregates, and webhook subscriptions.",
            items = new[]
            {
                new { label = "List users", path = "/api/partner/v1/users", method = "GET" },
                new { label = "Show user", path = "/api/partner/v1/users/{id}", method = "GET" },
                new { label = "List listings", path = "/api/partner/v1/listings", method = "GET" },
                new { label = "Wallet balance", path = "/api/partner/v1/wallet/balance/{userId}", method = "GET" },
                new { label = "Credit wallet", path = "/api/partner/v1/wallet/credit", method = "POST" },
                new { label = "Community aggregates", path = "/api/partner/v1/aggregates/community", method = "GET" },
                new { label = "List subscriptions", path = "/api/partner/v1/webhooks/subscriptions", method = "GET" },
                new { label = "Create subscription", path = "/api/partner/v1/webhooks/subscriptions", method = "POST" }
            },
            docs_link = "https://github.com/jasperfordesq-ai/nexus-v1/blob/main/docs/API.md"
        };
    }

    private static object OAuthSection()
    {
        return new
        {
            id = "oauth",
            title = "OAuth / client credentials",
            icon = "KeyRound",
            body = "Standard OAuth 2.0 client-credentials flow for partner servers. Token revocation supported.",
            items = new[]
            {
                new { label = "Token endpoint", path = "/api/partner/v1/oauth/token", method = "POST" },
                new { label = "Revoke endpoint", path = "/api/partner/v1/oauth/revoke", method = "POST" }
            },
            sample_request = new
            {
                curl = "curl -X POST https://app.project-nexus.ie/api/partner/v1/oauth/token \\\n"
                    + "  -H 'Content-Type: application/x-www-form-urlencoded' \\\n"
                    + "  -d 'grant_type=client_credentials&client_id=<your-client-id>&client_secret=<your-client-secret>&scope=read:users read:listings'"
            }
        };
    }

    private static object WebhookSection()
    {
        return new
        {
            id = "webhooks",
            title = "Webhook subscriptions",
            icon = "Webhook",
            body = "Partners subscribe to event topics; payloads are signed with HMAC-SHA256 over the full body using the per-subscription secret.",
            items = new[]
            {
                new { label = "List subscriptions", path = "/api/partner/v1/webhooks/subscriptions", method = "GET" },
                new { label = "Create subscription", path = "/api/partner/v1/webhooks/subscriptions", method = "POST" },
                new { label = "Update subscription", path = "/api/partner/v1/webhooks/subscriptions/{id}", method = "PUT" },
                new { label = "Delete subscription", path = "/api/partner/v1/webhooks/subscriptions/{id}", method = "DELETE" }
            },
            verification_note = "Verify the X-NEXUS-Signature header by computing HMAC-SHA256(body, secret) and comparing with constant-time equality. Reject any payload older than the configured replay window (default 5 minutes)."
        };
    }

    private static object FederationSection()
    {
        return new
        {
            id = "federation",
            title = "Federation aggregates",
            icon = "Network",
            body = "Each tenant exposes a read-only signed federation aggregate endpoint. Aggregate payloads expose counts, brackets, top categories, and locales - never raw PII. See FEDERATION_API_MANUAL.md for the full protocol.",
            items = new[]
            {
                new { label = "Tenant aggregate", path = "/api/v2/federation/aggregates", method = "GET" }
            },
            docs_link = "https://github.com/jasperfordesq-ai/nexus-v1/blob/main/docs/FEDERATION_API_MANUAL.md"
        };
    }

    private static object SignedPayloadSection()
    {
        return new
        {
            id = "sample_payloads",
            title = "Sample payloads",
            icon = "FileCode",
            body = "Representative payloads for an integration partner - illustrative only, not from a live tenant.",
            samples = new object[]
            {
                new
                {
                    label = "Federation aggregate (signed JSON, illustrative)",
                    kind = "json",
                    body = ToPrettyJson(new
                    {
                        tenant_id = 42,
                        period = new { from = "2026-01-01", to = "2026-03-31" },
                        schema_version = 1,
                        aggregates = new
                        {
                            total_approved_hours = 1234.5,
                            member_count_bracket = "200-1000",
                            top_categories = new[]
                            {
                                new { name = "Companionship", count = 87 },
                                new { name = "Transport", count = 64 }
                            },
                            partner_org_count = 12,
                            supported_locales = new[] { "de", "fr", "it" }
                        },
                        signature = "ed25519:HASH_VERIFIED_OUT_OF_BAND"
                    })
                },
                new
                {
                    label = "Webhook event (HMAC signed, illustrative)",
                    kind = "json",
                    body = ToPrettyJson(new
                    {
                        id = "evt_2YxK1bn7q3aQ",
                        type = "listing.created",
                        created = "2026-04-30T12:34:56Z",
                        tenant = "agoris",
                        data = new
                        {
                            listing_id = 9921,
                            category = "transport",
                            sub_region = "cham_quartier_eichmatt"
                        }
                    }),
                    headers = new[]
                    {
                        "X-NEXUS-Signature: t=1714478096,v1=8a7e1c64...redacted...e2",
                        "X-NEXUS-Event-Id: evt_2YxK1bn7q3aQ",
                        "Content-Type: application/json"
                    }
                },
                new
                {
                    label = "Partner API community aggregates (illustrative)",
                    kind = "json",
                    body = ToPrettyJson(new
                    {
                        tenant = "agoris",
                        as_of = "2026-04-30T00:00:00Z",
                        active_members = 248,
                        approved_hours_90d = 1421,
                        recurring_relationships = 73,
                        cost_offset_chf_90d = 99470,
                        methodology = new
                        {
                            window_days = 90,
                            hourly_rate_chf = 35,
                            prevention_multiplier = 2
                        }
                    })
                }
            }
        };
    }

    private static object ChecklistSection()
    {
        return new
        {
            id = "partner_checklist",
            title = "What an integration partner receives",
            icon = "ClipboardList",
            body = "Hand this checklist to a prospective integration partner before kickoff.",
            checklist = new[]
            {
                "OAuth client_id and client_secret (one pair per partner)",
                "Allowed scopes list (e.g. read:users, read:listings, write:wallet)",
                "Webhook subscription with HMAC secret + endpoint URL allowlist",
                "OpenAPI spec URL (JSON or YAML)",
                "Sandbox tenant slug for integration testing",
                "Federation aggregate signing public key (for federation partners only)",
                "Rate-limit headers documentation (X-RateLimit-Limit, X-RateLimit-Remaining)",
                "Data-sharing agreement (DSA) draft + named DPO contact",
                "Incident-response runbook URL (from the AG80 disclosure pack)"
            }
        };
    }

    private static string ToPrettyJson(object value)
    {
        return JsonSerializer.Serialize(value, PrettyJson);
    }

    private static bool? ParseBool(string? raw)
    {
        if (raw is null)
        {
            return null;
        }

        return raw.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" => false,
            _ => null
        };
    }
}
